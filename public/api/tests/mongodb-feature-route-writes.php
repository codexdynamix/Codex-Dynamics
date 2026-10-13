<?php
declare(strict_types=1);

final class FeatureRouteResponse extends RuntimeException
{
    public function __construct(public readonly array $payload, public readonly int $status)
    {
        parent::__construct('Route response captured.');
    }
}

$GLOBALS['featureRows'] = [];
$GLOBALS['featureTransactions'] = 0;

function isMongoStorageEnabled(): bool
{
    return true;
}

function mongoCollectionName(string $table): string
{
    return 'legacy_' . $table;
}

function mongoDocumentToArray(mixed $document): ?array
{
    return is_array($document) ? $document : null;
}

function mongoFindOne(string $table, array $filter): ?array
{
    return (new FeatureRouteCollection(mongoCollectionName($table)))->findOne($filter);
}

function mongoFindMany(string $table, array $filter = [], array $options = []): array
{
    return (new FeatureRouteCollection(mongoCollectionName($table)))->find($filter, $options);
}

function getMongoCollection(string $name): FeatureRouteCollection
{
    return new FeatureRouteCollection($name);
}

function getMongoDatabase(): FeatureRouteDatabase
{
    static $database;
    return $database ??= new FeatureRouteDatabase();
}

function jsonResponse(mixed $data, int $status = 200): never
{
    throw new FeatureRouteResponse(is_array($data) ? $data : [], $status);
}

final class FeatureRouteResult
{
    public function __construct(private readonly int $matched = 0, private readonly int $deleted = 0) {}
    public function getMatchedCount(): int { return $this->matched; }
    public function getDeletedCount(): int { return $this->deleted; }
}

final class FeatureRouteSession
{
    private ?array $snapshot = null;
    public function startTransaction(): void
    {
        $GLOBALS['featureTransactions']++;
        $this->snapshot = $GLOBALS['featureRows'];
    }
    public function commitTransaction(): void { $this->snapshot = null; }
    public function abortTransaction(): void
    {
        if ($this->snapshot !== null) $GLOBALS['featureRows'] = $this->snapshot;
        $this->snapshot = null;
    }
    public function endSession(): void {}
    public function isInTransaction(): bool { return $this->snapshot !== null; }
}

final class FeatureRouteManager
{
    public function startSession(): FeatureRouteSession { return new FeatureRouteSession(); }
}

final class FeatureRouteDatabase
{
    public function getManager(): FeatureRouteManager { return new FeatureRouteManager(); }
    public function listCollectionNames(): array { return array_keys($GLOBALS['featureRows']); }
}

final class FeatureRouteCollection
{
    public function __construct(private readonly string $name) {}

    public function findOne(array $filter, array $options = []): ?array
    {
        foreach ($GLOBALS['featureRows'][$this->name] ?? [] as $row) {
            if ($this->matches($row, $filter)) return $row;
        }
        return null;
    }

    public function find(array $filter = [], array $options = []): array
    {
        $rows = array_values(array_filter(
            $GLOBALS['featureRows'][$this->name] ?? [],
            fn(array $row): bool => $this->matches($row, $filter),
        ));
        if (isset($options['sort'])) {
            $sort = $options['sort'];
            usort($rows, static function (array $a, array $b) use ($sort): int {
                foreach ($sort as $field => $direction) {
                    $cmp = ($a[$field] ?? null) <=> ($b[$field] ?? null);
                    if ($cmp !== 0) return $cmp * (int)$direction;
                }
                return 0;
            });
        }
        if (isset($options['limit'])) $rows = array_slice($rows, 0, (int)$options['limit']);
        return $rows;
    }

    public function insertOne(array $document, array $options = []): FeatureRouteResult
    {
        $id = $document['_id'] ?? null;
        if ($id === null) throw new RuntimeException('Missing fake Mongo _id.');
        foreach ($GLOBALS['featureRows'][$this->name] ?? [] as $row) {
            if (($row['_id'] ?? null) === $id) throw new RuntimeException('Duplicate key.', 11000);
        }
        $GLOBALS['featureRows'][$this->name][] = $document;
        return new FeatureRouteResult(1);
    }

    public function updateOne(array $filter, array $update, array $options = []): FeatureRouteResult
    {
        $rows = $GLOBALS['featureRows'][$this->name] ?? [];
        foreach ($rows as $index => $row) {
            if (!$this->matches($row, $filter)) continue;
            $GLOBALS['featureRows'][$this->name][$index] = $this->applyUpdate($row, $update);
            return new FeatureRouteResult(1);
        }
        if (!empty($options['upsert'])) {
            $newRow = [];
            foreach ($filter as $field => $value) {
                if (!str_starts_with((string)$field, '$') && !is_array($value)) $newRow[$field] = $value;
            }
            $newRow = $this->applyUpdate($newRow, $update, true);
            if (!isset($newRow['_id'])) $newRow['_id'] = (string)($newRow['id'] ?? $newRow['client_id'] ?? uniqid('fake_', true));
            $GLOBALS['featureRows'][$this->name][] = $newRow;
            return new FeatureRouteResult(0);
        }
        return new FeatureRouteResult();
    }

    public function updateMany(array $filter, array $update, array $options = []): FeatureRouteResult
    {
        $matched = 0;
        foreach ($GLOBALS['featureRows'][$this->name] ?? [] as $index => $row) {
            if (!$this->matches($row, $filter)) continue;
            $GLOBALS['featureRows'][$this->name][$index] = $this->applyUpdate($row, $update);
            $matched++;
        }
        return new FeatureRouteResult($matched);
    }

    public function deleteOne(array $filter, array $options = []): FeatureRouteResult
    {
        foreach ($GLOBALS['featureRows'][$this->name] ?? [] as $index => $row) {
            if (!$this->matches($row, $filter)) continue;
            array_splice($GLOBALS['featureRows'][$this->name], $index, 1);
            return new FeatureRouteResult(0, 1);
        }
        return new FeatureRouteResult();
    }

    public function deleteMany(array $filter, array $options = []): FeatureRouteResult
    {
        $before = count($GLOBALS['featureRows'][$this->name] ?? []);
        $GLOBALS['featureRows'][$this->name] = array_values(array_filter(
            $GLOBALS['featureRows'][$this->name] ?? [],
            fn(array $row): bool => !$this->matches($row, $filter),
        ));
        return new FeatureRouteResult(0, $before - count($GLOBALS['featureRows'][$this->name]));
    }

    public function countDocuments(array $filter = [], array $options = []): int
    {
        return count($this->find($filter, $options));
    }

    private function applyUpdate(array $row, array $update, bool $inserting = false): array
    {
        if (isset($update['$set'])) $row = array_merge($row, $update['$set']);
        if ($inserting && isset($update['$setOnInsert'])) $row = array_merge($row, $update['$setOnInsert']);
        return $row;
    }

    private function matches(array $row, array $filter): bool
    {
        foreach ($filter as $field => $expected) {
            if ($field === '$or') {
                if (!array_filter($expected, fn(array $part): bool => $this->matches($row, $part))) return false;
                continue;
            }
            $actual = $row[$field] ?? null;
            if (is_array($expected) && array_key_exists('$in', $expected)) {
                if (!in_array($actual, $expected['$in'], true)) return false;
            } elseif (is_array($expected) && array_key_exists('$gte', $expected)) {
                if ($actual === null || $actual < $expected['$gte']) return false;
            } elseif (is_array($expected) && array_key_exists('$lt', $expected)) {
                if ($actual === null || $actual >= $expected['$lt']) return false;
            } elseif (is_array($expected) && array_key_exists('$ne', $expected)) {
                if ($actual === $expected['$ne']) return false;
            } elseif ($actual !== $expected) {
                return false;
            }
        }
        return true;
    }
}

require dirname(__DIR__) . '/lib/feature-routes.php';

function featureRouteAssert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

function featureRouteCall(callable $handler, array $args): FeatureRouteResponse
{
    try {
        $handler(...$args);
    } catch (FeatureRouteResponse $response) {
        return $response;
    }
    throw new RuntimeException('The route did not return a response.');
}

function featureSeed(string $table, array $row): void
{
    if (!isset($row['_id'])) $row['_id'] = (string)($row['id'] ?? $row['token_hash'] ?? uniqid('seed_', true));
    $GLOBALS['featureRows'][mongoCollectionName($table)][] = $row;
}

$token = str_repeat('v', 40);
$_SERVER['HTTP_X_CHAT_TOKEN'] = $token;
$visitorPost = featureRouteCall('codexFeatureHandleVisitorChat', [null, '/crm/chat/messages', 'POST', ['message' => 'Hello support.']]);
featureRouteAssert($visitorPost->status === 201, 'Visitor message writes must retain the 201 response.');
featureRouteAssert(count($GLOBALS['featureRows']['legacy_messages'] ?? []) === 1, 'A visitor message should be persisted once.');
featureRouteAssert(count($GLOBALS['featureRows']['legacy_audit_logs'] ?? []) === 1, 'Visitor message writes should retain their audit record.');
$clientId = $GLOBALS['featureRows']['legacy_visitor_chat_sessions'][0]['client_id'];
$invalidVisitorPost = featureRouteCall('codexFeatureHandleVisitorChat', [null, '/crm/chat/messages', 'POST', ['message' => '   ']]);
featureRouteAssert($invalidVisitorPost->status === 422, 'Blank visitor messages must remain invalid.');

$importPayload = ['messages' => [
    ['id' => 'legacy-1', 'message' => 'Imported visitor message'],
    ['id' => 'legacy-2', 'body' => 'Imported agent message', 'sender' => 'operator'],
]];
$firstImport = featureRouteCall('codexFeatureHandleVisitorChat', [null, '/crm/chat/import', 'POST', $importPayload]);
$secondImport = featureRouteCall('codexFeatureHandleVisitorChat', [null, '/crm/chat/import', 'POST', $importPayload]);
featureRouteAssert($firstImport->payload['imported'] === 2, 'Visitor import must report newly imported messages.');
featureRouteAssert($secondImport->payload['imported'] === 0, 'Repeated visitor imports must be idempotent.');
featureRouteAssert(count($GLOBALS['featureRows']['legacy_messages']) === 3, 'Repeated imports must not duplicate messages.');

$passwordHash = password_hash('correct horse battery', PASSWORD_DEFAULT);
featureSeed('staff_users', ['id' => 'admin-1', 'status' => 'Active', 'role' => 'Super Admin', 'password' => $passwordHash, 'deleted_at' => null]);
featureSeed('admin_sessions', ['id' => 'sess-current', 'user_id' => 'admin-1', 'token_hash' => 'keep-me']);
featureSeed('admin_sessions', ['id' => 'sess-other', 'user_id' => 'admin-1', 'token_hash' => 'revoke-me']);
$adminSession = ['id' => 'admin-1', 'token_hash' => 'keep-me'];
$passwordResponse = featureRouteCall('codexFeatureHandlePassword', [
    null, '/admin/me/password', 'PUT',
    ['current_password' => 'correct horse battery', 'new_password' => 'even better passphrase'],
    $adminSession,
]);
featureRouteAssert($passwordResponse->payload['message'] === 'Password updated.', 'Password changes must preserve their success response.');
$storedStaff = mongoFindOne('staff_users', ['id' => 'admin-1']);
featureRouteAssert(password_verify('even better passphrase', (string)$storedStaff['password']), 'The new staff password must be hashed and saved.');
featureRouteAssert(count($GLOBALS['featureRows']['legacy_admin_sessions']) === 1, 'Changing a password must retain only the current admin session.');

$legacyThreadPayload = ['threads' => [[
    'id' => 'legacy-thread-1',
    'visitor_name' => 'Jordan Example',
    'visitor_email' => 'jordan@example.test',
    'notes' => 'Imported context.',
    'messages' => [
        ['id' => 'legacy-thread-message-1', 'body' => 'Legacy question'],
        ['id' => 'legacy-thread-message-2', 'body' => 'Legacy answer', 'sender' => 'agent'],
    ],
]]];
$firstThreadImport = featureRouteCall('codexFeatureHandclientminChat', [
    null, '/admin/messages/threads/import', 'POST', $legacyThreadPayload, $adminSession,
]);
$secondThreadImport = featureRouteCall('codexFeatureHandclientminChat', [
    null, '/admin/messages/threads/import', 'POST', $legacyThreadPayload, $adminSession,
]);
featureRouteAssert($firstThreadImport->payload['imported_threads'] === 1, 'Admin import must report imported threads.');
featureRouteAssert($firstThreadImport->payload['imported_messages'] === 2, 'Admin import must report imported messages.');
featureRouteAssert($secondThreadImport->payload['imported_messages'] === 0, 'Repeated admin imports must not duplicate messages.');

featureSeed('clients', [
    'id' => $clientId, 'name' => 'Website visitor', 'email' => '', 'company' => '',
    'source' => 'website_chat', 'created_at' => date('c'), 'deleted_at' => null,
    'merged_into_client_id' => null,
]);
$threadUpdate = featureRouteCall('codexFeatureHandclientminChat', [
    null, '/admin/messages/threads/' . $clientId, 'PATCH',
    ['status' => 'waiting', 'is_archived' => false, 'notes' => 'Follow up soon.'],
    $adminSession,
]);
featureRouteAssert($threadUpdate->payload['thread']['notes'] === 'Follow up soon.', 'Admin thread actions must save notes.');
featureRouteAssert(mongoFindOne('client_chat_metadata', ['client_id' => $clientId])['status'] === 'waiting', 'Admin thread status must be persisted.');

featureSeed('clients', [
    'id' => 'client-source', 'name' => 'Alex Example', 'email' => 'alex@example.test',
    'phone' => '', 'company' => '', 'source' => 'crm', 'deleted_at' => null,
    'merged_into_client_id' => null,
]);
featureSeed('clients', [
    'id' => 'client-primary', 'name' => 'Alex Example', 'email' => 'alex@example.test',
    'phone' => '', 'company' => '', 'source' => 'crm', 'deleted_at' => null,
    'merged_into_client_id' => null,
]);
featureSeed('client_identity_reviews', [
    'id' => 'review-pair', 'client_id_a' => 'client-primary', 'client_id_b' => 'client-source',
    'status' => 'pending', 'created_at' => date('c'),
]);
featureSeed('client_projects', ['id' => 'project-source', 'client_id' => 'client-source']);
$mergeResponse = featureRouteCall('codexFeatureHandleIdentityReviews', [
    null,
    '/admin/client-identity-reviews/client-primary/client-source',
    'POST',
    ['decision' => 'merge', 'primary_client_id' => 'client-primary'],
    $adminSession,
]);
featureRouteAssert($mergeResponse->payload['status'] === 'merged', 'Identity merge must complete successfully.');
featureRouteAssert(mongoFindOne('clients', ['id' => 'client-source'])['merged_into_client_id'] === 'client-primary', 'The source client must be marked merged.');
featureRouteAssert(mongoFindOne('client_projects', ['id' => 'project-source'])['client_id'] === 'client-primary', 'Related client_id references must be reassigned.');
featureRouteAssert(mongoFindOne('client_identity_reviews', ['id' => 'review-pair'])['status'] === 'merged', 'The reviewed identity pair must be resolved atomically.');

fwrite(STDOUT, "MongoDB feature-route write tests passed without Atlas.\n");
