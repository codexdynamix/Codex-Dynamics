<?php
declare(strict_types=1);

require dirname(__DIR__) . '/lib/mongodb.php';
require dirname(__DIR__) . '/lib/core.php';

function expectSame(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException($message);
    }
}

function expectFailure(callable $operation, string $expectedClass, string $messagePart): void
{
    try {
        $operation();
    } catch (Throwable $exception) {
        if (!$exception instanceof $expectedClass || !str_contains($exception->getMessage(), $messagePart)) {
            throw new RuntimeException('Unexpected failure while checking the MongoDB foundation.', 0, $exception);
        }

        return;
    }

    throw new RuntimeException('Expected the MongoDB foundation to reject invalid configuration.');
}

expectFailure(
    static fn() => getMongoCollection('invalid.collection'),
    InvalidArgumentException::class,
    'Invalid MongoDB collection name',
);

putenv('MONGODB_URI');
expectFailure(
    static fn() => getMongoDatabase(),
    RuntimeException::class,
    'MONGODB_URI',
);

putenv('API_STORAGE');
expectSame(false, isMongoStorageEnabled(), 'MongoDB route mode must remain opt-in.');
expectSame(false, isMongoPublicContentEnabled(), 'The legacy content-mode helper must remain opt-in.');
putenv('API_STORAGE=mongodb');
expectSame(true, isMongoStorageEnabled(), 'MongoDB route mode was not enabled by API_STORAGE=mongodb.');
expectSame(true, isMongoPublicContentEnabled(), 'The legacy content-mode helper must remain compatible.');
putenv('API_STORAGE');

putenv('MONGODB_URI=mongodb://localhost');
putenv('MONGODB_DATABASE');
expectSame(
    'codex_dynamics_migration',
    mongoConfiguration()[1],
    'MongoDB API default database must match the importer staging database.',
);
putenv('MONGODB_DATABASE=bad.database.name');
expectFailure(
    static fn() => mongoConfiguration(),
    RuntimeException::class,
    'valid short database name',
);
putenv('MONGODB_DATABASE');
putenv('NODE_ENV=production');
expectFailure(
    static fn() => mongoConfiguration(),
    RuntimeException::class,
    'explicitly configured in production',
);
putenv('NODE_ENV');
putenv('MONGODB_URI');

expectSame(
    ['email' => ['$regex' => '^jane\\+test@example\\.com$', '$options' => 'i']],
    mongoAuthEmailFilter('Jane+Test@example.com'),
    'MongoDB staff email filtering must be case-insensitive and regex-safe.',
);
expectSame(
    ['email' => ['$regex' => '^\\s*jane@example\\.com\\s*$', '$options' => 'i']],
    mongoAuthEmailFilter(' jane@example.com ', true),
    'MongoDB portal email filtering must preserve SQL trim semantics.',
);
expectSame(
    ['token_hash' => hash('sha256', 'session-token')],
    mongoSessionTokenFilter('session-token'),
    'MongoDB session lookups must use the preserved token_hash field, not _id.',
);
expectSame(
    ['_id' => 'migration-hash', 'id' => 'staff-7', 'token_hash' => 'session-hash'],
    mongoDocumentToArray(['_id' => 'migration-hash', 'id' => 'staff-7', 'token_hash' => 'session-hash']),
    'MongoDB mapping must preserve imported id and token_hash fields when _id differs.',
);
expectSame(
    true,
    mongoSessionIsActive(['expires_at' => '2026-10-13T00:00:00+00:00'], strtotime('2026-10-12T23:59:59+00:00')),
    'An unexpired imported MongoDB session must validate.',
);
expectSame(
    false,
    mongoSessionIsActive(['expires_at' => '2026-10-12T23:59:59+00:00'], strtotime('2026-10-13T00:00:00+00:00')),
    'An expired imported MongoDB session must be rejected.',
);
expectFailure(
    static fn() => findMongoSession('admin_sessions', 'client_id'),
    InvalidArgumentException::class,
    'Invalid MongoDB session table',
);

$adminResponse = mongoAdminUserResponse([
    '_id' => 'migration-hash',
    'id' => 'staff-7',
    'name' => 'Morgan Lee',
    'email' => 'morgan@example.com',
    'role' => 'Agent',
    'office_id' => 'office-2',
    'team_id' => 'team-4',
    'status' => 'Active',
    'last_login_at' => '2026-10-12T12:00:00+00:00',
    'capabilities' => '{"reports":true}',
    'password' => 'must-not-escape',
]);
expectSame('staff-7', $adminResponse['id'], 'MongoDB admin responses must use the row id field, not _id.');
expectSame(['reports' => true], $adminResponse['capabilities'], 'MongoDB admin capabilities must retain the existing decoded response shape.');
expectSame(false, array_key_exists('password', $adminResponse), 'MongoDB admin responses must not expose stored credentials.');
expectSame(false, array_key_exists('_id', $adminResponse), 'MongoDB storage metadata must not leak into admin responses.');

$portalResponse = mongoPortalClientResponse(
    ['_id' => 'migration-hash', 'id' => 'client-8', 'name' => 'Taylor Smith', 'password_hash' => 'must-not-escape'],
    ['status' => 'Active', 'portal_enabled' => 1, 'tier' => 'Gold'],
    '2026-10-13T00:00:00+00:00',
);
expectSame('client-8', $portalResponse['id'], 'MongoDB portal responses must use the client row id field.');
expectSame(true, $portalResponse['portalEnabled'], 'MongoDB portal responses must preserve portal-enabled status.');
expectSame(false, array_key_exists('password_hash', $portalResponse), 'MongoDB portal responses must not expose stored credentials.');

// Load the public route group without matching its request handler so the
// filter and response normalization can be checked without an Atlas connection.
$apiPath = '/__test__';
require dirname(__DIR__) . '/routes/01-public-website-content.php';

expectSame(
    [
        'projects' => [['is_published' => 1, 'deleted_at' => null], ['sort' => ['id' => -1]]],
        'blogs' => [['status' => 'published', 'deleted_at' => null], ['sort' => ['id' => -1]]],
        'reviews' => [['is_published' => 1, 'deleted_at' => null], ['sort' => ['id' => -1]]],
    ],
    mongoPublicContentQueries(),
    'Public-content MongoDB queries do not preserve the existing filters and ordering.',
);

$projects = normalizeMongoPublicProjects([[
    '_id' => 'sqlite:hash',
    '_migration_source' => 'legacy',
    'id' => '12',
    'is_published' => 1,
    'showcase_json' => '{"title":"Showcase title","custom_field":"kept"}',
    'description' => 'Original description',
]]);
expectSame(12, $projects[0]['id'], 'MongoDB project ids must retain the existing integer response type.');
expectSame('Showcase title', $projects[0]['title'], 'Showcase JSON must continue to override project columns.');
expectSame('kept', $projects[0]['custom_field'], 'Showcase JSON fields must remain exposed.');
expectSame(true, $projects[0]['published'], 'Published project compatibility field is missing.');
expectSame(false, isset($projects[0]['showcase_json']), 'The raw showcase JSON column must remain hidden.');
expectSame(false, isset($projects[0]['_id']), 'MongoDB storage metadata must not leak into the API response.');

$contentRows = normalizeMongoPublicContentRows([[
    '_id' => 'sqlite:hash',
    '_migration_source' => 'legacy',
    'id' => 7,
    'title' => 'Published article',
]]);
expectSame(['id' => 7, 'title' => 'Published article'], $contentRows[0], 'MongoDB metadata must be stripped from content rows.');

fwrite(STDOUT, "MongoDB foundation validation passed.\n");
