<?php
declare(strict_types=1);

final class SupportChatResponse extends RuntimeException
{
    public function __construct(
        public readonly array $payload,
        public readonly int $status,
    ) {
        parent::__construct('Route response captured.');
    }
}

$GLOBALS['supportChatRows'] = [
    'staff_users' => [[
        'id' => 'staff-1',
        'role' => 'Super Admin',
        'status' => 'Active',
        'deleted_at' => null,
        'capabilities' => [],
    ]],
    'clients' => [[
        'id' => 'client-1',
        'name' => 'Client One',
        'email' => 'client@example.com',
        'company' => 'Example Co',
        'deleted_at' => null,
    ]],
    'messages' => [
        [
            '_id' => 'mongo-older',
            '_migration_source' => 'legacy',
            'id' => 'msg-older',
            'user_id' => 'client-1',
            'sender' => 'client',
            'is_read' => 0,
            'created_at' => '2026-10-12T10:00:00+00:00',
            'body' => 'Earlier message',
        ],
        [
            '_id' => 'mongo-newer',
            'id' => 'msg-newer',
            'user_id' => 'client-1',
            'sender' => 'agent',
            'is_read' => 0,
            'created_at' => '2026-10-12T11:00:00+00:00',
            'body' => 'Latest message',
        ],
        [
            '_id' => 'mongo-other',
            'id' => 'msg-other',
            'user_id' => 'client-2',
            'sender' => 'client',
            'is_read' => 0,
            'created_at' => '2026-10-12T12:00:00+00:00',
            'body' => 'Must not appear',
        ],
    ],
];

function isMongoStorageEnabled(): bool
{
    return true;
}

function supportChatMatches(array $row, array $filter): bool
{
    foreach ($filter as $field => $value) {
        if ($field === '$or') {
            foreach ($value as $alternative) {
                if (supportChatMatches($row, $alternative)) return true;
            }
            return false;
        }
        if (($row[$field] ?? null) !== $value) return false;
    }
    return true;
}

function mongoFindOne(string $table, array $filter): ?array
{
    foreach ($GLOBALS['supportChatRows'][$table] ?? [] as $row) {
        if (supportChatMatches($row, $filter)) return $row;
    }
    return null;
}

function mongoFindMany(string $table, array $filter = [], array $options = []): array
{
    $rows = array_values(array_filter(
        $GLOBALS['supportChatRows'][$table] ?? [],
        static fn(array $row): bool => supportChatMatches($row, $filter),
    ));
    if (isset($options['sort']['created_at'])) {
        usort($rows, static fn(array $left, array $right): int =>
            strcmp($left['created_at'], $right['created_at']) * (int)$options['sort']['created_at']);
    }
    if (isset($options['limit'])) $rows = array_slice($rows, 0, (int)$options['limit']);
    return $rows;
}

function mongoCollectionName(string $table): string
{
    return 'legacy_' . $table;
}

function getMongoCollection(string $name): SupportChatFakeCollection
{
    return new SupportChatFakeCollection(substr($name, strlen('legacy_')));
}

function jsonResponse(mixed $data, int $status = 200): void
{
    throw new SupportChatResponse($data, $status);
}

final class SupportChatFakeCollection
{
    public function __construct(private readonly string $table)
    {
    }

    public function countDocuments(array $filter): int
    {
        return count(array_filter(
            $GLOBALS['supportChatRows'][$this->table] ?? [],
            static fn(array $row): bool => supportChatMatches($row, $filter),
        ));
    }
}

$apiPath = '/__support_chat_test__';
$method = 'GET';
$input = [];
$adminSession = null;
$portalSession = null;
$pdo = null;
$_GET = [];
require dirname(__DIR__) . '/routes/06-admin-notifications.php';

$apiPath = '/admin/messages';
$method = 'GET';
$adminSession = ['id' => 'staff-1'];
$_GET = ['user_id' => 'client-1', 'limit' => '10'];
try {
    require dirname(__DIR__) . '/routes/07-admin-client-support-chat.php';
    throw new RuntimeException('The chat route should return its response.');
} catch (SupportChatResponse $response) {
    if ($response->status !== 200
        || $response->payload['user']['id'] !== 'client-1'
        || $response->payload['user']['name'] !== 'Client One'
        || $response->payload['unread_count'] !== 1
        || count($response->payload['messages']) !== 2
        || $response->payload['messages'][0]['id'] !== 'msg-older'
        || isset($response->payload['messages'][0]['_id'])) {
        throw new RuntimeException('Admin chat reads must preserve response shape, order, scoping, and unread counts.');
    }
}

$cleaned = mongoSupportCleanRow([
    '_id' => 'mongo-id',
    '_migration_source' => 'legacy',
    'id' => 'sql-id',
    'body' => 'Original body',
]);
if ($cleaned !== ['id' => 'sql-id', 'body' => 'Original body']) {
    throw new RuntimeException('Support chat responses must retain SQL fields and hide migration metadata.');
}
if (mongoSupportIdFilter('42') !== ['$or' => [['id' => '42'], ['id' => 42]]]) {
    throw new RuntimeException('Numeric SQL ids must match imported string and integer values.');
}
if (mongoSupportUnreadFilter('client-1', 'client') !== [
    'user_id' => 'client-1',
    'sender' => 'client',
    'is_read' => 0,
]) {
    throw new RuntimeException('Unread filters must be scoped to client and sender.');
}
$documents = mongoSupportMessageDocuments(
    'msg_test',
    'client-1',
    'client',
    'client-1',
    'Client One',
    'Hello',
    '2026-10-12T12:00:00+00:00',
);
if ($documents['message'] !== [
    'id' => 'msg_test',
    'user_id' => 'client-1',
    'sender' => 'client',
    'sender_id' => 'client-1',
    'sender_name' => 'Client One',
    'body' => 'Hello',
    'is_read' => 0,
    'created_at' => '2026-10-12T12:00:00+00:00',
]) {
    throw new RuntimeException('New support messages must preserve the SQL row contract.');
}
if ($documents['audit']['action'] !== 'SUPPORT_MESSAGE_RECEIVED'
    || $documents['audit']['user_id'] !== 'client-1') {
    throw new RuntimeException('Support message audits must retain action and client ownership.');
}
if (!mongoRouteActorCanViewClient(['id' => 'staff-1', 'role' => 'Super Admin'], [
    'assigned_agent_id' => 'another-agent',
])) {
    throw new RuntimeException('Super Admins must retain cross-client chat access.');
}
if (mongoRouteActorCanViewClient(
    ['id' => 'agent-1', 'role' => 'Agent'],
    ['assigned_agent_id' => 'agent-2'],
)) {
    throw new RuntimeException('Agent chat access must remain limited to assigned clients.');
}

fwrite(STDOUT, "MongoDB support-chat route validation passed without Atlas credentials.\n");
