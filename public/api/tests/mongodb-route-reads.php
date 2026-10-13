<?php
declare(strict_types=1);

require dirname(__DIR__) . '/lib/mongodb.php';
require dirname(__DIR__) . '/lib/core.php';

function expectRouteSame(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException($message . ' Expected ' . var_export($expected, true)
            . ', got ' . var_export($actual, true) . '.');
    }
}

function expectRouteTrue(bool $actual, string $message): void
{
    if (!$actual) throw new RuntimeException($message);
}

putenv('API_STORAGE');
$apiPath = '/__mongodb_route_test__';
$method = 'GET';
$pdo = null;
$adminSession = null;
$portalSession = null;
$input = [];
require dirname(__DIR__) . '/routes/06-admin-notifications.php';
require dirname(__DIR__) . '/routes/08-client-activity-audit-log.php';
require dirname(__DIR__) . '/routes/09-admin-offices-management.php';
require dirname(__DIR__) . '/routes/10-admin-teams-management.php';
require dirname(__DIR__) . '/routes/11-admin-staff.php';
require dirname(__DIR__) . '/routes/04-admin-client-search.php';

$superAdmin = ['id' => 'sa-1', 'role' => 'Super Admin'];
$officeManager = ['id' => 'om-1', 'role' => 'Office Manager', 'office_id' => 'of-1'];
$teamLeader = ['id' => 'tl-1', 'role' => 'Team Leader', 'team_id' => 'tm-1'];
$agent = ['id' => 'ag-1', 'role' => 'Agent'];
$assignedClient = [
    'assigned_office_id' => 'of-1',
    'assigned_team_id' => 'tm-1',
    'assigned_team_leader_id' => 'tl-1',
    'assigned_agent_id' => 'ag-1',
];
$otherClient = [
    'assigned_office_id' => 'of-2',
    'assigned_team_id' => 'tm-2',
    'assigned_team_leader_id' => 'tl-2',
    'assigned_agent_id' => 'ag-2',
];

expectRouteTrue(mongoRouteActorCanViewClient($superAdmin, $otherClient), 'Super Admin visibility changed.');
expectRouteTrue(mongoRouteActorCanViewClient($officeManager, $assignedClient), 'Office Manager visibility changed.');
expectRouteTrue(!mongoRouteActorCanViewClient($officeManager, $otherClient), 'Office Manager scope was widened.');
expectRouteTrue(mongoRouteActorCanViewClient($teamLeader, $assignedClient), 'Team Leader visibility changed.');
expectRouteTrue(!mongoRouteActorCanViewClient($teamLeader, $otherClient), 'Team Leader scope was widened.');
expectRouteTrue(mongoRouteActorCanViewClient($agent, $assignedClient), 'Agent visibility changed.');
expectRouteTrue(!mongoRouteActorCanViewClient($agent, $otherClient), 'Agent scope was widened.');

expectRouteSame(
    ['notifications' => false],
    mongoRouteDecodeCapabilities('{"notifications":false}'),
    'MongoDB capability JSON should preserve the existing decoded shape.',
);
expectRouteSame([], mongoRouteDecodeCapabilities('{invalid'), 'Invalid capability JSON must fail closed to no overrides.');
expectRouteSame(
    ['id' => 'n-1', 'message' => 'Hello'],
    mongoRouteCleanRow(['_id' => 'migration-hash', '_migration_source' => 'legacy', 'id' => 'n-1', 'message' => 'Hello']),
    'MongoDB metadata must not leak through converted endpoints.',
);
expectRouteSame(
    [
        ['id' => 'n-1'],
        ['id' => 'n-2'],
    ],
    mongoRouteCleanRows([
        ['_id' => 'migration-1', 'id' => 'n-1'],
        ['_id' => 'migration-2', '_migration_source' => 'legacy', 'id' => 'n-2'],
    ]),
    'MongoDB metadata must be removed from every returned row.',
);
expectRouteSame(
    ['$or' => [
        ['name' => ['$regex' => 'Taylor\\.\\*', '$options' => 'i']],
        ['email' => ['$regex' => 'Taylor\\.\\*', '$options' => 'i']],
        ['company' => ['$regex' => 'Taylor\\.\\*', '$options' => 'i']],
        ['id' => ['$regex' => 'Taylor\\.\\*', '$options' => 'i']],
    ]],
    mongoAdminClientSearchFilter('Taylor.*'),
    'Client search input must be treated literally rather than as an injected regex.',
);
expectRouteSame([], mongoAdminClientSearchFilter(''), 'Empty client search must match the full list.');
expectRouteSame(
    ['assigned_office_id' => 'office-1'],
    mongoAdminClientScopeFilter(['role' => 'Office Manager', 'office_id' => 'office-1']),
    'Office managers must only search clients assigned to their office.',
);
expectRouteSame(
    ['$or' => [
        ['assigned_team_id' => 'team-1'],
        ['assigned_team_leader_id' => 'staff-1'],
    ]],
    mongoAdminClientScopeFilter(['id' => 'staff-1', 'role' => 'Team Leader', 'team_id' => 'team-1']),
    'Team leaders must search within their team or directly-led clients.',
);
expectRouteSame(
    ['assigned_agent_id' => 'staff-2'],
    mongoAdminClientScopeFilter(['id' => 'staff-2', 'role' => 'Agent']),
    'Agents must only search clients assigned to them.',
);
expectRouteSame([], mongoAdminClientScopeFilter(['role' => 'Super Admin']), 'Super Admins must retain global client search.');
expectRouteSame(null, mongoAdminClientScopeFilter(['role' => 'Billing']), 'Non-CRM roles must not access client search.');
expectRouteSame(
    ['$and' => [
        ['assigned_agent_id' => 'staff-2'],
        ['$or' => [
            ['name' => ['$regex' => 'Taylor', '$options' => 'i']],
            ['email' => ['$regex' => 'Taylor', '$options' => 'i']],
            ['company' => ['$regex' => 'Taylor', '$options' => 'i']],
            ['id' => ['$regex' => 'Taylor', '$options' => 'i']],
        ]],
    ]],
    mongoAdminClientSearchQueryFilter(['id' => 'staff-2', 'role' => 'Agent'], 'Taylor'),
    'Search terms must be combined with—not replace—the actor client-assignment scope.',
);
expectRouteSame(
    ['id' => 'client-1', 'appointments' => '[]'],
    mongoAdminClientAppointmentFilter('client-1', ['appointments' => '[]']),
    'Appointment writes must compare the previous value so concurrent changes are not overwritten.',
);
expectRouteSame(
    ['id' => 'client-1', 'appointments' => ['$exists' => false]],
    mongoAdminClientAppointmentFilter('client-1', ['id' => 'client-1']),
    'Appointment writes must handle legacy rows where the JSON column is absent.',
);
expectRouteSame(
    [
        'ok' => true,
        'users' => [[
            'id' => 'client-1',
            'name' => 'Taylor Smith',
            'company' => 'Acme',
            'email' => 'taylor@example.com',
            'phone' => null,
            'status' => null,
            'portal_enabled' => 1,
            'tier' => 'Gold',
            'last_login_at' => null,
            'created_at' => null,
        ]],
        'total' => 1,
    ],
    mongoAdminClientSearchResponse(
        [['id' => 'client-1', 'name' => 'Taylor Smith', 'company' => 'Acme', 'email' => 'taylor@example.com']],
        ['client-1' => ['portal_enabled' => 1, 'tier' => 'Gold']],
    ),
    'Admin client-search rows must preserve the API response fields and access metadata.',
);
fwrite(STDOUT, "MongoDB route helper validation passed without an Atlas connection.\n");
