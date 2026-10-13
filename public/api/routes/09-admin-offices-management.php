<?php
/** Route group: ADMIN: OFFICES MANAGEMENT (included by index.php in order; uses its request globals). */

declare(strict_types=1);

function mongoOfficeTransaction(callable $operation): mixed {
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

function mongoOfficeFindOne(string $table, array $filter, object $session): ?array {
    return mongoDocumentToArray(getMongoCollection(mongoCollectionName($table))->findOne($filter, ['session' => $session]));
}

function mongoOfficeFindMany(string $table, array $filter, object $session, array $options = []): array {
    $options['session'] = $session;
    $rows = [];
    foreach (getMongoCollection(mongoCollectionName($table))->find($filter, $options) as $document) {
        $row = mongoDocumentToArray($document);
        if ($row !== null) $rows[] = $row;
    }
    return $rows;
}

function mongoOfficeInsert(string $table, array $document, object $session): void {
    $document['_id'] = $document['_id'] ?? (string)$document['id'];
    getMongoCollection(mongoCollectionName($table))->insertOne($document, ['session' => $session]);
}

function mongoOfficeActive(string $table, ?string $id, object $session): ?array {
    return $id === null ? null : mongoOfficeFindOne($table, ['id' => $id, 'deleted_at' => null], $session);
}

function mongoOfficeEmailInUse(string $email, ?string $excludeId, object $session): bool {
    $filter = ['email' => ['$regex' => '^\\s*' . preg_quote(strtolower(trim($email)), '/') . '\\s*$', '$options' => 'i']];
    if ($excludeId !== null) $filter['id'] = ['$ne' => $excludeId];
    return mongoOfficeFindOne('staff_users', $filter, $session) !== null;
}

function mongoOfficeClaim(string $key, string $ownerId, object $session): bool {
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
    } else {
        $locks->updateOne(['_id' => $key], ['$set' => ['owner_id' => $ownerId]], ['session' => $session]);
    }
    return true;
}

function mongoOfficeRelease(string $key, string $ownerId, object $session): void {
    getMongoCollection('legacy_admin_constraint_locks')->deleteOne(['_id' => $key, 'owner_id' => $ownerId], ['session' => $session]);
}

function mongoOfficeSnapshotClear(string $entityType, string $entityId, array $filter, string $actorId, object $session): array {
    $clients = mongoOfficeFindMany('clients', ['$and' => [['deleted_at' => null], $filter]], $session);
    $restore = getMongoCollection(mongoCollectionName('crm_assignment_restore'));
    $clientCollection = getMongoCollection(mongoCollectionName('clients'));
    $now = date('c');
    foreach ($clients as $client) {
        $clientId = (string)$client['id'];
        $snapshotId = 'crar_' . bin2hex(random_bytes(10));
        $restore->deleteMany(['entity_type' => $entityType, 'entity_id' => $entityId, 'client_id' => $clientId], ['session' => $session]);
        $restore->insertOne([
            '_id' => $snapshotId,
            'id' => $snapshotId,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'client_id' => $clientId,
            'assigned_office_id' => $client['assigned_office_id'] ?? null,
            'assigned_team_id' => $client['assigned_team_id'] ?? null,
            'assigned_team_leader_id' => $client['assigned_team_leader_id'] ?? null,
            'assigned_agent_id' => $client['assigned_agent_id'] ?? null,
            'assigned_by' => $client['assigned_by'] ?? null,
        ], ['session' => $session]);
        $clientCollection->updateOne(
            ['id' => $clientId, 'deleted_at' => null],
            ['$set' => [
                'assigned_office_id' => null,
                'assigned_team_id' => null,
                'assigned_team_leader_id' => null,
                'assigned_agent_id' => null,
                'assigned_by' => $actorId,
                'updated_at' => $now,
            ]],
            ['session' => $session],
        );
    }
    return array_values(array_map(static fn(array $client): string => (string)$client['id'], $clients));
}

function mongoOfficeRestoreSnapshots(string $entityType, string $entityId, object $session): array {
    $restore = getMongoCollection(mongoCollectionName('crm_assignment_restore'));
    $snapshots = mongoOfficeFindMany('crm_assignment_restore', ['entity_type' => $entityType, 'entity_id' => $entityId], $session, ['sort' => ['client_id' => 1]]);
    $clients = getMongoCollection(mongoCollectionName('clients'));
    $now = date('c');
    $restoredIds = [];
    foreach ($snapshots as $snapshot) {
        $clientId = (string)$snapshot['client_id'];
        $clients->updateOne(
            ['id' => $clientId, 'deleted_at' => null],
            ['$set' => [
                'assigned_office_id' => $snapshot['assigned_office_id'] ?? null,
                'assigned_team_id' => $snapshot['assigned_team_id'] ?? null,
                'assigned_team_leader_id' => $snapshot['assigned_team_leader_id'] ?? null,
                'assigned_agent_id' => $snapshot['assigned_agent_id'] ?? null,
                'assigned_by' => $snapshot['assigned_by'] ?? null,
                'updated_at' => $now,
            ]],
            ['session' => $session],
        );
        $restoredIds[] = $clientId;
    }
    $restore->deleteMany(['entity_type' => $entityType, 'entity_id' => $entityId], ['session' => $session]);
    $result = [];
    foreach ($restoredIds as $clientId) {
        $client = mongoOfficeFindOne('clients', ['id' => $clientId, 'deleted_at' => null], $session);
        if ($client) {
            $agent = !empty($client['assigned_agent_id'])
                ? mongoOfficeFindOne('staff_users', ['id' => $client['assigned_agent_id']], $session)
                : null;
            $client['assigned_agent_name'] = $agent['name'] ?? null;
            $result[] = mongoRouteCleanRow($client);
        }
    }
    return $result;
}

if (isMongoStorageEnabled()) {
    if ($apiPath === '/admin/offices') {
        $actor = mongoRouteAdminActor($adminSession);
        $includeDeleted = (string)($_GET['include_deleted'] ?? '');
        if ($includeDeleted !== '' && $actor['role'] !== 'Super Admin') {
            jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can view deleted offices.'], 403);
        }
        if ($method === 'POST') {
            mongoRouteRequireSuperAdmin($adminSession);
            $name = trim((string)($input['name'] ?? ''));
            if ($name === '') jsonResponse(['ok' => false, 'error' => 'Office name is required.'], 400);
            $id = 'of_' . bin2hex(random_bytes(8));
            $now = date('c');
            $managerName = trim((string)($input['manager_name'] ?? 'Unassigned')) ?: 'Unassigned';
            $managerEmail = strtolower(trim((string)($input['manager_email'] ?? '')));
            $password = (string)($input['manager_password'] ?? '');
            if ($password !== '' && strlen($password) < 8) jsonResponse(['ok' => false, 'error' => 'Staff passwords must be at least 8 characters.'], 422);
            $managerId = null;
            $manager = null;
            $hash = null;
            if ($password !== '') {
                $managerId = 'adm_' . bin2hex(random_bytes(8));
                $managerEmail = $managerEmail ?: 'manager_' . substr($managerId, 4) . '@codexdynamics.com';
                if (!filter_var($managerEmail, FILTER_VALIDATE_EMAIL)) jsonResponse(['ok' => false, 'error' => 'Enter a valid manager email address.'], 422);
                $hash = password_hash($password, PASSWORD_DEFAULT);
                if ($hash === false) jsonResponse(['ok' => false, 'error' => 'Could not securely save the staff password.'], 500);
            }
            $result = mongoOfficeTransaction(static function (object $session) use ($id, $name, $now, $managerId, $managerName, $managerEmail, $password, $hash): array {
                if ($managerId !== null) {
                    if (mongoOfficeEmailInUse($managerEmail, null, $session)
                        || !mongoOfficeClaim('email:' . $managerEmail, $managerId, $session)
                        || !mongoOfficeClaim('office_manager:' . $id, $managerId, $session)) {
                        return ['__abort' => true, 'conflict' => 'email'];
                    }
                    mongoOfficeInsert('staff_users', [
                        'id' => $managerId, 'email' => $managerEmail, 'password' => $hash, 'name' => $managerName,
                        'role' => 'Office Manager', 'office_id' => $id, 'team_id' => null, 'status' => 'Active',
                        'capabilities' => ['client_upload' => true, 'create_agent' => true, 'registrations' => true, 'notifications' => true, 'content' => true, 'enquiries' => true, 'chat' => true],
                        'created_at' => $now, 'deleted_at' => null,
                    ], $session);
                }
                mongoOfficeInsert('offices', [
                    'id' => $id, 'name' => $name, 'manager_id' => $managerId, 'manager_name' => $managerName,
                    'manager_email' => $managerEmail, 'created_at' => $now, 'deleted_at' => null,
                ], $session);
                return [];
            });
            if (isset($result['conflict'])) jsonResponse(['ok' => false, 'error' => 'That email address is already in use.'], 409);
            if ($managerId !== null) {
                $manager = ['id' => $managerId, 'name' => $managerName, 'email' => $managerEmail, 'role' => 'Office Manager', 'office_id' => $id, 'team_id' => null, 'status' => 'Active', 'capabilities' => ['client_upload' => true, 'create_agent' => true, 'registrations' => true, 'notifications' => true, 'content' => true, 'enquiries' => true, 'chat' => true], 'created_at' => $now];
            }
            jsonResponse(['ok' => true, 'office' => ['id' => $id, 'name' => $name, 'manager_id' => $managerId, 'manager_name' => $managerName, 'manager_email' => $managerEmail, 'team_count' => 0, 'agent_count' => 0, 'client_count' => 0, 'created_at' => $now], 'manager' => $manager], 201);
        }
        if ($method !== 'GET') jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);

        $filter = $includeDeleted === 'only'
            ? ['deleted_at' => ['$ne' => null]]
            : ($includeDeleted === '1' ? [] : ['deleted_at' => null]);
        if ($actor['role'] !== 'Super Admin') {
            $officeId = optionalId($actor['office_id'] ?? null);
            if ($officeId === null) jsonResponse(['ok' => true, 'offices' => []]);
            $filter['id'] = $officeId;
        }
        $offices = mongoFindMany('offices', $filter, ['sort' => ['created_at' => -1]]);
        foreach ($offices as &$office) {
            $office['team_count'] = mongoRouteCount('teams', ['office_id' => $office['id'], 'deleted_at' => null]);
            $office['agent_count'] = mongoRouteCount('staff_users', ['office_id' => $office['id'], 'role' => 'Agent', 'deleted_at' => null]);
            $office['client_count'] = mongoRouteCount('clients', ['assigned_office_id' => $office['id'], 'deleted_at' => null]);
            $office = mongoRouteCleanRow($office);
        }
        unset($office);
        jsonResponse(['ok' => true, 'offices' => $offices]);
    }

    if (preg_match('#^/admin/offices/([^/]+)/restore$#', $apiPath, $match) && $method === 'POST') {
        mongoRouteRequireSuperAdmin($adminSession);
        $officeId = rawurldecode($match[1]);
        $office = mongoFindOne('offices', ['id' => $officeId, 'deleted_at' => ['$ne' => null]]);
        if (!$office) jsonResponse(['ok' => false, 'error' => 'Deleted office not found.'], 404);
        $result = mongoOfficeTransaction(static function (object $session) use ($officeId): array {
            $teamsToRestore = mongoOfficeFindMany('teams', ['deleted_scope_type' => 'office', 'deleted_scope_id' => $officeId], $session);
            foreach ($teamsToRestore as $team) {
                $teamId = (string)$team['id'];
                if (!mongoOfficeClaim('team_capacity:' . $teamId, 'team-capacity-guard', $session)) return ['__abort' => true, 'capacity_conflict' => true];
                if (($team['max_size'] ?? null) !== null) {
                    $activeAgents = getMongoCollection(mongoCollectionName('staff_users'))->countDocuments(['team_id' => $teamId, 'role' => 'Agent', 'deleted_at' => null], ['session' => $session]);
                    $restoringAgents = getMongoCollection(mongoCollectionName('staff_users'))->countDocuments(['team_id' => $teamId, 'role' => 'Agent', 'deleted_scope_type' => 'office', 'deleted_scope_id' => $officeId], ['session' => $session]);
                    if ($activeAgents + $restoringAgents > (int)$team['max_size']) return ['__abort' => true, 'capacity_conflict' => true];
                }
            }
            $offices = getMongoCollection(mongoCollectionName('offices'));
            $offices->updateOne(['id' => $officeId, 'deleted_at' => ['$ne' => null]], ['$set' => ['deleted_at' => null, 'deleted_scope_type' => null, 'deleted_scope_id' => null]], ['session' => $session]);
            getMongoCollection(mongoCollectionName('teams'))->updateMany(['deleted_scope_type' => 'office', 'deleted_scope_id' => $officeId], ['$set' => ['deleted_at' => null, 'deleted_scope_type' => null, 'deleted_scope_id' => null]], ['session' => $session]);
            getMongoCollection(mongoCollectionName('staff_users'))->updateMany(['deleted_scope_type' => 'office', 'deleted_scope_id' => $officeId], ['$set' => ['deleted_at' => null, 'deleted_scope_type' => null, 'deleted_scope_id' => null]], ['session' => $session]);
            $clients = mongoOfficeRestoreSnapshots('office', $officeId, $session);
            return ['clients' => $clients];
        });
        if (!empty($result['capacity_conflict'])) jsonResponse(['ok' => false, 'error' => 'A team is at capacity and cannot be restored.'], 409);
        $office = mongoFindOne('offices', ['id' => $officeId, 'deleted_at' => null]);
        $teams = mongoFindMany('teams', ['office_id' => $officeId, 'deleted_at' => null]);
        $staff = mongoFindMany('staff_users', ['office_id' => $officeId, 'deleted_at' => null]);
        jsonResponse(['ok' => true, 'office' => mongoRouteCleanRow($office ?? []), 'teams' => mongoRouteCleanRows($teams), 'staff' => mongoRouteCleanRows($staff), 'clients' => $result['clients']]);
    }

    if (preg_match('#^/admin/offices/([^/]+)(?:/(manager))?$#', $apiPath, $match)) {
        $actor = mongoRouteAdminActor($adminSession);
        $officeId = rawurldecode($match[1]);
        $isPermanent = $method === 'DELETE' && (string)($_GET['permanent'] ?? '') === '1';
        $office = mongoFindOne('offices', $isPermanent
            ? ['id' => $officeId, 'deleted_at' => ['$ne' => null]]
            : ['id' => $officeId, 'deleted_at' => null]);
        if (!$office) jsonResponse(['ok' => false, 'error' => 'Office not found.'], 404);
        $sub = $match[2] ?? '';
        if ($sub === 'manager' && $method === 'POST') {
            mongoRouteRequireSuperAdmin($adminSession);
            $managerId = optionalId($input['manager_id'] ?? null);
            $manager = $managerId ? mongoFindOne('staff_users', ['id' => $managerId, 'role' => 'Office Manager', 'status' => 'Active', 'deleted_at' => null]) : null;
            if ($managerId && !$manager) jsonResponse(['ok' => false, 'error' => 'Select an active Office Manager.'], 422);
            $result = mongoOfficeTransaction(static function (object $session) use ($officeId, $office, $managerId): array {
                if ($managerId !== null) {
                    $candidate = mongoOfficeFindOne('staff_users', ['id' => $managerId, 'role' => 'Office Manager', 'status' => 'Active', 'deleted_at' => null], $session);
                    if (!$candidate) return ['__abort' => true, 'missing' => true];
                    $owned = mongoOfficeFindMany('offices', ['manager_id' => $managerId, 'deleted_at' => null], $session);
                    foreach ($owned as $priorOffice) {
                        if (($priorOffice['id'] ?? null) !== $officeId) {
                            mongoOfficeRelease('office_manager:' . $priorOffice['id'], $managerId, $session);
                        }
                    }
                    if (!mongoOfficeClaim('office_manager:' . $officeId, $managerId, $session)) return ['__abort' => true, 'conflict' => true];
                }
                if (!empty($office['manager_id']) && $office['manager_id'] !== $managerId) {
                    getMongoCollection(mongoCollectionName('staff_users'))->updateOne(
                        ['id' => $office['manager_id'], 'role' => 'Office Manager'],
                        ['$set' => ['office_id' => null]],
                        ['session' => $session],
                    );
                    mongoOfficeRelease('office_manager:' . $officeId, (string)$office['manager_id'], $session);
                }
                if ($managerId !== null) {
                    getMongoCollection(mongoCollectionName('offices'))->updateMany(
                        ['manager_id' => $managerId, 'id' => ['$ne' => $officeId]],
                        ['$set' => ['manager_id' => null]],
                        ['session' => $session],
                    );
                    getMongoCollection(mongoCollectionName('staff_users'))->updateOne(
                        ['id' => $managerId],
                        ['$set' => ['office_id' => $officeId]],
                        ['session' => $session],
                    );
                } else {
                    mongoOfficeRelease('office_manager:' . $officeId, (string)($office['manager_id'] ?? ''), $session);
                }
                $candidate = $managerId !== null ? mongoOfficeFindOne('staff_users', ['id' => $managerId], $session) : null;
                getMongoCollection(mongoCollectionName('offices'))->updateOne(
                    ['id' => $officeId, 'deleted_at' => null],
                    ['$set' => ['manager_id' => $managerId, 'manager_name' => $candidate['name'] ?? 'Unassigned', 'manager_email' => $candidate['email'] ?? '']],
                    ['session' => $session],
                );
                return [];
            });
            if (!empty($result['missing'])) jsonResponse(['ok' => false, 'error' => 'Select an active Office Manager.'], 422);
            if (!empty($result['conflict'])) jsonResponse(['ok' => false, 'error' => 'This office already has an Office Manager.'], 409);
            $updated = mongoFindOne('offices', ['id' => $officeId]);
            jsonResponse(['ok' => true, 'office' => mongoRouteCleanRow($updated ?? []), 'manager' => $manager ? mongoRouteCleanRow($manager) : null]);
        }
        if ($method === 'PATCH') {
            mongoRouteRequireSuperAdmin($adminSession);
            $name = trim((string)($input['name'] ?? ''));
            if ($name === '') jsonResponse(['ok' => false, 'error' => 'Office name is required.'], 422);
            getMongoCollection(mongoCollectionName('offices'))->updateOne(['id' => $officeId, 'deleted_at' => null], ['$set' => ['name' => $name]]);
            $updated = mongoFindOne('offices', ['id' => $officeId]);
            jsonResponse(['ok' => true, 'office' => mongoRouteCleanRow($updated ?? [])]);
        }
        if ($method === 'DELETE') {
            mongoRouteRequireSuperAdmin($adminSession);
            $now = date('c');
            $result = mongoOfficeTransaction(static function (object $session) use ($officeId, $office, $isPermanent, $now, $actor): array {
                $teams = mongoOfficeFindMany('teams', ['office_id' => $officeId], $session);
                foreach ($teams as $team) {
                    if (!mongoOfficeClaim('team_capacity:' . $team['id'], 'team-capacity-guard', $session)) return ['__abort' => true, 'capacity_lock_conflict' => true];
                }
                $teamIds = array_values(array_map(static fn(array $team): string => (string)$team['id'], $teams));
                $activeTeamIds = array_values(array_map(
                    static fn(array $team): string => (string)$team['id'],
                    array_filter($teams, static fn(array $team): bool => empty($team['deleted_at'])),
                ));
                $staffFilter = $isPermanent && $teamIds
                    ? ['$or' => [['office_id' => $officeId], ['team_id' => ['$in' => $teamIds]]]]
                    : ['office_id' => $officeId];
                if (!$isPermanent) $staffFilter['deleted_at'] = null;
                $staff = mongoOfficeFindMany('staff_users', $staffFilter, $session);
                $staffIds = array_values(array_map(static fn(array $member): string => (string)$member['id'], $staff));
                $conditions = [['assigned_office_id' => $officeId]];
                $assignmentTeamIds = $isPermanent ? $teamIds : $activeTeamIds;
                if ($assignmentTeamIds) $conditions[] = ['assigned_team_id' => ['$in' => $assignmentTeamIds]];
                if ($staffIds) {
                    $conditions[] = ['assigned_agent_id' => ['$in' => $staffIds]];
                    $conditions[] = ['assigned_team_leader_id' => ['$in' => $staffIds]];
                }
                if ($isPermanent) {
                    getMongoCollection(mongoCollectionName('clients'))->updateMany(
                        ['$or' => $conditions],
                        ['$set' => ['assigned_office_id' => null, 'assigned_team_id' => null, 'assigned_team_leader_id' => null, 'assigned_agent_id' => null, 'assigned_by' => null]],
                        ['session' => $session],
                    );
                    if ($staffIds) {
                        getMongoCollection(mongoCollectionName('admin_sessions'))->deleteMany(['user_id' => ['$in' => $staffIds]], ['session' => $session]);
                        getMongoCollection(mongoCollectionName('staff_users'))->deleteMany(['id' => ['$in' => $staffIds]], ['session' => $session]);
                        foreach ($staff as $member) {
                            mongoOfficeRelease('email:' . strtolower(trim((string)($member['email'] ?? ''))), (string)$member['id'], $session);
                            if (($member['role'] ?? null) === 'Office Manager' && !empty($member['office_id'])) {
                                mongoOfficeRelease('office_manager:' . $member['office_id'], (string)$member['id'], $session);
                            }
                            if (($member['role'] ?? null) === 'Team Leader' && !empty($member['team_id'])) {
                                mongoOfficeRelease('team_leader:' . $member['team_id'], (string)$member['id'], $session);
                            }
                        }
                    }
                    getMongoCollection(mongoCollectionName('teams'))->deleteMany(['office_id' => $officeId], ['session' => $session]);
                    getMongoCollection(mongoCollectionName('crm_assignment_restore'))->deleteMany(['entity_type' => 'office', 'entity_id' => $officeId], ['session' => $session]);
                    getMongoCollection(mongoCollectionName('offices'))->deleteOne(['id' => $officeId], ['session' => $session]);
                    return ['team_ids' => $teamIds, 'staff_ids' => $staffIds];
                }
                $clients = mongoOfficeSnapshotClear('office', $officeId, ['$or' => $conditions], $actor['id'], $session);
                getMongoCollection(mongoCollectionName('offices'))->updateOne(['id' => $officeId, 'deleted_at' => null], ['$set' => ['deleted_at' => $now]], ['session' => $session]);
                getMongoCollection(mongoCollectionName('teams'))->updateMany(
                    ['office_id' => $officeId, 'deleted_at' => null],
                    ['$set' => ['deleted_at' => $now, 'deleted_scope_type' => 'office', 'deleted_scope_id' => $officeId]],
                    ['session' => $session],
                );
                getMongoCollection(mongoCollectionName('staff_users'))->updateMany(
                    ['office_id' => $officeId, 'deleted_at' => null],
                    ['$set' => ['deleted_at' => $now, 'deleted_scope_type' => 'office', 'deleted_scope_id' => $officeId]],
                    ['session' => $session],
                );
                return ['team_ids' => array_values(array_map(static fn(array $team): string => (string)$team['id'], array_filter($teams, static fn(array $team): bool => empty($team['deleted_at'])))),
                    'staff_ids' => array_values(array_map(static fn(array $member): string => (string)$member['id'], array_filter($staff, static fn(array $member): bool => empty($member['deleted_at'])))),
                    'client_ids' => $clients];
            });
            if (!empty($result['capacity_lock_conflict'])) jsonResponse(['ok' => false, 'error' => 'A team is being updated. Retry the request.'], 409);
            if ($isPermanent) jsonResponse(['ok' => true]);
            jsonResponse(['ok' => true, 'deleted_at' => $now, 'team_ids' => $result['team_ids'], 'staff_ids' => $result['staff_ids'], 'client_ids' => $result['client_ids']]);
        }
        jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }
}

// -----------------------------------------------------------------------------
// 9. ADMIN: OFFICES MANAGEMENT
// -----------------------------------------------------------------------------
if ($apiPath === '/admin/offices') {
    $actor = requireActiveAdminStaff($pdo, $adminSession);
    $includeDeleted = (string)($_GET['include_deleted'] ?? '');
    if ($includeDeleted !== '' && $actor['role'] !== 'Super Admin') {
        jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can view deleted offices.'], 403);
    }
    if ($method === 'POST') {
        requireSuperAdmin($pdo, $adminSession);
        $name = trim((string)($input['name'] ?? ''));
        if ($name === '') jsonResponse(['ok' => false, 'error' => 'Office name is required.'], 400);
        $id = 'of_' . bin2hex(random_bytes(8));
        $now = date('c');
        $managerId = null;
        $manager = null;
        $managerName = trim((string)($input['manager_name'] ?? 'Unassigned')) ?: 'Unassigned';
        $managerEmail = strtolower(trim((string)($input['manager_email'] ?? '')));
        $password = (string)($input['manager_password'] ?? '');
        if ($password !== '' && strlen($password) < 8) jsonResponse(['ok' => false, 'error' => 'Staff passwords must be at least 8 characters.'], 422);
        if ($password !== '') {
            $managerId = 'adm_' . bin2hex(random_bytes(8));
            $managerEmail = $managerEmail ?: 'manager_' . substr($managerId, 4) . '@codexdynamics.com';
            if (!filter_var($managerEmail, FILTER_VALIDATE_EMAIL)) jsonResponse(['ok' => false, 'error' => 'Enter a valid manager email address.'], 422);
            $check = $pdo->prepare('SELECT id FROM staff_users WHERE LOWER(email) = ?');
            $check->execute([$managerEmail]);
            if ($check->fetchColumn()) jsonResponse(['ok' => false, 'error' => 'That email address is already in use.'], 409);
            $caps = json_encode(['client_upload' => true, 'create_agent' => true, 'registrations' => true, 'notifications' => true, 'content' => true, 'enquiries' => true, 'chat' => true]);
            $hash = password_hash($password, PASSWORD_DEFAULT);
            $pdo->prepare("INSERT INTO staff_users (id, email, password, name, role, office_id, status, capabilities, created_at) VALUES (?, ?, ?, ?, 'Office Manager', ?, 'Active', ?, ?)")
                ->execute([$managerId, $managerEmail, $hash, $managerName, $id, $caps, $now]);
            $manager = ['id' => $managerId, 'name' => $managerName, 'email' => $managerEmail, 'role' => 'Office Manager', 'office_id' => $id, 'team_id' => null, 'status' => 'Active', 'capabilities' => json_decode($caps, true), 'created_at' => $now];
        }
        $pdo->prepare('INSERT INTO offices (id, name, manager_id, manager_name, manager_email, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([$id, $name, $managerId, $managerName, $managerEmail, $now]);
        jsonResponse(['ok' => true, 'office' => ['id' => $id, 'name' => $name, 'manager_id' => $managerId, 'manager_name' => $managerName, 'manager_email' => $managerEmail, 'team_count' => 0, 'agent_count' => 0, 'client_count' => 0, 'created_at' => $now], 'manager' => $manager], 201);
    }
    if ($method !== 'GET') jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    $deletedFilter = $includeDeleted === 'only' ? 'deleted_at IS NOT NULL' : ($includeDeleted === '1' ? '1=1' : 'deleted_at IS NULL');
    $params = [];
    if ($actor['role'] !== 'Super Admin') {
        $officeId = optionalId($actor['office_id'] ?? null);
        if ($officeId === null) jsonResponse(['ok' => true, 'offices' => []]);
        $deletedFilter .= ' AND id = ?';
        $params[] = $officeId;
    }
    $stmt = $pdo->prepare("SELECT * FROM offices WHERE {$deletedFilter} ORDER BY created_at DESC");
    $stmt->execute($params);
    $offices = $stmt->fetchAll();
    foreach ($offices as &$office) {
        $count = $pdo->prepare('SELECT COUNT(*) FROM teams WHERE office_id = ? AND deleted_at IS NULL');
        $count->execute([$office['id']]);
        $office['team_count'] = (int)$count->fetchColumn();
        $count = $pdo->prepare("SELECT COUNT(*) FROM staff_users WHERE office_id = ? AND role = 'Agent' AND deleted_at IS NULL");
        $count->execute([$office['id']]);
        $office['agent_count'] = (int)$count->fetchColumn();
        $count = $pdo->prepare('SELECT COUNT(*) FROM clients WHERE assigned_office_id = ? AND deleted_at IS NULL');
        $count->execute([$office['id']]);
        $office['client_count'] = (int)$count->fetchColumn();
    }
    unset($office);
    jsonResponse(['ok' => true, 'offices' => $offices]);
}

if (preg_match('#^/admin/offices/([^/]+)/restore$#', $apiPath, $m) && $method === 'POST') {
    requireSuperAdmin($pdo, $adminSession);
    $officeId = rawurldecode($m[1]);
    $stmt = $pdo->prepare('SELECT * FROM offices WHERE id = ? AND deleted_at IS NOT NULL');
    $stmt->execute([$officeId]);
    $office = $stmt->fetch();
    if (!$office) jsonResponse(['ok' => false, 'error' => 'Deleted office not found.'], 404);
    $pdo->beginTransaction();
    try {
        $pdo->prepare('UPDATE offices SET deleted_at = NULL, deleted_scope_type = NULL, deleted_scope_id = NULL WHERE id = ?')->execute([$officeId]);
        $pdo->prepare("UPDATE teams SET deleted_at = NULL, deleted_scope_type = NULL, deleted_scope_id = NULL WHERE deleted_scope_type = 'office' AND deleted_scope_id = ?")->execute([$officeId]);
        $pdo->prepare("UPDATE staff_users SET deleted_at = NULL, deleted_scope_type = NULL, deleted_scope_id = NULL WHERE deleted_scope_type = 'office' AND deleted_scope_id = ?")->execute([$officeId]);
        $clients = restoreClientAssignmentSnapshots($pdo, 'office', $officeId);
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
    $q = $pdo->prepare('SELECT * FROM teams WHERE office_id = ? AND deleted_at IS NULL');
    $q->execute([$officeId]);
    $teams = $q->fetchAll();
    $q = $pdo->prepare('SELECT * FROM offices WHERE id = ? AND deleted_at IS NULL');
    $q->execute([$officeId]);
    $office = $q->fetch();
    $q = $pdo->prepare("SELECT id, name, email, role, office_id, team_id, status, capabilities, last_login_at, created_at, deleted_at FROM staff_users WHERE office_id = ? AND deleted_at IS NULL");
    $q->execute([$officeId]);
    jsonResponse(['ok' => true, 'office' => $office, 'teams' => $teams, 'staff' => $q->fetchAll(), 'clients' => $clients]);
}

if (preg_match('#^/admin/offices/([^/]+)(?:/(manager))?$#', $apiPath, $m)) {
    $actor = requireActiveAdminStaff($pdo, $adminSession);
    $officeId = rawurldecode($m[1]);
    $isPermanentDelete = $method === 'DELETE' && (string)($_GET['permanent'] ?? '') === '1';
    if ($isPermanentDelete) {
        $q = $pdo->prepare('SELECT * FROM offices WHERE id = ? AND deleted_at IS NOT NULL');
        $q->execute([$officeId]);
        $office = $q->fetch() ?: null;
    } else {
        $office = activeOffice($pdo, $officeId);
    }
    if (!$office) jsonResponse(['ok' => false, 'error' => 'Office not found.'], 404);
    $sub = $m[2] ?? '';
    if ($sub === 'manager' && $method === 'POST') {
        requireSuperAdmin($pdo, $adminSession);
        $managerId = optionalId($input['manager_id'] ?? null);
        $manager = $managerId ? activeStaffRecord($pdo, $managerId) : null;
        if ($managerId && (!$manager || $manager['role'] !== 'Office Manager')) jsonResponse(['ok' => false, 'error' => 'Select an active Office Manager.'], 422);
        $pdo->beginTransaction();
        try {
            if (!empty($office['manager_id']) && $office['manager_id'] !== $managerId) {
                $pdo->prepare("UPDATE staff_users SET office_id = NULL WHERE id = ? AND role = 'Office Manager'")->execute([$office['manager_id']]);
            }
            if ($manager) {
                $pdo->prepare('UPDATE offices SET manager_id = NULL WHERE manager_id = ?')->execute([$managerId]);
                $pdo->prepare('UPDATE staff_users SET office_id = ? WHERE id = ?')->execute([$officeId, $managerId]);
            }
            $pdo->prepare('UPDATE offices SET manager_id = ?, manager_name = ?, manager_email = ? WHERE id = ?')
                ->execute([$managerId, $manager['name'] ?? 'Unassigned', $manager['email'] ?? '', $officeId]);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
        $q = $pdo->prepare('SELECT * FROM offices WHERE id = ?');
        $q->execute([$officeId]);
        jsonResponse(['ok' => true, 'office' => $q->fetch(), 'manager' => $manager]);
    }
    if ($method === 'PATCH') {
        requireSuperAdmin($pdo, $adminSession);
        $name = trim((string)($input['name'] ?? ''));
        if ($name === '') jsonResponse(['ok' => false, 'error' => 'Office name is required.'], 422);
        $pdo->prepare('UPDATE offices SET name = ? WHERE id = ? AND deleted_at IS NULL')->execute([$name, $officeId]);
        $q = $pdo->prepare('SELECT * FROM offices WHERE id = ?');
        $q->execute([$officeId]);
        jsonResponse(['ok' => true, 'office' => $q->fetch()]);
    }
    if ($method === 'DELETE') {
        requireSuperAdmin($pdo, $adminSession);
        if ($isPermanentDelete) {
            $q = $pdo->prepare('SELECT id FROM teams WHERE office_id = ?');
            $q->execute([$officeId]);
            $teamIds = $q->fetchAll(PDO::FETCH_COLUMN);
            $sql = 'SELECT id FROM staff_users WHERE office_id = ?' . ($teamIds ? ' OR team_id IN (' . implode(',', array_fill(0, count($teamIds), '?')) . ')' : '');
            $q = $pdo->prepare($sql);
            $q->execute(array_merge([$officeId], $teamIds));
            $staffIds = $q->fetchAll(PDO::FETCH_COLUMN);
            $pdo->beginTransaction();
            try {
                $conditions = ['assigned_office_id = ?'];
                $params = [$officeId];
                if ($teamIds) {
                    $conditions[] = 'assigned_team_id IN (' . implode(',', array_fill(0, count($teamIds), '?')) . ')';
                    array_push($params, ...$teamIds);
                }
                if ($staffIds) {
                    $in = implode(',', array_fill(0, count($staffIds), '?'));
                    $conditions[] = "(assigned_agent_id IN ({$in}) OR assigned_team_leader_id IN ({$in}))";
                    array_push($params, ...$staffIds, ...$staffIds);
                }
                $pdo->prepare('UPDATE clients SET assigned_office_id = NULL, assigned_team_id = NULL, assigned_team_leader_id = NULL, assigned_agent_id = NULL, assigned_by = NULL WHERE ' . implode(' OR ', $conditions))->execute($params);
                if ($staffIds) {
                    $in = implode(',', array_fill(0, count($staffIds), '?'));
                    $pdo->prepare("DELETE FROM admin_sessions WHERE user_id IN ({$in})")->execute($staffIds);
                    $pdo->prepare("DELETE FROM staff_users WHERE id IN ({$in})")->execute($staffIds);
                }
                $pdo->prepare('DELETE FROM teams WHERE office_id = ?')->execute([$officeId]);
                $pdo->prepare("DELETE FROM crm_assignment_restore WHERE entity_type = 'office' AND entity_id = ?")->execute([$officeId]);
                $pdo->prepare('DELETE FROM offices WHERE id = ?')->execute([$officeId]);
                $pdo->commit();
            } catch (Throwable $error) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $error;
            }
            jsonResponse(['ok' => true]);
        }
        $q = $pdo->prepare('SELECT id FROM teams WHERE office_id = ? AND deleted_at IS NULL');
        $q->execute([$officeId]);
        $teamIds = $q->fetchAll(PDO::FETCH_COLUMN);
        $q = $pdo->prepare('SELECT id FROM staff_users WHERE office_id = ? AND deleted_at IS NULL');
        $q->execute([$officeId]);
        $staffIds = $q->fetchAll(PDO::FETCH_COLUMN);
        $conditions = ['assigned_office_id = ?'];
        $params = [$officeId];
        if ($teamIds) {
            $conditions[] = 'assigned_team_id IN (' . implode(',', array_fill(0, count($teamIds), '?')) . ')';
            array_push($params, ...$teamIds);
        }
        if ($staffIds) {
            $in = implode(',', array_fill(0, count($staffIds), '?'));
            $conditions[] = "(assigned_agent_id IN ({$in}) OR assigned_team_leader_id IN ({$in}))";
            array_push($params, ...$staffIds, ...$staffIds);
        }
        $now = date('c');
        $pdo->beginTransaction();
        try {
            $clientIds = snapshotAndClearClientAssignments($pdo, 'office', $officeId, implode(' OR ', $conditions), $params, $actor['id']);
            $pdo->prepare('UPDATE offices SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')->execute([$now, $officeId]);
            $pdo->prepare("UPDATE teams SET deleted_at = ?, deleted_scope_type = 'office', deleted_scope_id = ? WHERE office_id = ? AND deleted_at IS NULL")->execute([$now, $officeId, $officeId]);
            $pdo->prepare("UPDATE staff_users SET deleted_at = ?, deleted_scope_type = 'office', deleted_scope_id = ? WHERE office_id = ? AND deleted_at IS NULL")->execute([$now, $officeId, $officeId]);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
        jsonResponse(['ok' => true, 'deleted_at' => $now, 'team_ids' => $teamIds, 'staff_ids' => $staffIds, 'client_ids' => $clientIds]);
    }
    jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
}
