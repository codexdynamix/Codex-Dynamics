<?php
declare(strict_types=1);

require dirname(__DIR__) . '/lib/mongodb.php';

final class HostingerMailDispatchTestResponse extends RuntimeException
{
    public function __construct(public readonly array $payload, public readonly int $status)
    {
        parent::__construct('Expected JSON response.');
    }
}

function jsonResponse(array $payload, int $status = 200): never
{
    throw new HostingerMailDispatchTestResponse($payload, $status);
}

final class HostingerMailTestPdo extends PDO
{
    public function __construct() {}
}

require dirname(__DIR__) . '/lib/hostinger-mail.php';

function hostingerMailTestSame(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException($message . "\nExpected: " . var_export($expected, true) . "\nActual: " . var_export($actual, true));
    }
}

function hostingerMailTestResponse(callable $operation, int $status): HostingerMailDispatchTestResponse
{
    try {
        $operation();
    } catch (HostingerMailDispatchTestResponse $response) {
        hostingerMailTestSame($status, $response->status, 'MongoDB mail dispatch returned the wrong authorization status.');
        return $response;
    }
    throw new RuntimeException('Expected the route dispatch to stop with a JSON response.');
}

hostingerMailTestSame(
    [
        'id' => 'hmb_1',
        'clientId' => 'client-1',
        'providerMailboxId' => 'AC123',
        'emailAddress' => 'hello@example.com',
        'displayName' => 'Hello',
        'enabled' => true,
        'createdAt' => 'created',
        'updatedAt' => 'updated',
    ],
    hostingerMailMongoAssignmentResponse([
        '_id' => 'migration-key',
        '_migration_source' => 'sqlite',
        'id' => 'hmb_1',
        'client_id' => 'client-1',
        'provider_mailbox_id' => 'AC123',
        'email_address' => 'hello@example.com',
        'display_name' => 'Hello',
        'status' => 'enabled',
        'created_at' => 'created',
        'updated_at' => 'updated',
    ], 'client_id'),
    'Assignment normalization must preserve the SQL API field names without exposing Mongo metadata.',
);
hostingerMailTestSame(
    ['id' => 'hms_1', 'staffId' => 'staff-1', 'providerMailboxId' => 'AC456', 'emailAddress' => 'team@example.com',
        'displayName' => 'Team', 'enabled' => false, 'createdAt' => 'created', 'updatedAt' => 'updated'],
    hostingerMailMongoAssignmentResponse([
        'id' => 'hms_1', 'staff_id' => 'staff-1', 'provider_mailbox_id' => 'AC456',
        'email_address' => 'team@example.com', 'display_name' => 'Team', 'status' => 'disabled',
        'created_at' => 'created', 'updated_at' => 'updated',
    ], 'staff_id'),
    'Staff assignment responses must preserve their client-facing field names.',
);
hostingerMailTestSame(['\\Seen', '\\Answered'], hostingerMailNormalizeFlagList(['\\Seen', '\\Seen', '\\Answered']), 'Mail flag normalization should retain unique supported flags.');
hostingerMailTestSame('user@example.com', hostingerMailNormalizeSenderAddress(' User@Example.com '), 'Blocked-sender addresses must retain the SQL path normalization.');

$pdo = new HostingerMailTestPdo();
putenv('API_STORAGE');
hostingerMailTestSame(false, hostingerMailDispatch($pdo, '/__unmatched__', 'GET', [], null, null), 'PDO dispatch must remain the default when MongoDB mode is off.');

putenv('API_STORAGE=mongodb');
hostingerMailTestSame(true, isMongoStorageEnabled(), 'MongoDB dispatch must use the opt-in storage selector.');
hostingerMailTestSame(false, hostingerMailDispatch($pdo, '/__unmatched__', 'GET', [], null, null), 'Unmatched requests must not connect to MongoDB.');
$adminError = hostingerMailTestResponse(
    static fn() => hostingerMailMongoDispatch($pdo, '/admin/integrations/hostinger-mail', 'GET', [], null, null),
    401,
);
hostingerMailTestSame('Authentication required.', $adminError->payload['error'], 'MongoDB admin requests must reject unauthenticated dispatch before storage access.');
$portalError = hostingerMailTestResponse(
    static fn() => hostingerMailMongoDispatch($pdo, '/portal/mailboxes', 'GET', [], null, null),
    401,
);
hostingerMailTestSame('Authentication required.', $portalError->payload['error'], 'MongoDB portal requests must reject unauthenticated dispatch before storage access.');
putenv('API_STORAGE');

fwrite(STDOUT, "MongoDB Hostinger Mail helper and dispatch validation passed.\n");
