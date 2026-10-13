<?php
/** Route group: ADMIN: TEAMS MANAGEMENT (included by index.php in order; uses its request globals). */

declare(strict_types=1);

function mongoTeamTransaction(callable $operation): mixed {
    $session = getMongoDatabase()->getManager()->startSession();
    try {
        $session->startTransaction();
        $result = $operation($session);
        if (is_array($result) && array_key_exists('__abort', $result)) {
            $session->abortTransaction();
            return $result;
        }
        $session->commitTransaction();
        return $result;
    } catch (Throwable $error) {
        if ($session->isInTransaction()) $session->abortTransaction();
        throw $error;
    } finally {
        $session->endSession();
    }
}

function mongoTeamFindOne(string $table, array $filter, object $session): ?array {
    return mongoDocumentToArray(getMongoCollection(mongoCollectionName($table))->findOne($filter, ['session' => $session]));
}

function mongoTeamFindMany(string $table, array $filter, object $session, array $options = []): array {
    $options['session'] = $session;
    $rows = [];
    foreach (getMongoCollection(mongoCollectionName($table))->find($filter, $options) as $document) {
        $row = mongoDocumentToArray($document);
        if ($row !== null) $rows[] = $row;
    }
    return $rows;
}

function mongoTeamInsert(string $table, array $document, object $session): void {
    $document['_id'] = $document['_id'] ?? (string)$document['id'];
    getMongoCollection(mongoCollectionName($table))->insertOne($document, ['session' => $session]);
}

function mongoTeamEmailInUse(string $email, ?string $excludeId, object $session): bool {
    $filter = ['email' => ['$regex' => '^\\s*' . preg_quote(strtolower(trim($email)), '/') . '\\s*$', '$options' => 'i']];
    if ($excludeId !== null) $filter['id'] = ['$ne' => $excludeId];
    return mongoTeamFindOne('staff_users', $filter, $session) !== null;
}

function mongoTeamClaim(string $key, string $ownerId, object $session): bool {
    $locks = getMongoCollection('legacy_admin_constraint_locks');
    $lock = mongoDocumentToArray($locks->findOne(['_id' => $key], ['session' => $session]));
    if ($lock && ($lock['owner_id'] ?? null) !== $ownerId) return false;
    if (!$lock) {
        try {
            $locks->insertOne(['_id' => $key, 'owner_id' => $ownerId], ['session' => $session]);
        } catch (Throwable $error) {
            if ((int)$error->getCode() === 11000) return false;
            throw $error;
        }
    }
    else $locks->updateOne(['_id' => $key], ['$set' => ['owner_id' => $ownerId]], ['session' => $session]);
    return true;
}

function mongoTeamRelease(string $key, string $ownerId, object $session): void {
    getMongoCollection('legacy_admin_constraint_locks')->deleteOne(['_id' => $key, 'owner_id' => $ownerId], ['session' => $session]);
}

function mongoTeamSnapshotClear(string $teamId, array $staffIds, string $actorId, object $session): array {
    $conditions = [['assigned_team_id' => $teamId]];
    if ($staffIds) {
        $conditions[] = ['assigned_agent_id' => ['$in' => $staffIds]];
        $conditions[] = ['assigned_team_leader_id' => ['$in' => $staffIds]];
    }
    return mongoOfficeSnapshotClear('team', $teamId, ['$or' => $conditions], $actorId, $session);
}

if (isMongoStorageEnabled()) {
    if ($apiPath === '/admin/teams') {
        $actor = mongoRouteAdminActor($adminSession);
        $includeDeleted = (string)($_GET['include_deleted'] ?? '');
        if ($includeDeleted !== '' && $actor['role'] !== 'Super Admin') {
            jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can view deleted teams.'], 403);
        }
        if ($method === 'POST') {
            if (!in_array($actor['role'], ['Super Admin', 'Office Manager'], true)) jsonResponse(['ok' => false, 'error' => 'Your role cannot create teams.'], 403);
            $name = trim((string)($input['name'] ?? ''));
            if ($name === '') jsonResponse(['ok' => false, 'error' => 'Team name is required.'], 400);
            $officeId = optionalId($input['office_id'] ?? null);
            if ($actor['role'] === 'Office Manager') {
                $officeId = optionalId($actor['office_id'] ?? null);
                if ($officeId === null) jsonResponse(['ok' => false, 'error' => 'Your account is not assigned to an office.'], 403);
            }
            if ($officeId !== null && !mongoFindOne('offices', ['id' => $officeId, 'deleted_at' => null])) jsonResponse(['ok' => false, 'error' => 'The selected office is unavailable.'], 422);
            $maxSize = array_key_exists('max_size', $input) ? ($input['max_size'] === null || $input['max_size'] === '' ? null : (int)$input['max_size']) : 10;
            if ($maxSize !== null && $maxSize < 1) jsonResponse(['ok' => false, 'error' => 'Team capacity must be at least 1 or left unlimited.'], 422);
            $teamId = 'tm_' . bin2hex(random_bytes(8));
            $leaderName = trim((string)($input['leader_name'] ?? 'Unassigned')) ?: 'Unassigned';
            $leaderEmail = strtolower(trim((string)($input['leader_email'] ?? '')));
            $leaderPassword = (string)($input['leader_password'] ?? '');
            if ($leaderPassword !== '' && strlen($leaderPassword) < 8) jsonResponse(['ok' => false, 'error' => 'Staff passwords must be at least 8 characters.'], 422);
            if ($leaderPassword !== '' && $leaderName === 'Unassigned') jsonResponse(['ok' => false, 'error' => 'A team leader name is required when setting a password.'], 422);
            $leaderId = null;
            $leader = null;
            $hash = null;
            if ($leaderPassword !== '') {
                $leaderId = 'adm_' . bin2hex(random_bytes(8));
                $leaderEmail = $leaderEmail ?: 'leader_' . substr($leaderId, 4) . '@codexdynamics.com';
                if (!filter_var($leaderEmail, FILTER_VALIDATE_EMAIL)) jsonResponse(['ok' => false, 'error' => 'Enter a valid leader email address.'], 422);
                $hash = password_hash($leaderPassword, PASSWORD_DEFAULT);
                if ($hash === false) jsonResponse(['ok' => false, 'error' => 'Could not securely save the staff password.'], 500);
            }
            $now = date('c');
            $result = mongoTeamTransaction(static function (object $session) use ($teamId, $name, $officeId, $maxSize, $leaderId, $leaderName, $leaderEmail, $hash, $now): array {
                if ($leaderId !== null) {
                    if (mongoTeamEmailInUse($leaderEmail, null, $session)
                        || !mongoTeamClaim('email:' . $leaderEmail, $leaderId, $session)
                        || !mongoTeamClaim('team_leader:' . $teamId, $leaderId, $session)) {
                        return ['__abort' => true, 'conflict' => 'email'];
                    }
                    mongoTeamInsert('staff_users', [
                        'id' => $leaderId, 'email' => $leaderEmail, 'password' => $hash, 'name' => $leaderName,
                        'role' => 'Team Leader', 'office_id' => $officeId, 'team_id' => $teamId,
                        'status' => 'Active',
                        'capabilities' => ['client_upload' => true, 'create_agent' => true, 'registrations' => true, 'notifications' => true, 'content' => true, 'enquiries' => true, 'chat' => true],
                        'created_at' => $now, 'deleted_at' => null,
                    ], $session);
                }
                mongoTeamInsert('teams', [
                    'id' => $teamId, 'name' => $name, 'office_id' => $officeId,
                    'leader_id' => $leaderId, 'leader_name' => $leaderId ? $leaderName : null,
                    'max_size' => $maxSize, 'created_at' => $now, 'deleted_at' => null,
                ], $session);
                return [];
            });
            if (isset($result['conflict'])) jsonResponse(['ok' => false, 'error' => $result['conflict'] === 'email' ? 'That email address is already in use.' : 'This team already has a Team Leader.'], 409);
            if ($leaderId !== null) {
                $leader = ['id' => $leaderId, 'name' => $leaderName, 'email' => $leaderEmail, 'role' => 'Team Leader', 'office_id' => $officeId, 'team_id' => $teamId, 'status' => 'Active', 'capabilities' => ['client_upload' => true, 'create_agent' => true, 'registrations' => true, 'notifications' => true, 'content' => true, 'enquiries' => true, 'chat' => true], 'created_at' => $now];
            }
            jsonResponse(['ok' => true, 'team' => ['id' => $teamId, 'name' => $name, 'office_id' => $officeId, 'leader_id' => $leaderId, 'leader_name' => $leaderId ? $leaderName : null, 'max_size' => $maxSize, 'agent_count' => 0, 'client_count' => 0, 'created_at' => $now], 'leader' => $leader], 201);
        }
        if ($method !== 'GET') jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
        $filter = $includeDeleted === 'only'
            ? ['deleted_at' => ['$ne' => null], 'deleted_scope_type' => 'team']
            : ($includeDeleted === '1' ? [] : ['deleted_at' => null]);
        if ($actor['role'] === 'Office Manager') {
            $officeId = optionalId($actor['office_id'] ?? null);
            if ($officeId === null) jsonResponse(['ok' => true, 'teams' => []]);
            $filter['office_id'] = $officeId;
        } elseif ($actor['role'] === 'Team Leader' || $actor['role'] === 'Agent') {
            $teamId = optionalId($actor['team_id'] ?? null);
            if ($teamId === null) jsonResponse(['ok' => true, 'teams' => []]);
            $filter['id'] = $teamId;
        } elseif ($actor['role'] === 'Super Admin' && !empty($_GET['office_id'])) {
            $filter['office_id'] = (string)$_GET['office_id'];
        }
        $teams = mongoFindMany('teams', $filter, ['sort' => ['created_at' => -1]]);
        foreach ($teams as &$team) {
            $team['agent_count'] = mongoRouteCount('staff_users', ['team_id' => $team['id'], 'role' => 'Agent', 'deleted_at' => null]);
            $team['client_count'] = mongoRouteCount('clients', ['assigned_team_id' => $team['id'], 'deleted_at' => null]);
            $team = mongoRouteCleanRow($team);
        }
        unset($team);
        jsonResponse(['ok' => true, 'teams' => $teams]);
    }

    if (preg_match('#^/admin/teams/([^/]+)/restore$#', $apiPath, $match) && $method === 'POST') {
        mongoRouteRequireSuperAdmin($adminSession);
        $teamId = rawurldecode($match[1]);
        $team = mongoFindOne('teams', ['id' => $teamId, 'deleted_at' => ['$ne' => null], 'deleted_scope_type' => 'team']);
        if (!$team) jsonResponse(['ok' => false, 'error' => 'Deleted team not found. Restore its office first if the office was deleted.'], 404);
        if (!empty($team['office_id']) && !mongoFindOne('offices', ['id' => $team['office_id'], 'deleted_at' => null])) {
            jsonResponse(['ok' => false, 'error' => 'Restore the parent office before restoring this team.'], 409);
        }
        $result = mongoTeamTransaction(static function (object $session) use ($teamId, $team): array {
            $staffCollection = getMongoCollection(mongoCollectionName('staff_users'));
            $members = mongoTeamFindMany('staff_users', ['deleted_scope_type' => 'team', 'deleted_scope_id' => $teamId], $session);
            $restoringAgents = count(array_filter($members, static fn(array $member): bool => ($member['role'] ?? null) === 'Agent'));
            if (!mongoTeamClaim('team_capacity:' . $teamId, 'team-capacity-guard', $session)) return ['__abort' => true, 'conflict' => 'capacity'];
            $activeAgents = getMongoCollection(mongoCollectionName('staff_users'))->countDocuments(['team_id' => $teamId, 'role' => 'Agent', 'deleted_at' => null], ['session' => $session]);
            if ($team['max_size'] !== null && $activeAgents + $restoringAgents > (int)$team['max_size']) return ['__abort' => true, 'conflict' => 'capacity'];
            foreach ($members as $member) {
                if (($member['role'] ?? null) === 'Team Leader'
                    && !mongoTeamClaim('team_leader:' . $teamId, (string)$member['id'], $session)) return ['__abort' => true, 'conflict' => 'leader'];
            }
            getMongoCollection(mongoCollectionName('teams'))->updateOne(['id' => $teamId, 'deleted_scope_type' => 'team'], ['$set' => ['deleted_at' => null, 'deleted_scope_type' => null, 'deleted_scope_id' => null]], ['session' => $session]);
            $staffCollection->updateMany(['deleted_scope_type' => 'team', 'deleted_scope_id' => $teamId], ['$set' => ['deleted_at' => null, 'deleted_scope_type' => null, 'deleted_scope_id' => null]], ['session' => $session]);
            return ['clients' => mongoOfficeRestoreSnapshots('team', $teamId, $session)];
        });
        if (($result['conflict'] ?? null) === 'leader') jsonResponse(['ok' => false, 'error' => 'This team already has a Team Leader.'], 409);
        if (($result['conflict'] ?? null) === 'capacity') jsonResponse(['ok' => false, 'error' => 'This team is at capacity.'], 409);
        $team = mongoFindOne('teams', ['id' => $teamId, 'deleted_at' => null]);
        $members = mongoFindMany('staff_users', ['team_id' => $teamId, 'deleted_at' => null]);
        jsonResponse(['ok' => true, 'team' => mongoRouteCleanRow($team ?? []), 'staff' => mongoRouteCleanRows($members), 'clients' => $result['clients']]);
    }

    if (preg_match('#^/admin/teams/([^/]+)$#', $apiPath, $match)) {
        $actor = mongoRouteAdminActor($adminSession);
        $teamId = rawurldecode($match[1]);
        $permanent = $method === 'DELETE' && (string)($_GET['permanent'] ?? '') === '1';
        $team = mongoFindOne('teams', $permanent
            ? ['id' => $teamId, 'deleted_at' => ['$ne' => null], 'deleted_scope_type' => 'team']
            : ['id' => $teamId, 'deleted_at' => null]);
        if (!$team) jsonResponse(['ok' => false, 'error' => 'Team not found.'], 404);
        if ($method === 'PATCH') {
            if (!in_array($actor['role'], ['Super Admin', 'Office Manager'], true)) jsonResponse(['ok' => false, 'error' => 'Your role cannot edit teams.'], 403);
            if ($actor['role'] === 'Office Manager'
                && (($team['office_id'] ?? null) !== ($actor['office_id'] ?? null)
                    || (isset($input['office_id']) && optionalId($input['office_id']) !== ($actor['office_id'] ?? null)))) {
                jsonResponse(['ok' => false, 'error' => 'You can only edit teams in your office.'], 403);
            }
            $newOfficeId = array_key_exists('office_id', $input) ? optionalId($input['office_id']) : optionalId($team['office_id'] ?? null);
            if ($newOfficeId !== null && !mongoFindOne('offices', ['id' => $newOfficeId, 'deleted_at' => null])) jsonResponse(['ok' => false, 'error' => 'The selected office is unavailable.'], 422);
            $newMaxSize = array_key_exists('max_size', $input) ? ($input['max_size'] === null || $input['max_size'] === '' ? null : (int)$input['max_size']) : ($team['max_size'] === null ? null : (int)$team['max_size']);
            if ($newMaxSize !== null && $newMaxSize < 1) jsonResponse(['ok' => false, 'error' => 'Team capacity must be at least 1 or left unlimited.'], 422);
            $name = array_key_exists('name', $input) ? trim((string)$input['name']) : (string)$team['name'];
            if ($name === '') jsonResponse(['ok' => false, 'error' => 'Team name is required.'], 422);
            $newLeaderId = array_key_exists('leader_id', $input) ? optionalId($input['leader_id']) : optionalId($team['leader_id'] ?? null);
            $currentAgentCount = mongoRouteCount('staff_users', ['team_id' => $teamId, 'role' => 'Agent', 'deleted_at' => null]);
            if ($newMaxSize !== null && $currentAgentCount > $newMaxSize) jsonResponse(['ok' => false, 'error' => 'Capacity cannot be lower than the current number of agents.'], 409);
            $leader = $newLeaderId ? mongoFindOne('staff_users', ['id' => $newLeaderId, 'role' => 'Team Leader', 'status' => 'Active', 'deleted_at' => null]) : null;
            if ($newLeaderId && !$leader) jsonResponse(['ok' => false, 'error' => 'Select an active Team Leader.'], 422);
            $setLeader = array_key_exists('leader_id', $input);
            $result = mongoTeamTransaction(static function (object $session) use ($team, $teamId, $name, $newOfficeId, $newMaxSize, $newLeaderId, $setLeader): array {
                if (!mongoTeamClaim('team_capacity:' . $teamId, 'team-capacity-guard', $session)) return ['__abort' => true, 'capacity_conflict' => true];
                $agentCount = getMongoCollection(mongoCollectionName('staff_users'))->countDocuments(['team_id' => $teamId, 'role' => 'Agent', 'deleted_at' => null], ['session' => $session]);
                if ($newMaxSize !== null && $agentCount > $newMaxSize) return ['__abort' => true, 'capacity_conflict' => true];
                if ($newLeaderId !== null) {
                    $selected = mongoTeamFindOne('staff_users', ['id' => $newLeaderId, 'role' => 'Team Leader', 'status' => 'Active', 'deleted_at' => null], $session);
                    if (!$selected) return ['__abort' => true, 'invalid' => true];
                    $otherTeam = mongoTeamFindOne('teams', ['leader_id' => $newLeaderId, 'id' => ['$ne' => $teamId]], $session);
                    if ($otherTeam) return ['__abort' => true, 'leader_conflict' => true];
                    if (!mongoTeamClaim('team_leader:' . $teamId, $newLeaderId, $session)) return ['__abort' => true, 'leader_conflict' => true];
                }
                getMongoCollection(mongoCollectionName('teams'))->updateOne(
                    ['id' => $teamId, 'deleted_at' => null],
                    ['$set' => ['name' => $name, 'office_id' => $newOfficeId, 'max_size' => $newMaxSize]],
                    ['session' => $session],
                );
                if ($newOfficeId !== ($team['office_id'] ?? null)) {
                    getMongoCollection(mongoCollectionName('staff_users'))->updateMany(['team_id' => $teamId, 'deleted_at' => null], ['$set' => ['office_id' => $newOfficeId]], ['session' => $session]);
                    getMongoCollection(mongoCollectionName('clients'))->updateMany(['assigned_team_id' => $teamId, 'deleted_at' => null], ['$set' => ['assigned_office_id' => $newOfficeId, 'updated_at' => date('c')]], ['session' => $session]);
                }
                if ($setLeader) {
                    if (!empty($team['leader_id']) && $team['leader_id'] !== $newLeaderId) {
                        getMongoCollection(mongoCollectionName('staff_users'))->updateOne(['id' => $team['leader_id'], 'deleted_at' => null], ['$set' => ['team_id' => null]], ['session' => $session]);
                        mongoTeamRelease('team_leader:' . $teamId, (string)$team['leader_id'], $session);
                    }
                    if ($newLeaderId !== null) {
                        getMongoCollection(mongoCollectionName('teams'))->updateMany(['leader_id' => $newLeaderId, 'id' => ['$ne' => $teamId]], ['$set' => ['leader_id' => null, 'leader_name' => null]], ['session' => $session]);
                        getMongoCollection(mongoCollectionName('staff_users'))->updateOne(['id' => $newLeaderId], ['$set' => ['team_id' => $teamId, 'office_id' => $newOfficeId]], ['session' => $session]);
                        $selected = mongoTeamFindOne('staff_users', ['id' => $newLeaderId], $session);
                        getMongoCollection(mongoCollectionName('teams'))->updateOne(['id' => $teamId], ['$set' => ['leader_id' => $newLeaderId, 'leader_name' => $selected['name'] ?? null]], ['session' => $session]);
                    } else {
                        getMongoCollection(mongoCollectionName('teams'))->updateOne(['id' => $teamId], ['$set' => ['leader_id' => null, 'leader_name' => null]], ['session' => $session]);
                    }
                }
                return [];
            });
            if (!empty($result['invalid'])) jsonResponse(['ok' => false, 'error' => 'Select an active Team Leader.'], 422);
            if (!empty($result['leader_conflict'])) jsonResponse(['ok' => false, 'error' => 'This team already has a Team Leader.'], 409);
            if (!empty($result['capacity_conflict'])) jsonResponse(['ok' => false, 'error' => 'Capacity cannot be lower than the current number of agents.'], 409);
            $updated = mongoFindOne('teams', ['id' => $teamId]);
            jsonResponse(['ok' => true, 'team' => mongoRouteCleanRow($updated ?? [])]);
        }
        if ($method === 'DELETE') {
            mongoRouteRequireSuperAdmin($adminSession);
            $now = date('c');
            $result = mongoTeamTransaction(static function (object $session) use ($teamId, $team, $permanent, $now, $actor): array {
                if (!mongoTeamClaim('team_capacity:' . $teamId, 'team-capacity-guard', $session)) return ['__abort' => true, 'capacity_conflict' => true];
                $staff = mongoTeamFindMany('staff_users', ['team_id' => $teamId], $session);
                $staffIds = array_values(array_map(static fn(array $member): string => (string)$member['id'], $staff));
                if ($permanent) {
                    $conditions = [['assigned_team_id' => $teamId]];
                    if ($staffIds) {
                        $conditions[] = ['assigned_agent_id' => ['$in' => $staffIds]];
                        $conditions[] = ['assigned_team_leader_id' => ['$in' => $staffIds]];
                        getMongoCollection(mongoCollectionName('admin_sessions'))->deleteMany(['user_id' => ['$in' => $staffIds]], ['session' => $session]);
                        getMongoCollection(mongoCollectionName('staff_users'))->deleteMany(['id' => ['$in' => $staffIds]], ['session' => $session]);
                        foreach ($staff as $member) {
                            mongoTeamRelease('email:' . strtolower(trim((string)($member['email'] ?? ''))), (string)$member['id'], $session);
                            if (($member['role'] ?? null) === 'Team Leader') mongoTeamRelease('team_leader:' . $teamId, (string)$member['id'], $session);
                        }
                    }
                    getMongoCollection(mongoCollectionName('clients'))->updateMany(['$or' => $conditions], ['$set' => ['assigned_office_id' => null, 'assigned_team_id' => null, 'assigned_team_leader_id' => null, 'assigned_agent_id' => null, 'assigned_by' => null]], ['session' => $session]);
                    getMongoCollection(mongoCollectionName('crm_assignment_restore'))->deleteMany(['entity_type' => 'team', 'entity_id' => $teamId], ['session' => $session]);
                    getMongoCollection(mongoCollectionName('teams'))->deleteOne(['id' => $teamId], ['session' => $session]);
                    return [];
                }
                $clientIds = mongoTeamSnapshotClear($teamId, array_values(array_map(static fn(array $member): string => (string)$member['id'], array_filter($staff, static fn(array $member): bool => empty($member['deleted_at'])))), $actor['id'], $session);
                getMongoCollection(mongoCollectionName('teams'))->updateOne(['id' => $teamId, 'deleted_at' => null], ['$set' => ['deleted_at' => $now, 'deleted_scope_type' => 'team', 'deleted_scope_id' => $teamId]], ['session' => $session]);
                getMongoCollection(mongoCollectionName('staff_users'))->updateMany(['team_id' => $teamId, 'deleted_at' => null], ['$set' => ['deleted_at' => $now, 'deleted_scope_type' => 'team', 'deleted_scope_id' => $teamId]], ['session' => $session]);
                return ['staff_ids' => array_values(array_map(static fn(array $member): string => (string)$member['id'], array_filter($staff, static fn(array $member): bool => empty($member['deleted_at'])))), 'client_ids' => $clientIds];
            });
            if (!empty($result['capacity_conflict'])) jsonResponse(['ok' => false, 'error' => 'This team is being updated. Retry the request.'], 409);
            if ($permanent) jsonResponse(['ok' => true]);
            jsonResponse(['ok' => true, 'deleted_at' => $now, 'staff_ids' => $result['staff_ids'], 'client_ids' => $result['client_ids']]);
        }
        jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }
}

// -----------------------------------------------------------------------------
// 10. ADMIN: TEAMS MANAGEMENT
// -----------------------------------------------------------------------------
if ($apiPath === '/admin/teams') {
    $actor = requireActiveAdminStaff($pdo, $adminSession);
    $includeDeleted = (string)($_GET['include_deleted'] ?? '');
    if ($includeDeleted !== '' && $actor['role'] !== 'Super Admin') {
        jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can view deleted teams.'], 403);
    }
    if ($method === 'POST') {
        if (!in_array($actor['role'], ['Super Admin', 'Office Manager'], true)) jsonResponse(['ok' => false, 'error' => 'Your role cannot create teams.'], 403);
        $name = trim((string)($input['name'] ?? ''));
        if ($name === '') jsonResponse(['ok' => false, 'error' => 'Team name is required.'], 400);
        $officeId = optionalId($input['office_id'] ?? null);
        if ($actor['role'] === 'Office Manager') {
            $officeId = optionalId($actor['office_id'] ?? null);
            if ($officeId === null) jsonResponse(['ok' => false, 'error' => 'Your account is not assigned to an office.'], 403);
        }
        if ($officeId !== null && !activeOffice($pdo, $officeId)) jsonResponse(['ok' => false, 'error' => 'The selected office is unavailable.'], 422);
        $maxSize = array_key_exists('max_size', $input) ? ($input['max_size'] === null || $input['max_size'] === '' ? null : (int)$input['max_size']) : 10;
        if ($maxSize !== null && $maxSize < 1) jsonResponse(['ok' => false, 'error' => 'Team capacity must be at least 1 or left unlimited.'], 422);
        $teamId = 'tm_' . bin2hex(random_bytes(8));
        $now = date('c');
        $leader = null;
        $leaderId = null;
        $leaderName = trim((string)($input['leader_name'] ?? 'Unassigned')) ?: 'Unassigned';
        $leaderEmail = strtolower(trim((string)($input['leader_email'] ?? '')));
        $leaderPassword = (string)($input['leader_password'] ?? '');
        if ($leaderPassword !== '' && strlen($leaderPassword) < 8) jsonResponse(['ok' => false, 'error' => 'Staff passwords must be at least 8 characters.'], 422);
        if ($leaderPassword !== '') {
            if ($leaderName === 'Unassigned') jsonResponse(['ok' => false, 'error' => 'A team leader name is required when setting a password.'], 422);
            $leaderId = 'adm_' . bin2hex(random_bytes(8));
            $leaderEmail = $leaderEmail ?: 'leader_' . substr($leaderId, 4) . '@codexdynamics.com';
            if (!filter_var($leaderEmail, FILTER_VALIDATE_EMAIL)) jsonResponse(['ok' => false, 'error' => 'Enter a valid team leader email address.'], 422);
            $q = $pdo->prepare('SELECT id FROM staff_users WHERE LOWER(email) = ?');
            $q->execute([$leaderEmail]);
            if ($q->fetchColumn()) jsonResponse(['ok' => false, 'error' => 'That email address is already in use.'], 409);
            $caps = json_encode(['client_upload' => true, 'create_agent' => true, 'registrations' => true, 'notifications' => true, 'content' => true, 'enquiries' => true, 'chat' => true]);
            $hash = password_hash($leaderPassword, PASSWORD_DEFAULT);
            $pdo->prepare("INSERT INTO staff_users (id, email, password, name, role, office_id, team_id, status, capabilities, created_at) VALUES (?, ?, ?, ?, 'Team Leader', ?, ?, 'Active', ?, ?)")
                ->execute([$leaderId, $leaderEmail, $hash, $leaderName, $officeId, $teamId, $caps, $now]);
            $leader = ['id' => $leaderId, 'name' => $leaderName, 'email' => $leaderEmail, 'role' => 'Team Leader', 'office_id' => $officeId, 'team_id' => $teamId, 'status' => 'Active', 'capabilities' => json_decode($caps, true), 'created_at' => $now];
        }
        $pdo->prepare('INSERT INTO teams (id, name, office_id, leader_id, leader_name, max_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            ->execute([$teamId, $name, $officeId, $leaderId, $leader ? $leaderName : null, $maxSize, $now]);
        jsonResponse(['ok' => true, 'team' => ['id' => $teamId, 'name' => $name, 'office_id' => $officeId, 'leader_id' => $leaderId, 'leader_name' => $leader ? $leaderName : null, 'max_size' => $maxSize, 'agent_count' => 0, 'client_count' => 0, 'created_at' => $now], 'leader' => $leader], 201);
    }
    if ($method !== 'GET') jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    $filter = $includeDeleted === 'only'
        ? "deleted_at IS NOT NULL AND deleted_scope_type = 'team'"
        : ($includeDeleted === '1' ? '1=1' : 'deleted_at IS NULL');
    $params = [];
    if ($actor['role'] === 'Office Manager') {
        $officeId = optionalId($actor['office_id'] ?? null);
        if ($officeId === null) jsonResponse(['ok' => true, 'teams' => []]);
        $filter .= ' AND office_id = ?';
        $params[] = $officeId;
    } elseif ($actor['role'] === 'Team Leader' || $actor['role'] === 'Agent') {
        $teamId = optionalId($actor['team_id'] ?? null);
        if ($teamId === null) jsonResponse(['ok' => true, 'teams' => []]);
        $filter .= ' AND id = ?';
        $params[] = $teamId;
    }
    if ($actor['role'] === 'Super Admin' && !empty($_GET['office_id'])) {
        $filter .= ' AND office_id = ?';
        $params[] = (string)$_GET['office_id'];
    }
    $stmt = $pdo->prepare("SELECT * FROM teams WHERE {$filter} ORDER BY created_at DESC");
    $stmt->execute($params);
    $teams = $stmt->fetchAll();
    foreach ($teams as &$team) {
        $q = $pdo->prepare("SELECT COUNT(*) FROM staff_users WHERE team_id = ? AND role = 'Agent' AND deleted_at IS NULL");
        $q->execute([$team['id']]);
        $team['agent_count'] = (int)$q->fetchColumn();
        $q = $pdo->prepare('SELECT COUNT(*) FROM clients WHERE assigned_team_id = ? AND deleted_at IS NULL');
        $q->execute([$team['id']]);
        $team['client_count'] = (int)$q->fetchColumn();
    }
    unset($team);
    jsonResponse(['ok' => true, 'teams' => $teams]);
}

if (preg_match('#^/admin/teams/([^/]+)/restore$#', $apiPath, $m) && $method === 'POST') {
    requireSuperAdmin($pdo, $adminSession);
    $teamId = rawurldecode($m[1]);
    $q = $pdo->prepare("SELECT * FROM teams WHERE id = ? AND deleted_at IS NOT NULL AND deleted_scope_type = 'team'");
    $q->execute([$teamId]);
    $team = $q->fetch();
    if (!$team) jsonResponse(['ok' => false, 'error' => 'Deleted team not found. Restore its office first if the office was deleted.'], 404);
    if (!empty($team['office_id']) && !activeOffice($pdo, (string)$team['office_id'])) jsonResponse(['ok' => false, 'error' => 'Restore the parent office before restoring this team.'], 409);
    $pdo->beginTransaction();
    try {
        $pdo->prepare('UPDATE teams SET deleted_at = NULL, deleted_scope_type = NULL, deleted_scope_id = NULL WHERE id = ?')->execute([$teamId]);
        $pdo->prepare("UPDATE staff_users SET deleted_at = NULL, deleted_scope_type = NULL, deleted_scope_id = NULL WHERE deleted_scope_type = 'team' AND deleted_scope_id = ?")->execute([$teamId]);
        $clients = restoreClientAssignmentSnapshots($pdo, 'team', $teamId);
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
    $q = $pdo->prepare("SELECT id, name, email, role, office_id, team_id, status, capabilities, last_login_at, created_at FROM staff_users WHERE team_id = ? AND deleted_at IS NULL");
    $q->execute([$teamId]);
    jsonResponse(['ok' => true, 'team' => $team, 'staff' => $q->fetchAll(), 'clients' => $clients]);
}

if (preg_match('#^/admin/teams/([^/]+)$#', $apiPath, $m)) {
    $actor = requireActiveAdminStaff($pdo, $adminSession);
    $teamId = rawurldecode($m[1]);
    $isPermanent = $method === 'DELETE' && (string)($_GET['permanent'] ?? '') === '1';
    $q = $pdo->prepare($isPermanent
        ? "SELECT * FROM teams WHERE id = ? AND deleted_at IS NOT NULL AND deleted_scope_type = 'team'"
        : 'SELECT * FROM teams WHERE id = ? AND deleted_at IS NULL');
    $q->execute([$teamId]);
    $team = $q->fetch();
    if (!$team) jsonResponse(['ok' => false, 'error' => 'Team not found.'], 404);
    if ($method === 'PATCH') {
        if (!in_array($actor['role'], ['Super Admin', 'Office Manager'], true)) jsonResponse(['ok' => false, 'error' => 'Your role cannot edit teams.'], 403);
        if ($actor['role'] === 'Office Manager' && ($team['office_id'] !== $actor['office_id'] || (isset($input['office_id']) && optionalId($input['office_id']) !== $actor['office_id']))) {
            jsonResponse(['ok' => false, 'error' => 'You can only edit teams in your office.'], 403);
        }
        $newOfficeId = array_key_exists('office_id', $input) ? optionalId($input['office_id']) : optionalId($team['office_id']);
        if ($newOfficeId !== null && !activeOffice($pdo, $newOfficeId)) jsonResponse(['ok' => false, 'error' => 'The selected office is unavailable.'], 422);
        $newMaxSize = array_key_exists('max_size', $input)
            ? ($input['max_size'] === null || $input['max_size'] === '' ? null : (int)$input['max_size'])
            : ($team['max_size'] === null ? null : (int)$team['max_size']);
        if ($newMaxSize !== null && $newMaxSize < 1) jsonResponse(['ok' => false, 'error' => 'Team capacity must be at least 1 or left unlimited.'], 422);
        $q = $pdo->prepare("SELECT COUNT(*) FROM staff_users WHERE team_id = ? AND role = 'Agent' AND deleted_at IS NULL");
        $q->execute([$teamId]);
        if ($newMaxSize !== null && (int)$q->fetchColumn() > $newMaxSize) jsonResponse(['ok' => false, 'error' => 'Capacity cannot be lower than the current number of agents.'], 409);
        $name = array_key_exists('name', $input) ? trim((string)$input['name']) : $team['name'];
        if ($name === '') jsonResponse(['ok' => false, 'error' => 'Team name is required.'], 422);
        $pdo->beginTransaction();
        try {
            $pdo->prepare('UPDATE teams SET name = ?, office_id = ?, max_size = ? WHERE id = ?')->execute([$name, $newOfficeId, $newMaxSize, $teamId]);
            if ($newOfficeId !== $team['office_id']) {
                $pdo->prepare('UPDATE staff_users SET office_id = ? WHERE team_id = ? AND deleted_at IS NULL')->execute([$newOfficeId, $teamId]);
                $pdo->prepare('UPDATE clients SET assigned_office_id = ?, updated_at = ? WHERE assigned_team_id = ? AND deleted_at IS NULL')->execute([$newOfficeId, date('c'), $teamId]);
            }
            if (array_key_exists('leader_id', $input)) {
                $leaderId = optionalId($input['leader_id']);
                $leader = $leaderId ? activeStaffRecord($pdo, $leaderId) : null;
                if ($leaderId && (!$leader || $leader['role'] !== 'Team Leader')) {
                    $pdo->rollBack();
                    jsonResponse(['ok' => false, 'error' => 'Select an active Team Leader.'], 422);
                }
                $pdo->prepare('UPDATE teams SET leader_id = NULL, leader_name = NULL WHERE leader_id = ?')->execute([$leaderId]);
                if ($leader) {
                    $pdo->prepare('UPDATE staff_users SET team_id = ?, office_id = ? WHERE id = ?')->execute([$teamId, $newOfficeId, $leaderId]);
                    $pdo->prepare('UPDATE teams SET leader_id = ?, leader_name = ? WHERE id = ?')->execute([$leaderId, $leader['name'], $teamId]);
                } elseif (!empty($team['leader_id'])) {
                    $pdo->prepare('UPDATE staff_users SET team_id = NULL WHERE id = ? AND deleted_at IS NULL')->execute([$team['leader_id']]);
                }
            }
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
        $q = $pdo->prepare('SELECT * FROM teams WHERE id = ?');
        $q->execute([$teamId]);
        jsonResponse(['ok' => true, 'team' => $q->fetch()]);
    }
    if ($method === 'DELETE') {
        requireSuperAdmin($pdo, $adminSession);
        if ($isPermanent) {
            $q = $pdo->prepare('SELECT id FROM staff_users WHERE team_id = ?');
            $q->execute([$teamId]);
            $staffIds = $q->fetchAll(PDO::FETCH_COLUMN);
            $pdo->beginTransaction();
            try {
                $conditions = ['assigned_team_id = ?'];
                $params = [$teamId];
                if ($staffIds) {
                    $in = implode(',', array_fill(0, count($staffIds), '?'));
                    $conditions[] = "(assigned_agent_id IN ({$in}) OR assigned_team_leader_id IN ({$in}))";
                    array_push($params, ...$staffIds, ...$staffIds);
                    $pdo->prepare("DELETE FROM admin_sessions WHERE user_id IN ({$in})")->execute($staffIds);
                    $pdo->prepare("DELETE FROM staff_users WHERE id IN ({$in})")->execute($staffIds);
                }
                $pdo->prepare('UPDATE clients SET assigned_office_id = NULL, assigned_team_id = NULL, assigned_team_leader_id = NULL, assigned_agent_id = NULL, assigned_by = NULL WHERE ' . implode(' OR ', $conditions))->execute($params);
                $pdo->prepare("DELETE FROM crm_assignment_restore WHERE entity_type = 'team' AND entity_id = ?")->execute([$teamId]);
                $pdo->prepare('DELETE FROM teams WHERE id = ?')->execute([$teamId]);
                $pdo->commit();
            } catch (Throwable $error) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $error;
            }
            jsonResponse(['ok' => true]);
        }
        $q = $pdo->prepare('SELECT id FROM staff_users WHERE team_id = ? AND deleted_at IS NULL');
        $q->execute([$teamId]);
        $staffIds = $q->fetchAll(PDO::FETCH_COLUMN);
        $conditions = ['assigned_team_id = ?'];
        $params = [$teamId];
        if ($staffIds) {
            $in = implode(',', array_fill(0, count($staffIds), '?'));
            $conditions[] = "(assigned_agent_id IN ({$in}) OR assigned_team_leader_id IN ({$in}))";
            array_push($params, ...$staffIds, ...$staffIds);
        }
        $now = date('c');
        $pdo->beginTransaction();
        try {
            $clientIds = snapshotAndClearClientAssignments($pdo, 'team', $teamId, implode(' OR ', $conditions), $params, $actor['id']);
            $pdo->prepare("UPDATE teams SET deleted_at = ?, deleted_scope_type = 'team', deleted_scope_id = ? WHERE id = ?")->execute([$now, $teamId, $teamId]);
            $pdo->prepare("UPDATE staff_users SET deleted_at = ?, deleted_scope_type = 'team', deleted_scope_id = ? WHERE team_id = ? AND deleted_at IS NULL")->execute([$now, $teamId, $teamId]);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
        jsonResponse(['ok' => true, 'deleted_at' => $now, 'staff_ids' => $staffIds, 'client_ids' => $clientIds]);
    }
    jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
}
