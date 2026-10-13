<?php

declare(strict_types=1);

require dirname(__DIR__) . '/lib/mongodb.php';
require dirname(__DIR__) . '/lib/core.php';
require dirname(__DIR__) . '/lib/feature-routes.php';

function featureExpectSame(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException($message);
    }
}

featureExpectSame(
    ['id' => 'project-1', 'progress' => 70, 'milestones' => [], 'recent_updates' => []],
    codexFeatureMongoCleanRow(codexFeatureNormalizeProject([
        '_id' => 'mongo-id',
        '_migration_source' => 'legacy',
        'id' => 'project-1',
        'progress' => '70',
        'milestones' => '[]',
        'recent_updates' => '[]',
    ])),
    'MongoDB project responses must preserve SQL fields and omit storage metadata.',
);

featureExpectSame(
    [
        'id' => 'category-1',
        'name' => 'Engineering',
        'slug' => 'engineering',
        'parent' => null,
        'is_default' => true,
        'count' => 3,
    ],
    codexFeatureMongoCategoryResponse([
        'id' => 'category-1',
        'name' => 'Engineering',
        'slug' => 'engineering',
        'is_default' => 1,
    ], 3),
    'MongoDB category output must match the established API response shape.',
);

featureExpectSame(
    true,
    codexFeatureMongoCanViewClient(
        ['id' => 'admin-1', 'role' => 'Super Admin'],
        ['assigned_agent_id' => 'agent-1'],
    ),
    'Super Admins must retain access to all client projects.',
);
featureExpectSame(
    true,
    codexFeatureMongoCanViewClient(
        ['id' => 'manager-1', 'role' => 'Office Manager', 'office_id' => 'office-1'],
        ['assigned_office_id' => 'office-1'],
    ),
    'Office Managers must retain office-scoped client access.',
);
featureExpectSame(
    false,
    codexFeatureMongoCanViewClient(
        ['id' => 'manager-1', 'role' => 'Office Manager', 'office_id' => 'office-1'],
        ['assigned_office_id' => 'office-2'],
    ),
    'Office Managers must not cross office boundaries.',
);
featureExpectSame(
    true,
    codexFeatureMongoCanViewClient(
        ['id' => 'leader-1', 'role' => 'Team Leader', 'team_id' => 'team-1'],
        ['assigned_team_id' => 'team-1'],
    ),
    'Team Leaders must retain team-scoped client access.',
);
featureExpectSame(
    true,
    codexFeatureMongoCanViewClient(
        ['id' => 'agent-1', 'role' => 'Agent'],
        ['assigned_agent_id' => 'agent-1'],
    ),
    'Agents must retain assigned-client access.',
);
featureExpectSame(
    false,
    codexFeatureMongoCanViewClient(
        ['id' => 'agent-1', 'role' => 'Agent'],
        ['assigned_agent_id' => 'agent-2'],
    ),
    'Agents must not access another agent’s clients.',
);

featureExpectSame(
    true,
    codexFeatureMongoStaffCanManage(
        ['id' => 'manager-1', 'role' => 'Office Manager', 'office_id' => 'office-1'],
        ['id' => 'agent-1', 'role' => 'Agent', 'office_id' => 'office-1'],
    ),
    'Office Managers must retain same-office staff-note access.',
);
featureExpectSame(
    false,
    codexFeatureMongoStaffCanManage(
        ['id' => 'leader-1', 'role' => 'Team Leader', 'team_id' => 'team-1'],
        ['id' => 'agent-2', 'role' => 'Agent', 'team_id' => 'team-2'],
    ),
    'Team Leaders must not access staff outside their team.',
);

putenv('API_STORAGE=mongodb');
handleCodexDynamicsFeatureRoutes(null, '/__no_feature_route__', 'GET', [], null, null);
putenv('API_STORAGE');

fwrite(STDOUT, "MongoDB feature-route helper validation passed.\n");
