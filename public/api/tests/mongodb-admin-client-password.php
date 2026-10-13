<?php
declare(strict_types=1);

require dirname(__DIR__) . '/lib/mongodb.php';
require dirname(__DIR__) . '/lib/core.php';

function expectAdminPasswordSame(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException($message);
    }
}

putenv('API_STORAGE');
$apiPath = '/__admin_password_mongodb_test__';
$method = 'GET';
$input = [];
$pdo = null;
$adminSession = null;
require dirname(__DIR__) . '/routes/04-admin-client-search.php';
require dirname(__DIR__) . '/routes/05-admin-set-client-password-view-password.php';

expectAdminPasswordSame(
    ['action' => 'view', 'client_id' => 'client-7'],
    mongoAdminPasswordRouteMatch('/admin/clients/client-7/portal-password', 'GET'),
    'Portal password viewing must dispatch only its exact GET route.',
);
expectAdminPasswordSame(
    ['action' => 'set', 'client_id' => 'client-7', 'client_route' => false],
    mongoAdminPasswordRouteMatch('/admin/users/client-7/set-password', 'POST'),
    'The admin users password-reset route must retain its POST dispatch.',
);
expectAdminPasswordSame(
    ['action' => 'set', 'client_id' => 'client-7', 'client_route' => true],
    mongoAdminPasswordRouteMatch('/admin/clients/client-7/set-password', 'POST'),
    'The client password-setup route must retain its POST dispatch.',
);
expectAdminPasswordSame(
    null,
    mongoAdminPasswordRouteMatch('/admin/clients/client-7/portal-password', 'POST'),
    'Password view must not dispatch for a write method.',
);
expectAdminPasswordSame(
    null,
    mongoAdminPasswordRouteMatch('/admin/users/client-7/set-password/extra', 'POST'),
    'Password writes must reject paths outside the exact route.',
);

expectAdminPasswordSame(
    ['email' => ['$regex' => '^\\s*client\\+portal@example\\.com\\s*$', '$options' => 'i']],
    mongoAdminPasswordEmailFilter(' Client+Portal@example.com '),
    'Duplicate email checks must match trimmed, case-insensitive SQL identity semantics.',
);

expectAdminPasswordSame(
    false,
    mongoAdminPasswordActorCanViewClient(
        ['id' => 'staff-1', 'role' => 'Office Manager', 'office_id' => null],
        ['assigned_office_id' => '__no_office__'],
    ),
    'Office managers without an office must not gain access to unassigned clients.',
);
expectAdminPasswordSame(
    true,
    mongoAdminPasswordActorCanViewClient(
        ['id' => 'staff-1', 'role' => 'Team Leader', 'team_id' => 'team-2'],
        ['assigned_team_id' => 'team-2'],
    ),
    'Team leaders must retain team-scoped client access.',
);
expectAdminPasswordSame(
    false,
    mongoAdminPasswordActorCanViewClient(
        ['id' => 'staff-1', 'role' => 'Agent'],
        ['assigned_agent_id' => 'staff-2'],
    ),
    'Agents must not access clients assigned to another staff member.',
);

$userRouteExisting = mongoAdminPasswordAccessWriteSpec(false, true, 'client-7', 'hash', 'ciphertext', 'now');
expectAdminPasswordSame(
    ['password_hash' => 'hash', 'admin_view_password_enc' => 'ciphertext'],
    $userRouteExisting['updates'],
    'Existing user-route access updates must not reactivate disabled portal accounts.',
);
$clientRouteExisting = mongoAdminPasswordAccessWriteSpec(true, true, 'client-7', 'hash', 'ciphertext', 'now');
expectAdminPasswordSame(
    ['password_hash' => 'hash', 'admin_view_password_enc' => 'ciphertext', 'status' => 'Active', 'portal_enabled' => 1],
    $clientRouteExisting['updates'],
    'Existing client-route access updates must retain reactivation behavior.',
);
$clientRouteNew = mongoAdminPasswordAccessWriteSpec(true, false, 'client-7', 'hash', 'ciphertext', 'now');
expectAdminPasswordSame(
    'Enterprise Partner',
    $clientRouteNew['insert']['tier'],
    'New client portal access must preserve its default tier.',
);
expectAdminPasswordSame(
    ['client_id' => 'client-7'],
    $clientRouteNew['filter'],
    'Portal access mutations must filter on the preserved legacy client_id.',
);
expectAdminPasswordSame(
    false,
    array_key_exists('password', $clientRouteNew['insert']),
    'Portal access documents must not contain a plaintext password field.',
);

fwrite(STDOUT, "MongoDB admin client-password route validation passed.\n");
