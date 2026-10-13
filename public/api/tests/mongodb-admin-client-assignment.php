<?php
declare(strict_types=1);

final class AssignmentRouteResponse extends RuntimeException
{
    public function __construct(public readonly array $payload, public readonly int $status)
    {
        parent::__construct('Captured route response.');
    }
}

final class AssignmentRouteSession
{
    public bool $active = false;

    public function startTransaction(): void { $this->active = true; }
    public function commitTransaction(): void { $this->active = false; }
    public function abortTransaction(): void { $this->active = false; }
    public function endSession(): void { $this->active = false; }
}

final class AssignmentRouteManager
{
    public function startSession(): AssignmentRouteSession { return new AssignmentRouteSession(); }
}

final class AssignmentRouteDatabase
{
    public function getManager(): AssignmentRouteManager { return new AssignmentRouteManager(); }
}

final class AssignmentRouteResult
{
    public function __construct(private readonly int $count) {}
    public function getMatchedCount(): int { return $this->count; }
    public function getDeletedCount(): int { return $this->count; }
}

final class AssignmentRouteCollection
{
    public function __construct(private readonly string $table) {}

    private function matches(array $row, array $filter): bool
    {
        foreach ($filter as $field => $expected) {
            if ($field === '$or') {
                $match = false;
                foreach ($expected as $clause) $match = $match || $this->matches($row, $clause);
                if (!$match) return false;
                continue;
            }
            $actual = $row[$field] ?? null;
            if (is_array($expected)) {
                foreach ($expected as $operator => $value) {
                    if ($operator === '$in' && !in_array($actual, $value, true)) return false;
                    if ($operator === '$ne' && $actual === $value) return false;
                    if ($operator === '$regex') {
                        $flags = (($expected['$options'] ?? '') === 'i') ? 'i' : '';
                        if (!preg_match('/' . $value . '/' . $flags, (string)$actual)) return false;
                    }
                }
            } elseif ($actual !== $expected) {
                return false;
            }
        }
        return true;
    }

    private function apply(array &$row, array $update): void
    {
        foreach (($update['$set'] ?? []) as $field => $value) $row[$field] = $value;
    }

    public function findOne(array $filter, array $options = []): ?array
    {
        foreach ($GLOBALS['assignmentRows'][$this->table] ?? [] as $row) {
            if ($this->matches($row, $filter)) return $row;
        }
        return null;
    }

    public function find(array $filter = [], array $options = []): array
    {
        $rows = array_values(array_filter(
            $GLOBALS['assignmentRows'][$this->table] ?? [],
            fn($row) => $this->matches($row, $filter),
        ));
        return $rows;
    }

    public function updateOne(array $filter, array $update, array $options = []): AssignmentRouteResult
    {
        foreach ($GLOBALS['assignmentRows'][$this->table] ?? [] as $index => $row) {
            if (!$this->matches($row, $filter)) continue;
            $this->apply($GLOBALS['assignmentRows'][$this->table][$index], $update);
            return new AssignmentRouteResult(1);
        }
        return new AssignmentRouteResult(0);
    }

    public function updateMany(array $filter, array $update, array $options = []): AssignmentRouteResult
    {
        $matched = 0;
        foreach ($GLOBALS['assignmentRows'][$this->table] ?? [] as $index => $row) {
            if (!$this->matches($row, $filter)) continue;
            $this->apply($GLOBALS['assignmentRows'][$this->table][$index], $update);
            $matched++;
        }
        return new AssignmentRouteResult($matched);
    }

    public function insertOne(array $document, array $options = []): void
    {
        $GLOBALS['assignmentRows'][$this->table][] = $document;
    }

    public function deleteOne(array $filter, array $options = []): AssignmentRouteResult
    {
        foreach ($GLOBALS['assignmentRows'][$this->table] ?? [] as $index => $row) {
            if (!$this->matches($row, $filter)) continue;
            array_splice($GLOBALS['assignmentRows'][$this->table], $index, 1);
            return new AssignmentRouteResult(1);
        }
        return new AssignmentRouteResult(0);
    }

    public function deleteMany(array $filter, array $options = []): AssignmentRouteResult
    {
        $before = count($GLOBALS['assignmentRows'][$this->table] ?? []);
        $GLOBALS['assignmentRows'][$this->table] = array_values(array_filter(
            $GLOBALS['assignmentRows'][$this->table] ?? [],
            fn($row) => !$this->matches($row, $filter),
        ));
        return new AssignmentRouteResult($before - count($GLOBALS['assignmentRows'][$this->table]));
    }

    public function countDocuments(array $filter = []): int
    {
        return count($this->find($filter));
    }
}

function isMongoStorageEnabled(): bool { return true; }
function jsonResponse(mixed $data, int $status = 200): never { throw new AssignmentRouteResponse($data, $status); }
function optionalId(mixed $value): ?string { $value = trim((string)($value ?? '')); return $value === '' ? null : $value; }
function normalizeClientRow(array $client): array
{
    foreach (['comment_history', 'status_history', 'appointments'] as $field) {
        if (is_string($client[$field] ?? null)) {
            $decoded = json_decode($client[$field], true);
            $client[$field] = is_array($decoded) ? $decoded : [];
        } elseif (!is_array($client[$field] ?? null)) $client[$field] = [];
    }
    return $client;
}
function mongoRouteCleanRow(array $row): array { unset($row['_id'], $row['_migration_source']); return $row; }
function mongoRouteAdminActor(?array $session): array { return $GLOBALS['assignmentActor']; }
function mongoRouteActorCanViewClient(array $actor, array $client): bool
{
    if (($actor['role'] ?? '') === 'Super Admin') return true;
    if (($actor['role'] ?? '') === 'Office Manager') return ($client['assigned_office_id'] ?? null) === ($actor['office_id'] ?? null);
    if (($actor['role'] ?? '') === 'Team Leader') {
        return ($client['assigned_team_id'] ?? null) === ($actor['team_id'] ?? null)
            || ($client['assigned_team_leader_id'] ?? null) === ($actor['id'] ?? null);
    }
    return ($actor['role'] ?? '') === 'Agent' && ($client['assigned_agent_id'] ?? null) === ($actor['id'] ?? null);
}
function mongoRouteCount(string $table, array $filter): int { return count(mongoFindMany($table, $filter)); }
function mongoDocumentToArray(mixed $document): ?array { return is_array($document) ? $document : null; }
function mongoCollectionName(string $table): string { return 'legacy_' . $table; }
function getMongoDatabase(): AssignmentRouteDatabase { return new AssignmentRouteDatabase(); }
function getMongoCollection(string $collection): AssignmentRouteCollection
{
    return new AssignmentRouteCollection(substr($collection, strlen('legacy_')));
}
function assignmentRowsMatch(array $row, array $filter): bool
{
    foreach ($filter as $field => $value) {
        if (is_array($value) && isset($value['$in'])) {
            if (!in_array($row[$field] ?? null, $value['$in'], true)) return false;
        } elseif (($row[$field] ?? null) !== $value) return false;
    }
    return true;
}
function mongoFindOne(string $table, array $filter): ?array
{
    foreach ($GLOBALS['assignmentRows'][$table] ?? [] as $row) {
        if (assignmentRowsMatch($row, $filter)) return $row;
    }
    return null;
}
function mongoFindMany(string $table, array $filter = [], array $options = []): array
{
    $rows = [];
    foreach ($GLOBALS['assignmentRows'][$table] ?? [] as $row) {
        if (assignmentRowsMatch($row, $filter)) $rows[] = $row;
    }
    return $rows;
}
function mongoDelete(string $table, array $filter): int
{
    return getMongoCollection(mongoCollectionName($table))->deleteMany($filter)->getDeletedCount();
}

function assignmentExpect(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$GLOBALS['assignmentRows'] = [
    'clients' => [[
        '_id' => 'migration-client',
        'id' => 'client-1',
        'name' => 'Avery Client',
        'deleted_at' => null,
        'assigned_office_id' => null,
        'assigned_team_id' => null,
        'assigned_team_leader_id' => null,
        'assigned_agent_id' => null,
        'comment_history' => '[]',
        'status_history' => '[]',
    ]],
    'offices' => [['id' => 'office-1', 'deleted_at' => null]],
    'teams' => [['id' => 'team-1', 'office_id' => 'office-1', 'deleted_at' => null]],
    'staff_users' => [[
        'id' => 'agent-1',
        'name' => 'Jordan Agent',
        'role' => 'Agent',
        'office_id' => 'office-1',
        'team_id' => 'team-1',
        'deleted_at' => null,
    ]],
    'client_assignment_history' => [],
];
$GLOBALS['assignmentActor'] = ['id' => 'admin-1', 'name' => 'Admin', 'role' => 'Super Admin'];
$apiPath = '/admin/clients/client-1/assign';
$method = 'POST';
$input = ['office_id' => 'office-1', 'team_id' => 'team-1', 'agent_id' => 'agent-1'];
$adminSession = ['id' => 'admin-1'];
$pdo = null;

try {
    require dirname(__DIR__) . '/routes/12-admin-client-assignment.php';
} catch (AssignmentRouteResponse $response) {
    assignmentExpect($response->status === 200, 'A valid client assignment must return HTTP 200.');
    assignmentExpect(($response->payload['ok'] ?? false) === true, 'The assignment response must report success.');
    assignmentExpect(($response->payload['client']['assigned_agent_name'] ?? null) === 'Jordan Agent', 'The joined assigned-agent name must remain in the response.');
}

assignmentExpect(($GLOBALS['assignmentRows']['clients'][0]['assigned_agent_id'] ?? null) === 'agent-1', 'The MongoDB client document must receive the normalized assignment.');
assignmentExpect(count($GLOBALS['assignmentRows']['client_assignment_history']) === 1, 'Assignment history must be persisted with the client update.');
$history = $GLOBALS['assignmentRows']['client_assignment_history'][0];
assignmentExpect(json_decode($history['previous_assignment'], true)['agent_id'] === null, 'The history row must preserve the prior assignment.');
assignmentExpect(json_decode($history['new_assignment'], true)['agent_id'] === 'agent-1', 'The history row must persist the new assignment.');
assignmentExpect(!isset($response->payload['client']['_id']), 'Mongo storage metadata must not escape in client responses.');

try {
    adminAssignmentMongoResolve(['team_id' => 'missing-team']);
    throw new RuntimeException('Unknown MongoDB teams must be rejected.');
} catch (AssignmentRouteResponse $response) {
    assignmentExpect($response->status === 422, 'Unknown assignment targets must preserve the SQL 422 status.');
}
assignmentExpect(
    !mongoRouteActorCanViewClient(
        ['id' => 'agent-2', 'role' => 'Agent'],
        ['assigned_agent_id' => 'agent-1'],
    ),
    'Agent visibility must remain scoped to assigned clients.',
);

fwrite(STDOUT, "MongoDB admin client-assignment route validation passed.\n");
