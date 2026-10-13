<?php

declare(strict_types=1);

final class AdminMongoTestResponse extends RuntimeException
{
    public function __construct(public readonly array $payload, public readonly int $status)
    {
        parent::__construct('Captured route response.');
    }
}

final class AdminMongoTestResult
{
    public function __construct(
        private readonly int $matched = 0,
        private readonly int $deleted = 0,
    ) {
    }

    public function getMatchedCount(): int { return $this->matched; }
    public function getDeletedCount(): int { return $this->deleted; }
}

final class AdminMongoTestSession
{
    private ?array $snapshot = null;

    public function startTransaction(): void
    {
        $GLOBALS['adminMongoTransactions']++;
        if (!empty($GLOBALS['adminMongoFailTransactions'])) throw new RuntimeException('Transactions unavailable.');
        $this->snapshot = $GLOBALS['adminMongoRows'];
    }

    public function commitTransaction(): void { $this->snapshot = null; }

    public function abortTransaction(): void
    {
        if ($this->snapshot !== null) $GLOBALS['adminMongoRows'] = $this->snapshot;
        $this->snapshot = null;
    }

    public function isInTransaction(): bool { return $this->snapshot !== null; }
    public function endSession(): void {}
}

final class AdminMongoTestManager
{
    public function startSession(): AdminMongoTestSession { return new AdminMongoTestSession(); }
}

final class AdminMongoTestDatabase
{
    public function getManager(): AdminMongoTestManager { return new AdminMongoTestManager(); }
}

final class AdminMongoTestCollection
{
    public function __construct(private readonly string $name) {}

    public function findOne(array $filter, array $options = []): ?array
    {
        foreach ($GLOBALS['adminMongoRows'][$this->name] ?? [] as $row) {
            if ($this->matches($row, $filter)) return $row;
        }
        return null;
    }

    public function find(array $filter = [], array $options = []): array
    {
        $rows = array_values(array_filter(
            $GLOBALS['adminMongoRows'][$this->name] ?? [],
            fn(array $row): bool => $this->matches($row, $filter),
        ));
        if (isset($options['sort'])) {
            $sort = $options['sort'];
            usort($rows, static function (array $left, array $right) use ($sort): int {
                foreach ($sort as $field => $direction) {
                    $order = ($left[$field] ?? null) <=> ($right[$field] ?? null);
                    if ($order !== 0) return $order * (int)$direction;
                }
                return 0;
            });
        }
        return isset($options['limit']) ? array_slice($rows, 0, (int)$options['limit']) : $rows;
    }

    public function countDocuments(array $filter = [], array $options = []): int
    {
        return count(array_filter(
            $GLOBALS['adminMongoRows'][$this->name] ?? [],
            fn(array $row): bool => $this->matches($row, $filter),
        ));
    }

    public function insertOne(array $document, array $options = []): AdminMongoTestResult
    {
        $id = $document['_id'] ?? null;
        if ($id === null) throw new RuntimeException('Fake collection requires _id.');
        foreach ($GLOBALS['adminMongoRows'][$this->name] ?? [] as $row) {
            if (($row['_id'] ?? null) === $id) throw new RuntimeException('Duplicate key.', 11000);
        }
        $GLOBALS['adminMongoRows'][$this->name][] = $document;
        return new AdminMongoTestResult(1);
    }

    public function updateOne(array $filter, array $update, array $options = []): AdminMongoTestResult
    {
        foreach ($GLOBALS['adminMongoRows'][$this->name] ?? [] as $index => $row) {
            if (!$this->matches($row, $filter)) continue;
            $GLOBALS['adminMongoRows'][$this->name][$index] = $this->apply($row, $update);
            return new AdminMongoTestResult(1);
        }
        if (!empty($options['upsert'])) {
            $row = $this->apply([], $update);
            foreach ($filter as $field => $value) if (!str_starts_with((string)$field, '$') && !is_array($value)) $row[$field] = $value;
            $row['_id'] = $row['_id'] ?? (string)($row['id'] ?? uniqid('fake_', true));
            $GLOBALS['adminMongoRows'][$this->name][] = $row;
            return new AdminMongoTestResult();
        }
        return new AdminMongoTestResult();
    }

    public function updateMany(array $filter, array $update, array $options = []): AdminMongoTestResult
    {
        $matched = 0;
        foreach ($GLOBALS['adminMongoRows'][$this->name] ?? [] as $index => $row) {
            if (!$this->matches($row, $filter)) continue;
            $GLOBALS['adminMongoRows'][$this->name][$index] = $this->apply($row, $update);
            $matched++;
        }
        return new AdminMongoTestResult($matched);
    }

    public function deleteOne(array $filter, array $options = []): AdminMongoTestResult
    {
        foreach ($GLOBALS['adminMongoRows'][$this->name] ?? [] as $index => $row) {
            if (!$this->matches($row, $filter)) continue;
            array_splice($GLOBALS['adminMongoRows'][$this->name], $index, 1);
            return new AdminMongoTestResult(0, 1);
        }
        return new AdminMongoTestResult();
    }

    public function deleteMany(array $filter, array $options = []): AdminMongoTestResult
    {
        $before = count($GLOBALS['adminMongoRows'][$this->name] ?? []);
        $GLOBALS['adminMongoRows'][$this->name] = array_values(array_filter(
            $GLOBALS['adminMongoRows'][$this->name] ?? [],
            fn(array $row): bool => !$this->matches($row, $filter),
        ));
        return new AdminMongoTestResult(0, $before - count($GLOBALS['adminMongoRows'][$this->name]));
    }

    private function apply(array $row, array $update): array
    {
        foreach ($update['$set'] ?? [] as $key => $value) $row[$key] = $value;
        return $row;
    }

    private function matches(array $row, array $filter): bool
    {
        foreach ($filter as $field => $expected) {
            if ($field === '$and') {
                foreach ($expected as $condition) if (!$this->matches($row, $condition)) return false;
                continue;
            }
            if ($field === '$or') {
                $matched = false;
                foreach ($expected as $condition) if ($this->matches($row, $condition)) { $matched = true; break; }
                if (!$matched) return false;
                continue;
            }
            $actual = $row[$field] ?? null;
            if (!is_array($expected) || array_is_list($expected)) {
                if ($actual !== $expected) return false;
                continue;
            }
            foreach ($expected as $operator => $value) {
                if ($operator === '$ne' && $actual === $value) return false;
                if ($operator === '$in' && !in_array($actual, $value, true)) return false;
                if ($operator === '$nin' && in_array($actual, $value, true)) return false;
                if ($operator === '$gt' && !($actual > $value)) return false;
                if ($operator === '$gte' && !($actual >= $value)) return false;
                if ($operator === '$regex') {
                    $flags = !empty($expected['$options']) && str_contains($expected['$options'], 'i') ? 'i' : '';
                    if (!preg_match('/' . str_replace('/', '\\/', $value) . '/' . $flags, (string)$actual)) return false;
                }
            }
        }
        return true;
    }
}

$GLOBALS['adminMongoRows'] = [];
$GLOBALS['adminMongoTransactions'] = 0;
$GLOBALS['adminMongoFailTransactions'] = false;

function isMongoStorageEnabled(): bool { return true; }
function mongoCollectionName(string $table): string { return 'legacy_' . $table; }
function mongoDocumentToArray(mixed $document): ?array { return is_array($document) ? $document : null; }
function getMongoCollection(string $name): AdminMongoTestCollection { return new AdminMongoTestCollection($name); }
function getMongoDatabase(): AdminMongoTestDatabase
{
    static $database;
    return $database ??= new AdminMongoTestDatabase();
}
function mongoFindOne(string $table, array $filter): ?array
{
    return getMongoCollection(mongoCollectionName($table))->findOne($filter);
}
function mongoFindMany(string $table, array $filter = [], array $options = []): array
{
    return getMongoCollection(mongoCollectionName($table))->find($filter, $options);
}
function mongoRouteCleanRow(array $row): array
{
    unset($row['_id'], $row['_migration_source']);
    return $row;
}
function mongoRouteCleanRows(array $rows): array { return array_map('mongoRouteCleanRow', $rows); }
function mongoRouteDecodeCapabilities(mixed $value): array
{
    if (is_string($value)) return json_decode($value, true) ?: [];
    return is_array($value) ? $value : [];
}
function mongoRouteCount(string $table, array $filter): int
{
    return getMongoCollection(mongoCollectionName($table))->countDocuments($filter);
}
function mongoRouteAdminActor(?array $session): array
{
    $staff = isset($session['id']) ? mongoFindOne('staff_users', ['id' => $session['id'], 'deleted_at' => null]) : null;
    if (!$staff || ($staff['status'] ?? null) !== 'Active') jsonResponse(['ok' => false, 'error' => 'Administrator account is unavailable.'], 401);
    $staff['capabilities'] = mongoRouteDecodeCapabilities($staff['capabilities'] ?? null);
    return $staff;
}
function mongoRouteRequireSuperAdmin(?array $session): array
{
    $actor = mongoRouteAdminActor($session);
    if (($actor['role'] ?? null) !== 'Super Admin') jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can perform this action.'], 403);
    return $actor;
}
function optionalId(mixed $value): ?string
{
    $value = trim((string)($value ?? ''));
    return $value === '' ? null : $value;
}
function jsonResponse(mixed $data, int $status = 200): never
{
    throw new AdminMongoTestResponse(is_array($data) ? $data : [], $status);
}

function adminMongoExpect(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

function adminMongoSeed(string $table, array $row): void
{
    $row['_id'] = $row['_id'] ?? (string)($row['id'] ?? uniqid('seed_', true));
    $GLOBALS['adminMongoRows'][mongoCollectionName($table)][] = $row;
}

function adminMongoRows(string $table): array
{
    return $GLOBALS['adminMongoRows'][mongoCollectionName($table)] ?? [];
}

function adminMongoSeedActor(string $role = 'Super Admin', string $id = 'actor'): void
{
    adminMongoSeed('staff_users', [
        'id' => $id, 'email' => $id . '@example.test', 'name' => 'Admin Actor',
        'role' => $role, 'status' => 'Active', 'office_id' => null, 'team_id' => null,
        'capabilities' => [], 'created_at' => '2026-01-01T00:00:00+00:00', 'deleted_at' => null,
    ]);
}

function adminMongoDispatch(string $path, string $routeMethod, array $routeInput = [], array $query = [], string $actorId = 'actor'): AdminMongoTestResponse
{
    global $apiPath, $adminSession, $input, $method;
    $apiPath = $path;
    $method = $routeMethod;
    $input = $routeInput;
    $_GET = $query;
    $adminSession = ['id' => $actorId];
    try {
        require dirname(__DIR__) . '/routes/09-admin-offices-management.php';
        require dirname(__DIR__) . '/routes/10-admin-teams-management.php';
        require dirname(__DIR__) . '/routes/11-admin-staff.php';
    } catch (AdminMongoTestResponse $response) {
        return $response;
    }
    throw new RuntimeException("Route did not respond for {$routeMethod} {$path}.");
}

function adminMongoRunCase(string $case): void
{
    adminMongoSeedActor();
    $status = 0;
    $payload = [];
    if ($case === 'office-create-manager') {
        $response = adminMongoDispatch('/admin/offices', 'POST', [
            'name' => 'North Office', 'manager_name' => 'Mina Patel',
            'manager_email' => 'MINA@example.test', 'manager_password' => 'secure-pass-12',
        ]);
        adminMongoExpect($response->status === 201, 'Office with a manager must be created with 201.');
        $payload = $response->payload;
        $offices = adminMongoRows('offices');
        $staff = adminMongoRows('staff_users');
        adminMongoExpect(count($offices) === 1 && count($staff) === 2, 'Office and manager must be inserted atomically.');
        adminMongoExpect($offices[0]['manager_id'] === $staff[1]['id'], 'Created office must reference its manager.');
        adminMongoExpect($staff[1]['email'] === 'mina@example.test' && password_verify('secure-pass-12', $staff[1]['password']), 'Manager credentials must be normalized and hashed.');
        adminMongoExpect(!isset($payload['manager']['password']), 'Manager password hashes must not be returned.');
        adminMongoExpect($GLOBALS['adminMongoTransactions'] === 1, 'Office creation with a manager must use one transaction.');
        return;
    }
    if ($case === 'office-soft-delete') {
        adminMongoSeed('offices', ['id' => 'office-1', 'name' => 'HQ', 'created_at' => '2026-01-01', 'deleted_at' => null]);
        adminMongoSeed('teams', ['id' => 'team-1', 'office_id' => 'office-1', 'deleted_at' => null]);
        adminMongoSeed('staff_users', ['id' => 'agent-1', 'name' => 'Agent', 'role' => 'Agent', 'office_id' => 'office-1', 'team_id' => 'team-1', 'status' => 'Active', 'email' => 'agent@example.test', 'deleted_at' => null]);
        adminMongoSeed('clients', ['id' => 'client-1', 'deleted_at' => null, 'assigned_office_id' => 'office-1', 'assigned_team_id' => 'team-1', 'assigned_agent_id' => 'agent-1', 'assigned_team_leader_id' => null, 'assigned_by' => 'old-admin']);
        $response = adminMongoDispatch('/admin/offices/office-1', 'DELETE');
        adminMongoExpect($response->status === 200 && $response->payload['client_ids'] === ['client-1'], 'Office deletion response must include snapshotted clients.');
        adminMongoExpect((adminMongoRows('offices')[0]['deleted_at'] ?? null) !== null, 'Office must be soft-deleted.');
        adminMongoExpect(adminMongoRows('teams')[0]['deleted_scope_type'] === 'office', 'Team must inherit the office deletion scope.');
        adminMongoExpect(adminMongoRows('staff_users')[1]['deleted_scope_type'] === 'office', 'Office staff must inherit the office deletion scope.');
        $client = adminMongoRows('clients')[0];
        adminMongoExpect($client['assigned_agent_id'] === null && $client['assigned_by'] === 'actor', 'Client assignment must be cleared and attributed to the acting admin.');
        adminMongoExpect(count(adminMongoRows('crm_assignment_restore')) === 1, 'Original client assignment must be snapshotted.');
        adminMongoExpect($GLOBALS['adminMongoTransactions'] === 1, 'Cross-document office deletion must be transactional.');
        return;
    }
    if ($case === 'office-restore') {
        adminMongoSeed('offices', ['id' => 'office-1', 'name' => 'HQ', 'deleted_at' => '2026-02-01', 'deleted_scope_type' => null, 'deleted_scope_id' => null]);
        adminMongoSeed('teams', ['id' => 'team-1', 'office_id' => 'office-1', 'deleted_at' => '2026-02-01', 'deleted_scope_type' => 'office', 'deleted_scope_id' => 'office-1']);
        adminMongoSeed('staff_users', ['id' => 'agent-1', 'name' => 'Agent', 'role' => 'Agent', 'office_id' => 'office-1', 'team_id' => 'team-1', 'status' => 'Active', 'email' => 'agent@example.test', 'deleted_at' => '2026-02-01', 'deleted_scope_type' => 'office', 'deleted_scope_id' => 'office-1']);
        adminMongoSeed('clients', ['id' => 'client-1', 'deleted_at' => null, 'assigned_office_id' => null, 'assigned_team_id' => null, 'assigned_agent_id' => null, 'assigned_team_leader_id' => null, 'assigned_by' => 'actor']);
        adminMongoSeed('crm_assignment_restore', ['id' => 'snapshot-1', 'entity_type' => 'office', 'entity_id' => 'office-1', 'client_id' => 'client-1', 'assigned_office_id' => 'office-1', 'assigned_team_id' => 'team-1', 'assigned_agent_id' => 'agent-1', 'assigned_team_leader_id' => null, 'assigned_by' => 'old-admin']);
        $response = adminMongoDispatch('/admin/offices/office-1/restore', 'POST');
        adminMongoExpect($response->status === 200 && $response->payload['office']['id'] === 'office-1', 'Office restore must return the restored office.');
        adminMongoExpect(adminMongoRows('teams')[0]['deleted_at'] === null && adminMongoRows('staff_users')[1]['deleted_at'] === null, 'Office restore must reactivate scoped child records.');
        adminMongoExpect(adminMongoRows('clients')[0]['assigned_agent_id'] === 'agent-1' && adminMongoRows('clients')[0]['assigned_by'] === 'old-admin', 'Restored assignment snapshot must be restored.');
        adminMongoExpect(count(adminMongoRows('crm_assignment_restore')) === 0, 'Consumed assignment snapshots must be removed.');
        return;
    }
    if ($case === 'team-create-leader') {
        adminMongoSeed('offices', ['id' => 'office-1', 'name' => 'HQ', 'deleted_at' => null]);
        $response = adminMongoDispatch('/admin/teams', 'POST', [
            'name' => 'Support', 'office_id' => 'office-1', 'max_size' => 7,
            'leader_name' => 'Taylor', 'leader_email' => 'TAYLOR@example.test', 'leader_password' => 'leader-pass-12',
        ]);
        adminMongoExpect($response->status === 201, 'Team with leader must be created with 201.');
        $team = adminMongoRows('teams')[0];
        $leader = adminMongoRows('staff_users')[1];
        adminMongoExpect($team['leader_id'] === $leader['id'] && $leader['team_id'] === $team['id'], 'Team and leader references must be committed together.');
        adminMongoExpect(password_verify('leader-pass-12', $leader['password']) && $leader['email'] === 'taylor@example.test', 'Leader credentials must be normalized and hashed.');
        return;
    }
    if ($case === 'team-patch-assignments') {
        adminMongoSeed('offices', ['id' => 'office-1', 'name' => 'Old', 'deleted_at' => null]);
        adminMongoSeed('offices', ['id' => 'office-2', 'name' => 'New', 'deleted_at' => null]);
        adminMongoSeed('teams', ['id' => 'team-1', 'name' => 'Ops', 'office_id' => 'office-1', 'leader_id' => null, 'max_size' => 5, 'deleted_at' => null]);
        adminMongoSeed('staff_users', ['id' => 'leader-1', 'name' => 'Lead', 'role' => 'Team Leader', 'office_id' => 'office-1', 'team_id' => null, 'status' => 'Active', 'email' => 'lead@example.test', 'deleted_at' => null]);
        adminMongoSeed('staff_users', ['id' => 'agent-1', 'name' => 'Agent', 'role' => 'Agent', 'office_id' => 'office-1', 'team_id' => 'team-1', 'status' => 'Active', 'email' => 'agent@example.test', 'deleted_at' => null]);
        adminMongoSeed('clients', ['id' => 'client-1', 'deleted_at' => null, 'assigned_office_id' => 'office-1', 'assigned_team_id' => 'team-1']);
        $response = adminMongoDispatch('/admin/teams/team-1', 'PATCH', ['office_id' => 'office-2', 'leader_id' => 'leader-1']);
        adminMongoExpect($response->status === 200, 'Team edit must succeed for a Super Admin.');
        adminMongoExpect(adminMongoRows('teams')[0]['office_id'] === 'office-2' && adminMongoRows('teams')[0]['leader_id'] === 'leader-1', 'Team office and leader must be changed.');
        adminMongoExpect(adminMongoRows('staff_users')[2]['office_id'] === 'office-2' && adminMongoRows('staff_users')[1]['team_id'] === 'team-1', 'Staff assignment references must stay consistent.');
        adminMongoExpect(adminMongoRows('clients')[0]['assigned_office_id'] === 'office-2', 'Assigned clients must follow the team office.');
        adminMongoExpect($GLOBALS['adminMongoTransactions'] === 1, 'Team/staff/client assignment changes must use one transaction.');
        return;
    }
    if ($case === 'team-soft-delete') {
        adminMongoSeed('teams', ['id' => 'team-1', 'name' => 'Ops', 'office_id' => null, 'leader_id' => null, 'max_size' => 5, 'deleted_at' => null]);
        adminMongoSeed('staff_users', ['id' => 'agent-1', 'name' => 'Agent', 'role' => 'Agent', 'office_id' => null, 'team_id' => 'team-1', 'status' => 'Active', 'email' => 'agent@example.test', 'deleted_at' => null]);
        adminMongoSeed('clients', ['id' => 'client-1', 'deleted_at' => null, 'assigned_team_id' => 'team-1', 'assigned_agent_id' => 'agent-1', 'assigned_by' => 'old-admin']);
        $response = adminMongoDispatch('/admin/teams/team-1', 'DELETE');
        adminMongoExpect($response->status === 200 && $response->payload['staff_ids'] === ['agent-1'], 'Team deletion response must include active staff.');
        adminMongoExpect(adminMongoRows('teams')[0]['deleted_scope_type'] === 'team' && adminMongoRows('staff_users')[1]['deleted_scope_id'] === 'team-1', 'Team and members must be soft-deleted in scope.');
        adminMongoExpect(adminMongoRows('clients')[0]['assigned_team_id'] === null && count(adminMongoRows('crm_assignment_restore')) === 1, 'Team client assignments must be snapshotted and cleared.');
        return;
    }
    if ($case === 'team-restore-capacity') {
        adminMongoSeed('teams', ['id' => 'team-1', 'name' => 'Ops', 'office_id' => null, 'leader_id' => null, 'max_size' => 2, 'deleted_at' => '2026-02-01', 'deleted_scope_type' => 'team', 'deleted_scope_id' => 'team-1']);
        adminMongoSeed('staff_users', ['id' => 'agent-1', 'name' => 'Active', 'role' => 'Agent', 'office_id' => null, 'team_id' => 'team-1', 'status' => 'Active', 'email' => 'active@example.test', 'deleted_at' => null]);
        adminMongoSeed('staff_users', ['id' => 'agent-2', 'name' => 'Deleted', 'role' => 'Agent', 'office_id' => null, 'team_id' => 'team-1', 'status' => 'Active', 'email' => 'deleted@example.test', 'deleted_at' => '2026-02-01', 'deleted_scope_type' => 'team', 'deleted_scope_id' => 'team-1']);
        adminMongoSeed('clients', ['id' => 'client-1', 'deleted_at' => null, 'assigned_team_id' => null, 'assigned_agent_id' => null, 'assigned_by' => 'actor']);
        adminMongoSeed('crm_assignment_restore', ['id' => 'snapshot-1', 'entity_type' => 'team', 'entity_id' => 'team-1', 'client_id' => 'client-1', 'assigned_team_id' => 'team-1', 'assigned_agent_id' => 'agent-2', 'assigned_by' => 'old-admin']);
        $response = adminMongoDispatch('/admin/teams/team-1/restore', 'POST');
        adminMongoExpect($response->status === 200, 'Team restore within capacity must succeed.');
        adminMongoExpect(adminMongoRows('staff_users')[2]['deleted_at'] === null, 'Scoped agents must be restored.');
        adminMongoExpect(adminMongoRows('clients')[0]['assigned_agent_id'] === 'agent-2', 'Team restore must restore assignment snapshots.');
        return;
    }
    if ($case === 'staff-create') {
        adminMongoSeed('offices', ['id' => 'office-1', 'name' => 'HQ', 'deleted_at' => null]);
        adminMongoSeed('teams', ['id' => 'team-1', 'name' => 'Ops', 'office_id' => 'office-1', 'max_size' => 3, 'deleted_at' => null]);
        $response = adminMongoDispatch('/admin/staff', 'POST', [
            'name' => 'New Agent', 'email' => 'NEW@example.test', 'password' => 'staff-pass-12',
            'role' => 'Agent', 'team_id' => 'team-1',
        ]);
        adminMongoExpect($response->status === 201, 'Valid staff creation must retain 201.');
        $member = adminMongoRows('staff_users')[1];
        adminMongoExpect($member['email'] === 'new@example.test' && password_verify('staff-pass-12', $member['password']), 'Staff credentials must be normalized and hashed.');
        adminMongoExpect($member['office_id'] === 'office-1' && $member['team_id'] === 'team-1', 'Team office must be inherited by the staff record.');
        return;
    }
    if ($case === 'staff-create-duplicate-email') {
        adminMongoSeed('staff_users', ['id' => 'existing-agent', 'name' => 'Existing', 'role' => 'Agent', 'status' => 'Active', 'email' => 'duplicate@example.test', 'deleted_at' => null]);
        $response = adminMongoDispatch('/admin/staff', 'POST', [
            'name' => 'New Agent', 'email' => 'DUPLICATE@example.test', 'password' => 'staff-pass-12', 'role' => 'Agent',
        ]);
        adminMongoExpect($response->status === 409 && $response->payload['error'] === 'That email address is already in use.', 'Mongo email uniqueness must return the established conflict response.');
        adminMongoExpect(count(adminMongoRows('staff_users')) === 2, 'Duplicate email rejection must not insert a staff row.');
        return;
    }
    if ($case === 'team-capacity-rejection') {
        adminMongoSeed('teams', ['id' => 'team-1', 'name' => 'Full', 'office_id' => null, 'max_size' => 1, 'deleted_at' => null]);
        adminMongoSeed('staff_users', ['id' => 'agent-1', 'name' => 'Existing', 'role' => 'Agent', 'status' => 'Active', 'email' => 'existing@example.test', 'team_id' => 'team-1', 'deleted_at' => null]);
        $response = adminMongoDispatch('/admin/staff', 'POST', [
            'name' => 'New Agent', 'email' => 'new@example.test', 'password' => 'staff-pass-12', 'role' => 'Agent', 'team_id' => 'team-1',
        ]);
        adminMongoExpect($response->status === 409 && $response->payload['error'] === 'This team is at capacity.', 'Mongo staff creation must enforce team capacity.');
        adminMongoExpect(count(adminMongoRows('staff_users')) === 2, 'Rejected capacity changes must not create staff.');
        return;
    }
    if ($case === 'team-create-role-permission') {
        $GLOBALS['adminMongoRows'][mongoCollectionName('staff_users')][0]['role'] = 'Agent';
        $response = adminMongoDispatch('/admin/teams', 'POST', ['name' => 'Unauthorized']);
        adminMongoExpect($response->status === 403 && $response->payload['error'] === 'Your role cannot create teams.', 'Team creation must preserve role permissions.');
        adminMongoExpect(adminMongoRows('teams') === [], 'Forbidden team creation must not write.');
        return;
    }
    if ($case === 'staff-patch-assignments') {
        adminMongoSeed('offices', ['id' => 'office-1', 'name' => 'Old', 'deleted_at' => null]);
        adminMongoSeed('offices', ['id' => 'office-2', 'name' => 'New', 'deleted_at' => null]);
        adminMongoSeed('teams', ['id' => 'team-1', 'name' => 'Old team', 'office_id' => 'office-1', 'deleted_at' => null]);
        adminMongoSeed('teams', ['id' => 'team-2', 'name' => 'New team', 'office_id' => 'office-2', 'deleted_at' => null]);
        adminMongoSeed('staff_users', ['id' => 'agent-1', 'name' => 'Agent', 'role' => 'Agent', 'office_id' => 'office-1', 'team_id' => 'team-1', 'status' => 'Active', 'email' => 'agent@example.test', 'deleted_at' => null]);
        adminMongoSeed('clients', ['id' => 'client-1', 'deleted_at' => null, 'assigned_office_id' => 'office-1', 'assigned_team_id' => 'team-1', 'assigned_agent_id' => 'agent-1']);
        $response = adminMongoDispatch('/admin/staff/agent-1', 'PATCH', ['office_id' => 'office-2', 'team_id' => 'team-2', 'name' => 'Changed']);
        adminMongoExpect($response->status === 200, 'Super Admin staff reassignment must succeed.');
        adminMongoExpect(adminMongoRows('staff_users')[1]['office_id'] === 'office-2' && adminMongoRows('staff_users')[1]['team_id'] === 'team-2', 'Staff links must be updated.');
        adminMongoExpect(adminMongoRows('clients')[0]['assigned_office_id'] === 'office-2' && adminMongoRows('clients')[0]['assigned_team_id'] === 'team-2', 'Client assignments must track an agent move.');
        adminMongoExpect($GLOBALS['adminMongoTransactions'] === 1, 'Staff/client assignment updates must be transactional.');
        return;
    }
    if ($case === 'staff-capabilities-audit') {
        adminMongoSeed('staff_users', ['id' => 'agent-1', 'name' => 'Agent', 'role' => 'Agent', 'office_id' => null, 'team_id' => null, 'status' => 'Active', 'email' => 'agent@example.test', 'capabilities' => ['notifications' => false], 'deleted_at' => null]);
        $response = adminMongoDispatch('/admin/staff/agent-1/capabilities', 'PUT', ['capabilities' => ['create_agent' => false]]);
        adminMongoExpect($response->status === 200 && $response->payload['capabilities']['create_agent'] === false, 'Capability update must return the merged capability set.');
        adminMongoExpect($response->payload['capabilities']['notifications'] === false && $response->payload['capabilities']['chat'] === true, 'Existing values and defaults must be preserved.');
        $audit = adminMongoRows('audit_logs');
        adminMongoExpect(count($audit) === 1 && $audit[0]['action'] === 'STAFF_CAPABILITIES_UPDATED' && $audit[0]['user_id'] === 'agent-1', 'Capability edits must retain SQL audit behavior.');
        return;
    }
    if ($case === 'staff-soft-delete') {
        adminMongoSeed('staff_users', ['id' => 'agent-1', 'name' => 'Agent', 'role' => 'Agent', 'office_id' => null, 'team_id' => null, 'status' => 'Active', 'email' => 'agent@example.test', 'deleted_at' => null]);
        adminMongoSeed('admin_sessions', ['id' => 'session-1', 'user_id' => 'agent-1']);
        adminMongoSeed('clients', ['id' => 'client-1', 'deleted_at' => null, 'assigned_agent_id' => 'agent-1', 'assigned_by' => 'old-admin']);
        $response = adminMongoDispatch('/admin/staff/agent-1', 'DELETE');
        adminMongoExpect($response->status === 200 && $response->payload['client_ids'] === ['client-1'], 'Staff delete must report affected clients.');
        adminMongoExpect(adminMongoRows('staff_users')[1]['deleted_scope_type'] === 'staff', 'Staff deletion must use staff scope.');
        adminMongoExpect(count(adminMongoRows('admin_sessions')) === 0 && adminMongoRows('clients')[0]['assigned_agent_id'] === null, 'Staff sessions and client assignments must be cleared together.');
        return;
    }
    if ($case === 'staff-permanent-delete') {
        adminMongoSeed('staff_users', ['id' => 'agent-1', 'name' => 'Agent', 'role' => 'Agent', 'office_id' => null, 'team_id' => null, 'status' => 'Active', 'email' => 'agent@example.test', 'deleted_at' => '2026-02-01', 'deleted_scope_type' => 'staff', 'deleted_scope_id' => 'agent-1']);
        adminMongoSeed('admin_sessions', ['id' => 'session-1', 'user_id' => 'agent-1']);
        adminMongoSeed('clients', ['id' => 'client-1', 'deleted_at' => null, 'assigned_agent_id' => 'agent-1', 'assigned_office_id' => 'office-1', 'assigned_by' => 'old-admin']);
        adminMongoSeed('crm_assignment_restore', ['id' => 'snapshot-1', 'entity_type' => 'staff', 'entity_id' => 'agent-1', 'client_id' => 'client-1']);
        $response = adminMongoDispatch('/admin/staff/agent-1', 'DELETE', [], ['permanent' => '1']);
        adminMongoExpect($response->status === 200 && $response->payload === ['ok' => true], 'Permanent staff removal must retain its exact response.');
        adminMongoExpect(count(adminMongoRows('staff_users')) === 1 && count(adminMongoRows('admin_sessions')) === 0, 'Permanent removal must remove the staff record and sessions.');
        adminMongoExpect(adminMongoRows('clients')[0]['assigned_agent_id'] === null && adminMongoRows('clients')[0]['assigned_by'] === null, 'Permanent removal must clear all client assignment fields.');
        adminMongoExpect(count(adminMongoRows('crm_assignment_restore')) === 0, 'Permanent removal must discard staff restore snapshots.');
        return;
    }
    if ($case === 'staff-restore') {
        adminMongoSeed('staff_users', ['id' => 'agent-1', 'name' => 'Agent', 'role' => 'Agent', 'office_id' => null, 'team_id' => null, 'status' => 'Active', 'email' => 'agent@example.test', 'deleted_at' => '2026-02-01', 'deleted_scope_type' => 'staff', 'deleted_scope_id' => 'agent-1']);
        adminMongoSeed('clients', ['id' => 'client-1', 'deleted_at' => null, 'assigned_agent_id' => null, 'assigned_by' => 'actor']);
        adminMongoSeed('crm_assignment_restore', ['id' => 'snapshot-1', 'entity_type' => 'staff', 'entity_id' => 'agent-1', 'client_id' => 'client-1', 'assigned_agent_id' => 'agent-1', 'assigned_by' => 'old-admin']);
        $response = adminMongoDispatch('/admin/staff/agent-1/restore', 'POST');
        adminMongoExpect($response->status === 200 && adminMongoRows('staff_users')[1]['deleted_at'] === null, 'Staff restore must activate the target.');
        adminMongoExpect(adminMongoRows('clients')[0]['assigned_agent_id'] === 'agent-1', 'Staff restore must restore assignment snapshots.');
        return;
    }
    if ($case === 'last-super-admin-block') {
        $response = adminMongoDispatch('/admin/staff/actor/block', 'POST');
        adminMongoExpect($response->status === 409 && $response->payload['error'] === 'You cannot suspend your own Super Admin account.', 'Super Admins must not be able to suspend their own account.');
        adminMongoExpect(adminMongoRows('staff_users')[0]['status'] === 'Active', 'Rejected last-admin action must not mutate the account.');
        return;
    }
    if ($case === 'transaction-failure-fails-closed') {
        $GLOBALS['adminMongoFailTransactions'] = true;
        try {
            adminMongoDispatch('/admin/offices', 'POST', [
                'name' => 'No partial writes', 'manager_name' => 'Mina',
                'manager_email' => 'mina@example.test', 'manager_password' => 'manager-pass-12',
            ]);
        } catch (RuntimeException $error) {
            adminMongoExpect($error->getMessage() === 'Transactions unavailable.', 'Unexpected transaction failure.');
        }
        adminMongoExpect(adminMongoRows('offices') === [] && count(adminMongoRows('staff_users')) === 1, 'Unavailable transactions must fail before any office or manager write.');
        return;
    }

    throw new RuntimeException("Unknown test case: {$case}");
}

if (isset($argv[1])) {
    adminMongoRunCase($argv[1]);
    fwrite(STDOUT, "Passed {$argv[1]}.\n");
    exit(0);
}

$cases = [
    'office-create-manager',
    'office-soft-delete',
    'office-restore',
    'team-create-leader',
    'team-patch-assignments',
    'team-soft-delete',
    'team-restore-capacity',
    'staff-create',
    'staff-create-duplicate-email',
    'team-capacity-rejection',
    'team-create-role-permission',
    'staff-patch-assignments',
    'staff-capabilities-audit',
    'staff-soft-delete',
    'staff-permanent-delete',
    'staff-restore',
    'last-super-admin-block',
    'transaction-failure-fails-closed',
];
foreach ($cases as $case) {
    $command = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' ' . escapeshellarg($case);
    $process = proc_open($command, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    if (!is_resource($process)) throw new RuntimeException("Could not start test case {$case}.");
    fclose($pipes[0]);
    $stdout = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $exitCode = proc_close($process);
    if ($exitCode !== 0) throw new RuntimeException("{$case} failed: {$stdout}{$stderr}");
    fwrite(STDOUT, trim($stdout) . "\n");
}
fwrite(STDOUT, "All MongoDB admin office/team/staff route tests passed without a database.\n");
