<?php
/** Route group: ADMIN: STAFF (AGENTS, TEAM LEADERS, MANAGERS) (included by index.php in order; uses its request globals). */

declare(strict_types=1);

function mongoStaffTransaction(callable $operation): mixed {
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

function mongoStaffFindOne(string $table, array $filter, object $session): ?array {
    return mongoDocumentToArray(getMongoCollection(mongoCollectionName($table))->findOne($filter, ['session' => $session]));
}

function mongoStaffFindMany(string $table, array $filter, object $session): array {
    $rows = [];
    foreach (getMongoCollection(mongoCollectionName($table))->find($filter, ['session' => $session]) as $document) {
        $row = mongoDocumentToArray($document);
        if ($row !== null) $rows[] = $row;
    }
    return $rows;
}

function mongoStaffInsert(array $document, object $session): void {
    $document['_id'] = $document['_id'] ?? (string)$document['id'];
    getMongoCollection(mongoCollectionName('staff_users'))->insertOne($document, ['session' => $session]);
}

function mongoStaffEmailInUse(string $email, ?string $excludeId, object $session): bool {
    $filter = ['email' => ['$regex' => '^\\s*' . preg_quote(strtolower(trim($email)), '/') . '\\s*$', '$options' => 'i']];
    if ($excludeId !== null) $filter['id'] = ['$ne' => $excludeId];
    return mongoStaffFindOne('staff_users', $filter, $session) !== null;
}

function mongoStaffClaim(string $key, string $ownerId, object $session): bool {
    $collection = getMongoCollection('legacy_admin_constraint_locks');
    $lock = mongoDocumentToArray($collection->findOne(['_id' => $key], ['session' => $session]));
    if ($lock && ($lock['owner_id'] ?? null) !== $ownerId) return false;
    if (!$lock) {
        try {
            $collection->insertOne(['_id' => $key, 'owner_id' => $ownerId], ['session' => $session]);
        } catch (Throwable $error) {
            if ((int)$error->getCode() === 11000) return false;
            throw $error;
        }
    }
    else $collection->updateOne(['_id' => $key], ['$set' => ['owner_id' => $ownerId]], ['session' => $session]);
    return true;
}

function mongoStaffRelease(string $key, string $ownerId, object $session): void {
    getMongoCollection('legacy_admin_constraint_locks')->deleteOne(['_id' => $key, 'owner_id' => $ownerId], ['session' => $session]);
}

function mongoStaffCanManage(array $actor, array $target, bool $status = false): bool {
    if (($actor['role'] ?? null) === 'Super Admin') return true;
    if (!$status && ($actor['id'] ?? null) === ($target['id'] ?? null)) return true;
    if (($actor['role'] ?? null) === 'Office Manager') {
        return ($target['office_id'] ?? null) === ($actor['office_id'] ?? null)
            && in_array($target['role'] ?? null, ['Team Leader', 'Agent'], true);
    }
    if (($actor['role'] ?? null) === 'Team Leader') {
        return ($target['role'] ?? null) === 'Agent'
            && !empty($actor['team_id'])
            && ($target['team_id'] ?? null) === $actor['team_id'];
    }
    return false;
}

function mongoStaffPublicRecord(string $staffId): ?array {
    $member = mongoFindOne('staff_users', ['id' => $staffId]);
    if (!$member) return null;
    $office = !empty($member['office_id']) ? mongoFindOne('offices', ['id' => $member['office_id']]) : null;
    $team = !empty($member['team_id']) ? mongoFindOne('teams', ['id' => $member['team_id']]) : null;
    $now = date('c');
    return [
        'id' => $member['id'] ?? null,
        'email' => $member['email'] ?? null,
        'name' => $member['name'] ?? null,
        'role' => $member['role'] ?? null,
        'office_id' => $member['office_id'] ?? null,
        'team_id' => $member['team_id'] ?? null,
        'status' => $member['status'] ?? null,
        'capabilities' => mongoRouteDecodeCapabilities($member['capabilities'] ?? null),
        'last_login_at' => $member['last_login_at'] ?? null,
        'created_at' => $member['created_at'] ?? null,
        'deleted_at' => $member['deleted_at'] ?? null,
        'deleted_scope_type' => $member['deleted_scope_type'] ?? null,
        'deleted_scope_id' => $member['deleted_scope_id'] ?? null,
        'office_name' => $office['name'] ?? null,
        'team_name' => $team['name'] ?? null,
        'is_online' => mongoRouteCount('admin_sessions', [
            'user_id' => $staffId,
            'expires_at' => ['$gt' => $now],
            'last_seen_at' => ['$gte' => date('c', time() - 90)],
        ]) > 0 ? 1 : 0,
        'client_count' => mongoRouteCount('clients', [
            'deleted_at' => null,
            '$or' => [['assigned_agent_id' => $staffId], ['assigned_team_leader_id' => $staffId]],
        ]),
    ];
}

function mongoStaffDefaultCapabilities(): array {
    return ['client_upload' => true, 'create_agent' => true, 'registrations' => true, 'notifications' => true, 'content' => true, 'enquiries' => true, 'chat' => true];
}

if (isMongoStorageEnabled()) {
    if ($apiPath === '/admin/staff') {
        $actor = mongoRouteAdminActor($adminSession);
        $includeDeleted = (string)($_GET['include_deleted'] ?? '');
        if ($includeDeleted !== '' && $actor['role'] !== 'Super Admin') {
            jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can view deleted staff.'], 403);
        }
        if ($method === 'POST') {
            $role = trim((string)($input['role'] ?? 'Agent'));
            if (!in_array($role, ['Office Manager', 'Team Leader', 'Agent', 'Super Admin'], true)) {
                jsonResponse(['ok' => false, 'error' => 'This role cannot be created through staff management.'], 422);
            }
            $name = trim((string)($input['name'] ?? ''));
            $password = (string)($input['password'] ?? '');
            if ($name === '' || strlen($password) < 8) jsonResponse(['ok' => false, 'error' => 'A name and a password of at least 8 characters are required.'], 422);
            $officeId = optionalId($input['office_id'] ?? null);
            $teamId = optionalId($input['team_id'] ?? null);
            if ($role === 'Super Admin' && $actor['role'] !== 'Super Admin') {
                jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can create another Super Admin.'], 403);
            } elseif ($role === 'Super Admin') {
                if ($officeId !== null || $teamId !== null) jsonResponse(['ok' => false, 'error' => 'A Super Admin cannot be assigned to an office or team.'], 422);
                $officeId = null;
                $teamId = null;
            } elseif ($actor['role'] === 'Office Manager') {
                if (!in_array($role, ['Team Leader', 'Agent'], true)) jsonResponse(['ok' => false, 'error' => 'Office Managers can only create Team Leaders and Agents.'], 403);
                if ($role === 'Agent' && (($actor['capabilities']['create_agent'] ?? true) === false)) {
                    jsonResponse(['ok' => false, 'error' => 'Agent creation is not enabled for your account.'], 403);
                }
                $officeId = optionalId($actor['office_id'] ?? null);
                if ($officeId === null) jsonResponse(['ok' => false, 'error' => 'Your account is not assigned to an office.'], 403);
            } elseif ($actor['role'] === 'Team Leader') {
                if ($role !== 'Agent' || empty($actor['team_id']) || $teamId !== $actor['team_id'] || (($actor['capabilities']['create_agent'] ?? true) === false)) {
                    jsonResponse(['ok' => false, 'error' => 'You can only create agents in your team.'], 403);
                }
                $officeId = optionalId($actor['office_id'] ?? null);
            } elseif ($actor['role'] !== 'Super Admin') {
                jsonResponse(['ok' => false, 'error' => 'Your role cannot create staff.'], 403);
            }

            $team = $teamId ? mongoFindOne('teams', ['id' => $teamId, 'deleted_at' => null]) : null;
            if ($teamId && !$team) jsonResponse(['ok' => false, 'error' => 'The selected team is unavailable.'], 422);
            if ($team && !empty($team['office_id'])) {
                if ($officeId !== null && $officeId !== $team['office_id']) jsonResponse(['ok' => false, 'error' => 'The selected team belongs to a different office.'], 422);
                $officeId = (string)$team['office_id'];
            }
            if ($officeId !== null && !mongoFindOne('offices', ['id' => $officeId, 'deleted_at' => null])) jsonResponse(['ok' => false, 'error' => 'The selected office is unavailable.'], 422);
            if ($role === 'Office Manager' && $teamId !== null) jsonResponse(['ok' => false, 'error' => 'An Office Manager cannot be assigned to a team.'], 422);
            if ($role === 'Team Leader' && $teamId !== null
                && mongoFindOne('staff_users', ['team_id' => $teamId, 'role' => 'Team Leader', 'deleted_at' => null])) {
                jsonResponse(['ok' => false, 'error' => 'This team already has a Team Leader.'], 409);
            }
            if ($role === 'Agent' && $team && $team['max_size'] !== null
                && mongoRouteCount('staff_users', ['team_id' => $teamId, 'role' => 'Agent', 'deleted_at' => null]) >= (int)$team['max_size']) {
                jsonResponse(['ok' => false, 'error' => 'This team is at capacity.'], 409);
            }
            $email = strtolower(trim((string)($input['email'] ?? '')));
            if ($role === 'Super Admin' && $email === '') jsonResponse(['ok' => false, 'error' => 'A valid email address is required for a Super Admin account.'], 422);
            $id = 'adm_' . bin2hex(random_bytes(8));
            $email = $email ?: strtolower($role === 'Agent' ? 'agent_' : ($role === 'Team Leader' ? 'leader_' : 'manager_')) . substr($id, 4) . '@codexdynamics.com';
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) jsonResponse(['ok' => false, 'error' => 'Enter a valid email address.'], 422);
            $hash = password_hash($password, PASSWORD_DEFAULT);
            if ($hash === false) jsonResponse(['ok' => false, 'error' => 'Could not securely save the staff password.'], 500);
            $now = date('c');
            $result = mongoStaffTransaction(static function (object $session) use ($id, $email, $hash, $name, $role, $officeId, $teamId, $now): array {
                if (mongoStaffEmailInUse($email, null, $session) || !mongoStaffClaim('email:' . $email, $id, $session)) {
                    return ['__abort' => true, 'conflict' => 'email'];
                }
                if ($officeId !== null && !mongoStaffFindOne('offices', ['id' => $officeId, 'deleted_at' => null], $session)) {
                    return ['__abort' => true, 'invalid' => 'office'];
                }
                $team = $teamId !== null ? mongoStaffFindOne('teams', ['id' => $teamId, 'deleted_at' => null], $session) : null;
                if ($teamId !== null && !$team) return ['__abort' => true, 'invalid' => 'team'];
                if ($role === 'Agent' && $team) {
                    if (!mongoStaffClaim('team_capacity:' . $teamId, 'team-capacity-guard', $session)) return ['__abort' => true, 'conflict' => 'capacity'];
                    if (($team['max_size'] ?? null) !== null) {
                        $count = getMongoCollection(mongoCollectionName('staff_users'))->countDocuments(['team_id' => $teamId, 'role' => 'Agent', 'deleted_at' => null], ['session' => $session]);
                        if ($count >= (int)$team['max_size']) return ['__abort' => true, 'conflict' => 'capacity'];
                    }
                }
                if ($role === 'Team Leader' && $teamId !== null) {
                    if (mongoStaffFindOne('staff_users', ['team_id' => $teamId, 'role' => 'Team Leader', 'deleted_at' => null], $session)
                        || mongoStaffFindOne('teams', ['leader_id' => ['$ne' => null], 'id' => $teamId], $session)
                        || !mongoStaffClaim('team_leader:' . $teamId, $id, $session)) return ['__abort' => true, 'conflict' => 'leader'];
                }
                if ($role === 'Office Manager' && $officeId !== null) {
                    if (mongoStaffFindOne('offices', ['id' => $officeId, 'manager_id' => ['$ne' => null], 'deleted_at' => null], $session)
                        || !mongoStaffClaim('office_manager:' . $officeId, $id, $session)) return ['__abort' => true, 'conflict' => 'manager'];
                }
                mongoStaffInsert([
                    'id' => $id, 'email' => $email, 'password' => $hash, 'name' => $name, 'role' => $role,
                    'office_id' => $officeId, 'team_id' => $teamId, 'status' => 'Active',
                    'capabilities' => mongoStaffDefaultCapabilities(), 'created_at' => $now, 'deleted_at' => null,
                ], $session);
                if ($role === 'Team Leader' && $teamId !== null) {
                    getMongoCollection(mongoCollectionName('teams'))->updateOne(['id' => $teamId], ['$set' => ['leader_id' => $id, 'leader_name' => $name]], ['session' => $session]);
                }
                if ($role === 'Office Manager' && $officeId !== null) {
                    getMongoCollection(mongoCollectionName('offices'))->updateOne(['id' => $officeId], ['$set' => ['manager_id' => $id, 'manager_name' => $name, 'manager_email' => $email]], ['session' => $session]);
                }
                return [];
            });
            if (($result['conflict'] ?? null) === 'email') jsonResponse(['ok' => false, 'error' => 'That email address is already in use.'], 409);
            if (($result['conflict'] ?? null) === 'capacity') jsonResponse(['ok' => false, 'error' => 'This team is at capacity.'], 409);
            if (($result['conflict'] ?? null) === 'leader') jsonResponse(['ok' => false, 'error' => 'This team already has a Team Leader.'], 409);
            if (($result['conflict'] ?? null) === 'manager') jsonResponse(['ok' => false, 'error' => 'This office already has an Office Manager.'], 409);
            if (($result['invalid'] ?? null) === 'team') jsonResponse(['ok' => false, 'error' => 'The selected team is unavailable.'], 422);
            if (($result['invalid'] ?? null) === 'office') jsonResponse(['ok' => false, 'error' => 'The selected office is unavailable.'], 422);
            jsonResponse(['ok' => true, 'staff' => mongoStaffPublicRecord($id)], 201);
        }
        if ($method !== 'GET') jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);

        $conditions = [];
        if ($includeDeleted === 'only') {
            $conditions[] = ['deleted_at' => ['$ne' => null]];
            $conditions[] = ['deleted_scope_type' => 'staff'];
        } elseif ($includeDeleted !== '1') {
            $conditions[] = ['deleted_at' => null];
        }
        if ($actor['role'] === 'Office Manager') {
            $officeId = optionalId($actor['office_id'] ?? null);
            if ($officeId === null) jsonResponse(['ok' => true, 'staff' => []]);
            $conditions[] = ['office_id' => $officeId];
        } elseif ($actor['role'] === 'Team Leader') {
            if (empty($actor['team_id'])) {
                $conditions[] = ['id' => $actor['id']];
            } else {
                $conditions[] = ['$or' => [['id' => $actor['id']], ['team_id' => $actor['team_id']]]];
            }
        } elseif ($actor['role'] === 'Agent') {
            $conditions[] = ['id' => $actor['id']];
        }
        $filter = count($conditions) === 1
            ? $conditions[0]
            : ($conditions === [] ? [] : ['$and' => $conditions]);
        $members = mongoFindMany('staff_users', $filter, ['sort' => ['name' => 1]]);
        $now = date('c');
        $onlineCutoff = date('c', time() - 90);
        $staff = [];
        foreach ($members as $member) {
            $office = !empty($member['office_id'])
                ? mongoFindOne('offices', ['id' => $member['office_id']])
                : null;
            $team = !empty($member['team_id'])
                ? mongoFindOne('teams', ['id' => $member['team_id']])
                : null;
            $staff[] = [
                'id' => $member['id'] ?? null,
                'email' => $member['email'] ?? null,
                'name' => $member['name'] ?? null,
                'role' => $member['role'] ?? null,
                'office_id' => $member['office_id'] ?? null,
                'team_id' => $member['team_id'] ?? null,
                'status' => $member['status'] ?? null,
                'capabilities' => mongoRouteDecodeCapabilities($member['capabilities'] ?? null),
                'last_login_at' => $member['last_login_at'] ?? null,
                'created_at' => $member['created_at'] ?? null,
                'deleted_at' => $member['deleted_at'] ?? null,
                'deleted_scope_type' => $member['deleted_scope_type'] ?? null,
                'deleted_scope_id' => $member['deleted_scope_id'] ?? null,
                'office_name' => $office['name'] ?? null,
                'team_name' => $team['name'] ?? null,
                'is_online' => mongoRouteCount('admin_sessions', [
                    'user_id' => $member['id'],
                    'expires_at' => ['$gt' => $now],
                    'last_seen_at' => ['$gte' => $onlineCutoff],
                ]) > 0 ? 1 : 0,
                'client_count' => mongoRouteCount('clients', [
                    'deleted_at' => null,
                    '$or' => [
                        ['assigned_agent_id' => $member['id']],
                        ['assigned_team_leader_id' => $member['id']],
                    ],
                ]),
            ];
        }
        jsonResponse(['ok' => true, 'staff' => $staff]);
    }

    if (preg_match('#^/admin/staff/([^/]+)/restore$#', $apiPath, $restoreMatch) && $method === 'POST') {
        mongoRouteRequireSuperAdmin($adminSession);
        $staffId = rawurldecode($restoreMatch[1]);
        $target = mongoFindOne('staff_users', ['id' => $staffId, 'deleted_at' => ['$ne' => null], 'deleted_scope_type' => 'staff']);
        if (!$target) jsonResponse(['ok' => false, 'error' => 'Deleted staff member not found.'], 404);
        $result = mongoStaffTransaction(static function (object $session) use ($staffId, $target): array {
            if (mongoStaffEmailInUse((string)$target['email'], $staffId, $session)
                || !mongoStaffClaim('email:' . strtolower(trim((string)$target['email'])), $staffId, $session)) {
                return ['__abort' => true, 'conflict' => 'email'];
            }
            $officeId = optionalId($target['office_id'] ?? null);
            $teamId = optionalId($target['team_id'] ?? null);
            if ($officeId !== null && !mongoStaffFindOne('offices', ['id' => $officeId, 'deleted_at' => null], $session)) return ['__abort' => true, 'conflict' => 'office'];
            $team = $teamId !== null ? mongoStaffFindOne('teams', ['id' => $teamId, 'deleted_at' => null], $session) : null;
            if ($teamId !== null && !$team) return ['__abort' => true, 'conflict' => 'team'];
            if ($team && !empty($team['office_id']) && $officeId !== null && $officeId !== $team['office_id']) return ['__abort' => true, 'conflict' => 'office'];
            if (($target['role'] ?? null) === 'Agent' && $team) {
                if (!mongoStaffClaim('team_capacity:' . $teamId, 'team-capacity-guard', $session)) return ['__abort' => true, 'conflict' => 'capacity'];
                if (($team['max_size'] ?? null) !== null) {
                    $count = getMongoCollection(mongoCollectionName('staff_users'))->countDocuments(['team_id' => $teamId, 'role' => 'Agent', 'deleted_at' => null], ['session' => $session]);
                    if ($count >= (int)$team['max_size']) return ['__abort' => true, 'conflict' => 'capacity'];
                }
            }
            if (($target['role'] ?? null) === 'Team Leader' && $teamId !== null) {
                if (mongoStaffFindOne('staff_users', ['team_id' => $teamId, 'role' => 'Team Leader', 'deleted_at' => null], $session)
                    || !mongoStaffClaim('team_leader:' . $teamId, $staffId, $session)) return ['__abort' => true, 'conflict' => 'leader'];
            }
            if (($target['role'] ?? null) === 'Office Manager' && $officeId !== null) {
                $office = mongoStaffFindOne('offices', ['id' => $officeId, 'deleted_at' => null], $session);
                if (($office['manager_id'] ?? null) !== null && ($office['manager_id'] ?? null) !== $staffId) return ['__abort' => true, 'conflict' => 'manager'];
                if (!mongoStaffClaim('office_manager:' . $officeId, $staffId, $session)) return ['__abort' => true, 'conflict' => 'manager'];
            }
            getMongoCollection(mongoCollectionName('staff_users'))->updateOne(
                ['id' => $staffId, 'deleted_scope_type' => 'staff'],
                ['$set' => ['deleted_at' => null, 'deleted_scope_type' => null, 'deleted_scope_id' => null]],
                ['session' => $session],
            );
            if (($target['role'] ?? null) === 'Team Leader' && $teamId !== null) {
                getMongoCollection(mongoCollectionName('teams'))->updateOne(['id' => $teamId], ['$set' => ['leader_id' => $staffId, 'leader_name' => $target['name']]], ['session' => $session]);
            }
            if (($target['role'] ?? null) === 'Office Manager' && $officeId !== null) {
                getMongoCollection(mongoCollectionName('offices'))->updateOne(['id' => $officeId], ['$set' => ['manager_id' => $staffId, 'manager_name' => $target['name'], 'manager_email' => $target['email']]], ['session' => $session]);
            }
            return ['clients' => mongoOfficeRestoreSnapshots('staff', $staffId, $session)];
        });
        $conflictErrors = [
            'email' => 'That email address is already in use.',
            'office' => 'Restore the parent office before restoring this staff member.',
            'team' => 'The selected team is unavailable.',
            'capacity' => 'This team is at capacity.',
            'leader' => 'This team already has a Team Leader.',
            'manager' => 'This office already has an Office Manager.',
        ];
        if (isset($result['conflict'])) jsonResponse(['ok' => false, 'error' => $conflictErrors[$result['conflict']] ?? 'This staff member cannot be restored.'], 409);
        jsonResponse(['ok' => true, 'staff' => mongoStaffPublicRecord($staffId), 'clients' => $result['clients']]);
    }

    if (preg_match('#^/admin/staff/([^/]+)/capabilities$#', $apiPath, $mongoCapabilityMatch)) {
        $actor = mongoRouteAdminActor($adminSession);
        $staffId = rawurldecode($mongoCapabilityMatch[1]);
        $target = mongoFindOne('staff_users', ['id' => $staffId, 'deleted_at' => null]);
        if (!$target) jsonResponse(['ok' => false, 'error' => 'Staff member not found.'], 404);
        if ($method === 'GET') {
            if ($actor['role'] !== 'Super Admin' && $actor['id'] !== $staffId) {
                jsonResponse(['ok' => false, 'error' => 'You cannot view these staff permissions.'], 403);
            }
            jsonResponse(['ok' => true, 'capabilities' => mongoRouteDecodeCapabilities($target['capabilities'] ?? null)]);
        }
        if ($method !== 'PUT') jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
        if ($actor['role'] !== 'Super Admin') jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can change staff permissions.'], 403);
        $allowed = ['client_upload', 'create_agent', 'registrations', 'notifications', 'security', 'content', 'enquiries', 'chat'];
        $requested = $input['capabilities'] ?? null;
        if (!is_array($requested)) jsonResponse(['ok' => false, 'error' => 'A capabilities object is required.'], 422);
        if (array_diff(array_keys($requested), $allowed)) jsonResponse(['ok' => false, 'error' => 'One or more capability names are not supported.'], 422);
        foreach ($requested as $value) if (!is_bool($value)) jsonResponse(['ok' => false, 'error' => 'Capability values must be true or false.'], 422);
        $capabilities = array_fill_keys($allowed, true);
        $existing = mongoRouteDecodeCapabilities($target['capabilities'] ?? null);
        foreach ($allowed as $key) if (array_key_exists($key, $existing)) $capabilities[$key] = (bool)$existing[$key];
        foreach ($requested as $key => $enabled) $capabilities[$key] = $enabled;
        mongoStaffTransaction(static function (object $session) use ($staffId, $capabilities, $actor): array {
            getMongoCollection(mongoCollectionName('staff_users'))->updateOne(['id' => $staffId, 'deleted_at' => null], ['$set' => ['capabilities' => $capabilities]], ['session' => $session]);
            $auditId = 'aud_' . bin2hex(random_bytes(8));
            getMongoCollection(mongoCollectionName('audit_logs'))->insertOne([
                '_id' => $auditId, 'id' => $auditId, 'user_id' => $staffId,
                'action' => 'STAFF_CAPABILITIES_UPDATED',
                'details' => 'Updated CRM tool permissions by ' . $actor['id'] . '.',
                'created_at' => date('c'),
            ], ['session' => $session]);
            return [];
        });
        jsonResponse([
            'ok' => true,
            'capabilities' => $capabilities,
        ]);
    }

    if (preg_match('#^/admin/staff/([^/]+)(?:/(block|unblock))?$#', $apiPath, $staffMatch)) {
        $actor = mongoRouteAdminActor($adminSession);
        $staffId = rawurldecode($staffMatch[1]);
        $action = $staffMatch[2] ?? '';
        $permanent = $method === 'DELETE' && (string)($_GET['permanent'] ?? '') === '1';
        $target = mongoFindOne('staff_users', $permanent
            ? ['id' => $staffId, 'deleted_at' => ['$ne' => null], 'deleted_scope_type' => 'staff']
            : ['id' => $staffId, 'deleted_at' => null]);
        if (!$target) jsonResponse(['ok' => false, 'error' => 'Staff member not found.'], 404);
        if (($target['role'] ?? null) === 'Super Admin'
            && ($method === 'DELETE' || ($action === 'block' && $method === 'POST'))) {
            if ($actor['id'] === $staffId && $method === 'DELETE') jsonResponse(['ok' => false, 'error' => 'You cannot delete your own Super Admin account.'], 409);
            if ($actor['id'] === $staffId && $action === 'block') jsonResponse(['ok' => false, 'error' => 'You cannot suspend your own Super Admin account.'], 409);
            if (($target['status'] ?? null) === 'Active'
                && mongoRouteCount('staff_users', ['role' => 'Super Admin', 'status' => 'Active', 'deleted_at' => null]) <= 1) {
                jsonResponse(['ok' => false, 'error' => 'At least one active Super Admin account must remain.'], 409);
            }
        }
        if (($action === 'block' || $action === 'unblock') && $method === 'POST') {
            if (!mongoStaffCanManage($actor, $target, true)) jsonResponse(['ok' => false, 'error' => 'You cannot change this staff member’s access.'], 403);
            $status = $action === 'block' ? 'Suspended' : 'Active';
            $result = mongoStaffTransaction(static function (object $session) use ($staffId, $status, $action, $target): array {
                if ($action === 'block' && ($target['role'] ?? null) === 'Super Admin' && ($target['status'] ?? null) === 'Active') {
                    if (!mongoStaffClaim('active_super_admin_guard', 'active-super-admin-guard', $session)) return ['__abort' => true, 'last_super_admin' => true];
                    $count = getMongoCollection(mongoCollectionName('staff_users'))->countDocuments(['role' => 'Super Admin', 'status' => 'Active', 'deleted_at' => null], ['session' => $session]);
                    if ($count <= 1) return ['__abort' => true, 'last_super_admin' => true];
                }
                getMongoCollection(mongoCollectionName('staff_users'))->updateOne(['id' => $staffId, 'deleted_at' => null], ['$set' => ['status' => $status]], ['session' => $session]);
                if ($action === 'block') getMongoCollection(mongoCollectionName('admin_sessions'))->deleteMany(['user_id' => $staffId], ['session' => $session]);
                return [];
            });
            if (!empty($result['last_super_admin'])) jsonResponse(['ok' => false, 'error' => 'At least one active Super Admin account must remain.'], 409);
            jsonResponse(['ok' => true, 'staff' => mongoStaffPublicRecord($staffId)]);
        }
        if ($method === 'PATCH') {
            if (!mongoStaffCanManage($actor, $target)) jsonResponse(['ok' => false, 'error' => 'You cannot edit this staff member.'], 403);
            $isSelf = $actor['id'] === $staffId;
            if (!$isSelf && $actor['role'] !== 'Super Admin' && (array_key_exists('office_id', $input) || array_key_exists('team_id', $input))) {
                jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can move staff between offices or teams.'], 403);
            }
            $name = array_key_exists('name', $input) ? trim((string)$input['name']) : (string)$target['name'];
            if ($name === '') jsonResponse(['ok' => false, 'error' => 'Staff name is required.'], 422);
            $email = array_key_exists('email', $input) ? strtolower(trim((string)$input['email'])) : (string)$target['email'];
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) jsonResponse(['ok' => false, 'error' => 'Enter a valid email address.'], 422);
            $passwordHash = null;
            if (isset($input['password']) && (string)$input['password'] !== '') {
                if (strlen((string)$input['password']) < 8) jsonResponse(['ok' => false, 'error' => 'Staff passwords must be at least 8 characters.'], 422);
                $passwordHash = password_hash((string)$input['password'], PASSWORD_DEFAULT);
                if ($passwordHash === false) jsonResponse(['ok' => false, 'error' => 'Could not securely save the staff password.'], 500);
            }
            $officeId = optionalId($input['office_id'] ?? $target['office_id'] ?? null);
            $teamId = optionalId($input['team_id'] ?? $target['team_id'] ?? null);
            if ($actor['role'] !== 'Super Admin' || $isSelf) {
                $officeId = optionalId($target['office_id'] ?? null);
                $teamId = optionalId($target['team_id'] ?? null);
            }
            $team = $teamId ? mongoFindOne('teams', ['id' => $teamId, 'deleted_at' => null]) : null;
            if ($teamId && !$team) jsonResponse(['ok' => false, 'error' => 'The selected team is unavailable.'], 422);
            if ($team && !empty($team['office_id'])) {
                if ($officeId !== null && $officeId !== $team['office_id']) jsonResponse(['ok' => false, 'error' => 'The selected team belongs to a different office.'], 422);
                $officeId = (string)$team['office_id'];
            }
            if ($officeId !== null && !mongoFindOne('offices', ['id' => $officeId, 'deleted_at' => null])) jsonResponse(['ok' => false, 'error' => 'The selected office is unavailable.'], 422);
            if (($target['role'] ?? null) === 'Office Manager' && $teamId !== null) jsonResponse(['ok' => false, 'error' => 'An Office Manager cannot be assigned to a team.'], 422);
            if (($target['role'] ?? null) === 'Agent' && $team && ($team['max_size'] ?? null) !== null && $teamId !== ($target['team_id'] ?? null)) {
                $count = mongoRouteCount('staff_users', ['team_id' => $teamId, 'role' => 'Agent', 'deleted_at' => null, 'id' => ['$ne' => $staffId]]);
                if ($count >= (int)$team['max_size']) jsonResponse(['ok' => false, 'error' => 'This team is at capacity.'], 409);
            }
            if (($target['role'] ?? null) === 'Team Leader' && $teamId !== null && $teamId !== ($target['team_id'] ?? null)
                && mongoFindOne('staff_users', ['team_id' => $teamId, 'role' => 'Team Leader', 'deleted_at' => null, 'id' => ['$ne' => $staffId]])) {
                jsonResponse(['ok' => false, 'error' => 'This team already has a Team Leader.'], 409);
            }
            if (($target['role'] ?? null) === 'Office Manager' && $officeId !== null && $officeId !== ($target['office_id'] ?? null)) {
                $assigned = mongoFindOne('offices', ['id' => $officeId, 'manager_id' => ['$ne' => null], 'deleted_at' => null]);
                if ($assigned && ($assigned['manager_id'] ?? null) !== $staffId) jsonResponse(['ok' => false, 'error' => 'This office already has an Office Manager.'], 409);
            }
            $now = date('c');
            $result = mongoStaffTransaction(static function (object $session) use ($target, $staffId, $name, $email, $passwordHash, $officeId, $teamId, $now): array {
                if (mongoStaffEmailInUse($email, $staffId, $session)
                    || !mongoStaffClaim('email:' . $email, $staffId, $session)) return ['__abort' => true, 'conflict' => 'email'];
                $role = (string)$target['role'];
                if ($role === 'Agent' && $teamId !== null) {
                    if (!mongoStaffClaim('team_capacity:' . $teamId, 'team-capacity-guard', $session)) return ['__abort' => true, 'conflict' => 'capacity'];
                    $team = mongoStaffFindOne('teams', ['id' => $teamId, 'deleted_at' => null], $session);
                    if (!$team) return ['__abort' => true, 'invalid' => 'team'];
                    if (($team['max_size'] ?? null) !== null && $teamId !== ($target['team_id'] ?? null)) {
                        $count = getMongoCollection(mongoCollectionName('staff_users'))->countDocuments(['team_id' => $teamId, 'role' => 'Agent', 'deleted_at' => null, 'id' => ['$ne' => $staffId]], ['session' => $session]);
                        if ($count >= (int)$team['max_size']) return ['__abort' => true, 'conflict' => 'capacity'];
                    }
                }
                if ($role === 'Team Leader' && $teamId !== null) {
                    $team = mongoStaffFindOne('teams', ['id' => $teamId, 'deleted_at' => null], $session);
                    if (!$team || (!empty($team['leader_id']) && $team['leader_id'] !== $staffId)
                        || mongoStaffFindOne('staff_users', ['team_id' => $teamId, 'role' => 'Team Leader', 'deleted_at' => null, 'id' => ['$ne' => $staffId]], $session)
                        || !mongoStaffClaim('team_leader:' . $teamId, $staffId, $session)) return ['__abort' => true, 'conflict' => 'leader'];
                }
                if ($role === 'Office Manager' && $officeId !== null) {
                    $office = mongoStaffFindOne('offices', ['id' => $officeId, 'deleted_at' => null], $session);
                    if (!$office || (($office['manager_id'] ?? null) !== null && ($office['manager_id'] ?? null) !== $staffId)
                        || !mongoStaffClaim('office_manager:' . $officeId, $staffId, $session)) return ['__abort' => true, 'conflict' => 'manager'];
                }
                $updates = ['name' => $name, 'email' => $email, 'office_id' => $officeId, 'team_id' => $teamId];
                if ($passwordHash !== null) $updates['password'] = $passwordHash;
                getMongoCollection(mongoCollectionName('staff_users'))->updateOne(['id' => $staffId, 'deleted_at' => null], ['$set' => $updates], ['session' => $session]);
                if (strcasecmp((string)$target['email'], $email) !== 0) mongoStaffRelease('email:' . strtolower(trim((string)$target['email'])), $staffId, $session);
                if ($role === 'Team Leader') {
                    getMongoCollection(mongoCollectionName('teams'))->updateMany(['leader_id' => $staffId], ['$set' => ['leader_id' => null, 'leader_name' => null]], ['session' => $session]);
                    if ($teamId !== null) getMongoCollection(mongoCollectionName('teams'))->updateOne(['id' => $teamId], ['$set' => ['leader_id' => $staffId, 'leader_name' => $name]], ['session' => $session]);
                    if (($target['team_id'] ?? null) !== $teamId && !empty($target['team_id'])) mongoStaffRelease('team_leader:' . $target['team_id'], $staffId, $session);
                    getMongoCollection(mongoCollectionName('clients'))->updateMany(['assigned_team_leader_id' => $staffId, 'assigned_agent_id' => null, 'deleted_at' => null], ['$set' => ['assigned_office_id' => $officeId, 'assigned_team_id' => $teamId, 'updated_at' => $now]], ['session' => $session]);
                } elseif ($role === 'Agent') {
                    getMongoCollection(mongoCollectionName('clients'))->updateMany(['assigned_agent_id' => $staffId, 'deleted_at' => null], ['$set' => ['assigned_office_id' => $officeId, 'assigned_team_id' => $teamId, 'updated_at' => $now]], ['session' => $session]);
                } elseif ($role === 'Office Manager') {
                    getMongoCollection(mongoCollectionName('offices'))->updateMany(['manager_id' => $staffId], ['$set' => ['manager_id' => null]], ['session' => $session]);
                    if ($officeId !== null) getMongoCollection(mongoCollectionName('offices'))->updateOne(['id' => $officeId], ['$set' => ['manager_id' => $staffId, 'manager_name' => $name, 'manager_email' => $email]], ['session' => $session]);
                    if (($target['office_id'] ?? null) !== $officeId && !empty($target['office_id'])) mongoStaffRelease('office_manager:' . $target['office_id'], $staffId, $session);
                }
                if ($role === 'Team Leader') getMongoCollection(mongoCollectionName('teams'))->updateMany(['leader_id' => $staffId], ['$set' => ['leader_name' => $name]], ['session' => $session]);
                return [];
            });
            if (($result['conflict'] ?? null) === 'email') jsonResponse(['ok' => false, 'error' => 'That email address is already in use.'], 409);
            if (($result['conflict'] ?? null) === 'capacity') jsonResponse(['ok' => false, 'error' => 'This team is at capacity.'], 409);
            if (($result['conflict'] ?? null) === 'leader') jsonResponse(['ok' => false, 'error' => 'This team already has a Team Leader.'], 409);
            if (($result['conflict'] ?? null) === 'manager') jsonResponse(['ok' => false, 'error' => 'This office already has an Office Manager.'], 409);
            if (($result['invalid'] ?? null) === 'team') jsonResponse(['ok' => false, 'error' => 'The selected team is unavailable.'], 422);
            jsonResponse(['ok' => true, 'staff' => mongoStaffPublicRecord($staffId)]);
        }
        if ($method === 'DELETE') {
            mongoRouteRequireSuperAdmin($adminSession);
            $now = date('c');
            $result = mongoStaffTransaction(static function (object $session) use ($target, $staffId, $permanent, $now, $actor): array {
                if (($target['role'] ?? null) === 'Super Admin' && ($target['status'] ?? null) === 'Active') {
                    if (!mongoStaffClaim('active_super_admin_guard', 'active-super-admin-guard', $session)) return ['__abort' => true, 'last_super_admin' => true];
                    $count = getMongoCollection(mongoCollectionName('staff_users'))->countDocuments(['role' => 'Super Admin', 'status' => 'Active', 'deleted_at' => null], ['session' => $session]);
                    if ($count <= 1) return ['__abort' => true, 'last_super_admin' => true];
                }
                if ($permanent) {
                    getMongoCollection(mongoCollectionName('clients'))->updateMany(
                        ['$or' => [['assigned_agent_id' => $staffId], ['assigned_team_leader_id' => $staffId]]],
                        ['$set' => ['assigned_office_id' => null, 'assigned_team_id' => null, 'assigned_team_leader_id' => null, 'assigned_agent_id' => null, 'assigned_by' => null]],
                        ['session' => $session],
                    );
                    getMongoCollection(mongoCollectionName('teams'))->updateMany(['leader_id' => $staffId], ['$set' => ['leader_id' => null, 'leader_name' => null]], ['session' => $session]);
                    getMongoCollection(mongoCollectionName('offices'))->updateMany(['manager_id' => $staffId], ['$set' => ['manager_id' => null, 'manager_name' => 'Unassigned', 'manager_email' => '']], ['session' => $session]);
                    getMongoCollection(mongoCollectionName('admin_sessions'))->deleteMany(['user_id' => $staffId], ['session' => $session]);
                    getMongoCollection(mongoCollectionName('crm_assignment_restore'))->deleteMany(['entity_type' => 'staff', 'entity_id' => $staffId], ['session' => $session]);
                    getMongoCollection(mongoCollectionName('staff_users'))->deleteOne(['id' => $staffId], ['session' => $session]);
                    mongoStaffRelease('email:' . strtolower(trim((string)($target['email'] ?? ''))), $staffId, $session);
                } else {
                    $clientIds = mongoOfficeSnapshotClear('staff', $staffId, ['$or' => [['assigned_agent_id' => $staffId], ['assigned_team_leader_id' => $staffId]]], $actor['id'], $session);
                    getMongoCollection(mongoCollectionName('staff_users'))->updateOne(['id' => $staffId, 'deleted_at' => null], ['$set' => ['deleted_at' => $now, 'deleted_scope_type' => 'staff', 'deleted_scope_id' => $staffId]], ['session' => $session]);
                    getMongoCollection(mongoCollectionName('admin_sessions'))->deleteMany(['user_id' => $staffId], ['session' => $session]);
                    return ['client_ids' => $clientIds];
                }
                if (($target['role'] ?? null) === 'Team Leader' && !empty($target['team_id'])) mongoStaffRelease('team_leader:' . $target['team_id'], $staffId, $session);
                if (($target['role'] ?? null) === 'Office Manager' && !empty($target['office_id'])) mongoStaffRelease('office_manager:' . $target['office_id'], $staffId, $session);
                return [];
            });
            if (!empty($result['last_super_admin'])) jsonResponse(['ok' => false, 'error' => 'At least one active Super Admin account must remain.'], 409);
            if ($permanent) jsonResponse(['ok' => true]);
            jsonResponse(['ok' => true, 'deleted_at' => $now, 'client_ids' => $result['client_ids']]);
        }
        jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }
}

// -----------------------------------------------------------------------------
// 11. ADMIN: STAFF (AGENTS, TEAM LEADERS, MANAGERS)
// -----------------------------------------------------------------------------
if ($apiPath === '/admin/staff') {
    $actor = requireActiveAdminStaff($pdo, $adminSession);
    $includeDeleted = (string)($_GET['include_deleted'] ?? '');
    if ($includeDeleted !== '' && $actor['role'] !== 'Super Admin') {
        jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can view deleted staff.'], 403);
    }
    if ($method === 'POST') {
        $role = trim((string)($input['role'] ?? 'Agent'));
        if (!in_array($role, ['Office Manager', 'Team Leader', 'Agent', 'Super Admin'], true)) {
            jsonResponse(['ok' => false, 'error' => 'This role cannot be created through staff management.'], 422);
        }
        $name = trim((string)($input['name'] ?? ''));
        $password = (string)($input['password'] ?? '');
        if ($name === '' || strlen($password) < 8) jsonResponse(['ok' => false, 'error' => 'A name and a password of at least 8 characters are required.'], 422);
        $officeId = optionalId($input['office_id'] ?? null);
        $teamId = optionalId($input['team_id'] ?? null);
        if ($role === 'Super Admin' && $actor['role'] !== 'Super Admin') {
            jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can create another Super Admin.'], 403);
        } elseif ($role === 'Super Admin') {
            if ($officeId !== null || $teamId !== null) jsonResponse(['ok' => false, 'error' => 'A Super Admin cannot be assigned to an office or team.'], 422);
            $officeId = null;
            $teamId = null;
        } elseif ($actor['role'] === 'Office Manager') {
            if (!in_array($role, ['Team Leader', 'Agent'], true)) jsonResponse(['ok' => false, 'error' => 'Office Managers can only create Team Leaders and Agents.'], 403);
            if ($role === 'Agent' && (($actor['capabilities']['create_agent'] ?? true) === false)) {
                jsonResponse(['ok' => false, 'error' => 'Agent creation is not enabled for your account.'], 403);
            }
            $officeId = optionalId($actor['office_id'] ?? null);
            if ($officeId === null) jsonResponse(['ok' => false, 'error' => 'Your account is not assigned to an office.'], 403);
        } elseif ($actor['role'] === 'Team Leader') {
            if ($role !== 'Agent' || empty($actor['team_id']) || $teamId !== $actor['team_id'] || (($actor['capabilities']['create_agent'] ?? true) === false)) {
                jsonResponse(['ok' => false, 'error' => 'You can only create agents in your team.'], 403);
            }
            $officeId = optionalId($actor['office_id'] ?? null);
        } elseif ($actor['role'] !== 'Super Admin') {
            jsonResponse(['ok' => false, 'error' => 'Your role cannot create staff.'], 403);
        }

        $team = $teamId ? activeTeam($pdo, $teamId) : null;
        if ($teamId && !$team) jsonResponse(['ok' => false, 'error' => 'The selected team is unavailable.'], 422);
        if ($team && !empty($team['office_id'])) {
            if ($officeId !== null && $officeId !== $team['office_id']) jsonResponse(['ok' => false, 'error' => 'The selected team belongs to a different office.'], 422);
            $officeId = (string)$team['office_id'];
        }
        if ($officeId !== null && !activeOffice($pdo, $officeId)) jsonResponse(['ok' => false, 'error' => 'The selected office is unavailable.'], 422);
        if ($role === 'Office Manager' && $teamId !== null) jsonResponse(['ok' => false, 'error' => 'An Office Manager cannot be assigned to a team.'], 422);
        if ($role === 'Team Leader' && $teamId !== null) {
            $q = $pdo->prepare("SELECT id FROM staff_users WHERE team_id = ? AND role = 'Team Leader' AND deleted_at IS NULL");
            $q->execute([$teamId]);
            if ($q->fetchColumn()) jsonResponse(['ok' => false, 'error' => 'This team already has a Team Leader.'], 409);
        }
        if ($role === 'Agent' && $team && $team['max_size'] !== null) {
            $q = $pdo->prepare("SELECT COUNT(*) FROM staff_users WHERE team_id = ? AND role = 'Agent' AND deleted_at IS NULL");
            $q->execute([$teamId]);
            if ((int)$q->fetchColumn() >= (int)$team['max_size']) jsonResponse(['ok' => false, 'error' => 'This team is at capacity.'], 409);
        }
        $email = strtolower(trim((string)($input['email'] ?? '')));
        if ($role === 'Super Admin' && $email === '') {
            jsonResponse(['ok' => false, 'error' => 'A valid email address is required for a Super Admin account.'], 422);
        }
        $id = 'adm_' . bin2hex(random_bytes(8));
        $email = $email ?: strtolower($role === 'Agent' ? 'agent_' : ($role === 'Team Leader' ? 'leader_' : 'manager_')) . substr($id, 4) . '@codexdynamics.com';
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) jsonResponse(['ok' => false, 'error' => 'Enter a valid email address.'], 422);
        $q = $pdo->prepare('SELECT id FROM staff_users WHERE LOWER(email) = ?');
        $q->execute([$email]);
        if ($q->fetchColumn()) jsonResponse(['ok' => false, 'error' => 'That email address is already in use.'], 409);
        if ($role === 'Office Manager' && $officeId !== null) {
            $q = $pdo->prepare('SELECT id FROM offices WHERE id = ? AND manager_id IS NOT NULL AND deleted_at IS NULL');
            $q->execute([$officeId]);
            if ($q->fetchColumn()) jsonResponse(['ok' => false, 'error' => 'This office already has an Office Manager.'], 409);
        }
        $now = date('c');
        $caps = json_encode(['client_upload' => true, 'create_agent' => true, 'registrations' => true, 'notifications' => true, 'content' => true, 'enquiries' => true, 'chat' => true]);
        $hash = password_hash($password, PASSWORD_DEFAULT);
        if ($hash === false) jsonResponse(['ok' => false, 'error' => 'Could not securely save the staff password.'], 500);
        $pdo->beginTransaction();
        try {
            $pdo->prepare("INSERT INTO staff_users (id, email, password, name, role, office_id, team_id, status, capabilities, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?)")
                ->execute([$id, $email, $hash, $name, $role, $officeId, $teamId, $caps, $now]);
            if ($role === 'Team Leader' && $teamId !== null) {
                $pdo->prepare('UPDATE teams SET leader_id = ?, leader_name = ? WHERE id = ?')->execute([$id, $name, $teamId]);
            }
            if ($role === 'Office Manager' && $officeId !== null) {
                $pdo->prepare('UPDATE offices SET manager_id = ?, manager_name = ?, manager_email = ? WHERE id = ?')->execute([$id, $name, $email, $officeId]);
            }
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
        jsonResponse(['ok' => true, 'staff' => publicStaffRecord($pdo, $id)], 201);
    }
    if ($method !== 'GET') jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    $filter = $includeDeleted === 'only'
        ? "s.deleted_at IS NOT NULL AND s.deleted_scope_type = 'staff'"
        : ($includeDeleted === '1' ? '1=1' : 's.deleted_at IS NULL');
    $params = [];
    if ($actor['role'] === 'Office Manager') {
        $officeId = optionalId($actor['office_id'] ?? null);
        if ($officeId === null) jsonResponse(['ok' => true, 'staff' => []]);
        $filter .= ' AND s.office_id = ?';
        $params[] = $officeId;
    } elseif ($actor['role'] === 'Team Leader') {
        if (empty($actor['team_id'])) $filter .= ' AND s.id = ?';
        else $filter .= ' AND (s.id = ? OR s.team_id = ?)';
        $params[] = $actor['id'];
        if (!empty($actor['team_id'])) $params[] = $actor['team_id'];
    } elseif ($actor['role'] === 'Agent') {
        $filter .= ' AND s.id = ?';
        $params[] = $actor['id'];
    }
    $onlineSql = staffOnlineSql($pdo);
    $sql = "
        SELECT s.id, s.email, s.name, s.role, s.office_id, s.team_id, s.status, s.capabilities,
               s.last_login_at, s.created_at, s.deleted_at, s.deleted_scope_type, s.deleted_scope_id,
               o.name AS office_name, t.name AS team_name,
                {$onlineSql} AS is_online,
               (SELECT COUNT(*) FROM clients l WHERE l.deleted_at IS NULL AND (l.assigned_agent_id = s.id OR l.assigned_team_leader_id = s.id)) AS client_count
        FROM staff_users s
        LEFT JOIN offices o ON o.id = s.office_id
        LEFT JOIN teams t ON t.id = s.team_id
        WHERE {$filter} ORDER BY s.name ASC
    ";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $staff = $stmt->fetchAll();
    foreach ($staff as &$member) $member['capabilities'] = json_decode((string)($member['capabilities'] ?? '{}'), true) ?: [];
    unset($member);
    jsonResponse(['ok' => true, 'staff' => $staff]);
}

if (preg_match('#^/admin/staff/([^/]+)/restore$#', $apiPath, $m) && $method === 'POST') {
    requireSuperAdmin($pdo, $adminSession);
    $staffId = rawurldecode($m[1]);
    $q = $pdo->prepare("SELECT id FROM staff_users WHERE id = ? AND deleted_at IS NOT NULL AND deleted_scope_type = 'staff'");
    $q->execute([$staffId]);
    if (!$q->fetchColumn()) jsonResponse(['ok' => false, 'error' => 'Deleted staff member not found.'], 404);
    $pdo->beginTransaction();
    try {
        $pdo->prepare('UPDATE staff_users SET deleted_at = NULL, deleted_scope_type = NULL, deleted_scope_id = NULL WHERE id = ?')->execute([$staffId]);
        $clients = restoreClientAssignmentSnapshots($pdo, 'staff', $staffId);
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
    jsonResponse(['ok' => true, 'staff' => publicStaffRecord($pdo, $staffId), 'clients' => $clients]);
}

if (preg_match('#^/admin/staff/([^/]+)/capabilities$#', $apiPath, $capabilityMatch)) {
    $actor = requireActiveAdminStaff($pdo, $adminSession);
    $staffId = rawurldecode($capabilityMatch[1]);
    $targetStmt = $pdo->prepare('SELECT id, role, capabilities FROM staff_users WHERE id = ? AND deleted_at IS NULL');
    $targetStmt->execute([$staffId]);
    $target = $targetStmt->fetch();
    if (!$target) jsonResponse(['ok' => false, 'error' => 'Staff member not found.'], 404);

    if ($method === 'GET') {
        if ($actor['role'] !== 'Super Admin' && $actor['id'] !== $staffId) {
            jsonResponse(['ok' => false, 'error' => 'You cannot view these staff permissions.'], 403);
        }
        jsonResponse([
            'ok' => true,
            'capabilities' => json_decode((string)($target['capabilities'] ?? '{}'), true) ?: [],
        ]);
    }

    if ($method !== 'PUT') jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    if ($actor['role'] !== 'Super Admin') {
        jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can change staff permissions.'], 403);
    }
    $allowedCapabilities = ['client_upload', 'create_agent', 'registrations', 'notifications', 'security', 'content', 'enquiries', 'chat'];
    $requested = $input['capabilities'] ?? null;
    if (!is_array($requested)) jsonResponse(['ok' => false, 'error' => 'A capabilities object is required.'], 422);
    if (array_diff(array_keys($requested), $allowedCapabilities)) {
        jsonResponse(['ok' => false, 'error' => 'One or more capability names are not supported.'], 422);
    }
    foreach ($requested as $value) {
        if (!is_bool($value)) jsonResponse(['ok' => false, 'error' => 'Capability values must be true or false.'], 422);
    }
    $capabilities = array_fill_keys($allowedCapabilities, true);
    $existing = json_decode((string)($target['capabilities'] ?? '{}'), true);
    if (is_array($existing)) {
        foreach ($allowedCapabilities as $key) {
            if (array_key_exists($key, $existing)) $capabilities[$key] = (bool)$existing[$key];
        }
    }
    foreach ($requested as $key => $enabled) $capabilities[$key] = $enabled;
    $pdo->prepare('UPDATE staff_users SET capabilities = ? WHERE id = ?')
        ->execute([json_encode($capabilities, JSON_THROW_ON_ERROR), $staffId]);
    $pdo->prepare('INSERT INTO audit_logs (id, user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)')
        ->execute([
            'aud_' . bin2hex(random_bytes(8)),
            $staffId,
            'STAFF_CAPABILITIES_UPDATED',
            'Updated CRM tool permissions by ' . $actor['id'] . '.',
            date('c'),
        ]);
    jsonResponse(['ok' => true, 'capabilities' => $capabilities]);
}

if (preg_match('#^/admin/staff/([^/]+)(?:/(block|unblock))?$#', $apiPath, $m)) {
    $actor = requireActiveAdminStaff($pdo, $adminSession);
    $staffId = rawurldecode($m[1]);
    $action = $m[2] ?? '';
    $permanent = $method === 'DELETE' && (string)($_GET['permanent'] ?? '') === '1';
    $q = $pdo->prepare($permanent
        ? "SELECT * FROM staff_users WHERE id = ? AND deleted_at IS NOT NULL AND deleted_scope_type = 'staff'"
        : 'SELECT * FROM staff_users WHERE id = ? AND deleted_at IS NULL');
    $q->execute([$staffId]);
    $target = $q->fetch();
    if (!$target) jsonResponse(['ok' => false, 'error' => 'Staff member not found.'], 404);

    if ($target['role'] === 'Super Admin'
        && (($method === 'DELETE') || ($action === 'block' && $method === 'POST'))) {
        if ($actor['id'] === $staffId && $method === 'DELETE') {
            jsonResponse(['ok' => false, 'error' => 'You cannot delete your own Super Admin account.'], 409);
        }
        if ($action === 'block' && $actor['id'] === $staffId) {
            jsonResponse(['ok' => false, 'error' => 'You cannot suspend your own Super Admin account.'], 409);
        }
        $activeSuperAdmins = (int)$pdo->query("SELECT COUNT(*) FROM staff_users WHERE role = 'Super Admin' AND status = 'Active' AND deleted_at IS NULL")->fetchColumn();
        if ($target['status'] === 'Active' && $activeSuperAdmins <= 1) {
            jsonResponse(['ok' => false, 'error' => 'At least one active Super Admin account must remain.'], 409);
        }
    }

    if (($action === 'block' || $action === 'unblock') && $method === 'POST') {
        if (!canManageStaffStatus($actor, $target)) jsonResponse(['ok' => false, 'error' => 'You cannot change this staff member’s access.'], 403);
        $status = $action === 'block' ? 'Suspended' : 'Active';
        $pdo->prepare('UPDATE staff_users SET status = ? WHERE id = ?')->execute([$status, $staffId]);
        if ($action === 'block') $pdo->prepare('DELETE FROM admin_sessions WHERE user_id = ?')->execute([$staffId]);
        jsonResponse(['ok' => true, 'staff' => publicStaffRecord($pdo, $staffId)]);
    }
    if ($method === 'PATCH') {
        if (!canManageStaffRecord($actor, $target)) jsonResponse(['ok' => false, 'error' => 'You cannot edit this staff member.'], 403);
        $isSelf = $actor['id'] === $staffId;
        if (!$isSelf && $actor['role'] !== 'Super Admin' && (array_key_exists('office_id', $input) || array_key_exists('team_id', $input))) {
            jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can move staff between offices or teams.'], 403);
        }
        $name = array_key_exists('name', $input) ? trim((string)$input['name']) : $target['name'];
        if ($name === '') jsonResponse(['ok' => false, 'error' => 'Staff name is required.'], 422);
        $email = array_key_exists('email', $input) ? strtolower(trim((string)$input['email'])) : $target['email'];
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) jsonResponse(['ok' => false, 'error' => 'Enter a valid email address.'], 422);
        $q = $pdo->prepare('SELECT id FROM staff_users WHERE LOWER(email) = ? AND id <> ?');
        $q->execute([$email, $staffId]);
        if ($q->fetchColumn()) jsonResponse(['ok' => false, 'error' => 'That email address is already in use.'], 409);
        $passwordHash = null;
        if (isset($input['password']) && (string)$input['password'] !== '') {
            if (strlen((string)$input['password']) < 8) jsonResponse(['ok' => false, 'error' => 'Staff passwords must be at least 8 characters.'], 422);
            $passwordHash = password_hash((string)$input['password'], PASSWORD_DEFAULT);
        }
        $officeId = optionalId($input['office_id'] ?? $target['office_id']);
        $teamId = optionalId($input['team_id'] ?? $target['team_id']);
        if ($actor['role'] !== 'Super Admin' || $isSelf) {
            $officeId = optionalId($target['office_id']);
            $teamId = optionalId($target['team_id']);
        }
        $team = $teamId ? activeTeam($pdo, $teamId) : null;
        if ($teamId && !$team) jsonResponse(['ok' => false, 'error' => 'The selected team is unavailable.'], 422);
        if ($team && !empty($team['office_id'])) {
            if ($officeId !== null && $officeId !== $team['office_id']) jsonResponse(['ok' => false, 'error' => 'The selected team belongs to a different office.'], 422);
            $officeId = (string)$team['office_id'];
        }
        if ($officeId !== null && !activeOffice($pdo, $officeId)) jsonResponse(['ok' => false, 'error' => 'The selected office is unavailable.'], 422);
        if ($target['role'] === 'Office Manager' && $teamId !== null) jsonResponse(['ok' => false, 'error' => 'An Office Manager cannot be assigned to a team.'], 422);
        if ($target['role'] === 'Agent' && $team && $team['max_size'] !== null && $teamId !== $target['team_id']) {
            $q = $pdo->prepare("SELECT COUNT(*) FROM staff_users WHERE team_id = ? AND role = 'Agent' AND deleted_at IS NULL AND id <> ?");
            $q->execute([$teamId, $staffId]);
            if ((int)$q->fetchColumn() >= (int)$team['max_size']) jsonResponse(['ok' => false, 'error' => 'This team is at capacity.'], 409);
        }
        if ($target['role'] === 'Team Leader' && $teamId !== null) {
            $q = $pdo->prepare("SELECT id FROM staff_users WHERE team_id = ? AND role = 'Team Leader' AND deleted_at IS NULL AND id <> ?");
            $q->execute([$teamId, $staffId]);
            if ($q->fetchColumn()) jsonResponse(['ok' => false, 'error' => 'This team already has a Team Leader.'], 409);
        }
        $now = date('c');
        $pdo->beginTransaction();
        try {
            $sql = 'UPDATE staff_users SET name = ?, email = ?, office_id = ?, team_id = ?';
            $params = [$name, $email, $officeId, $teamId];
            if ($passwordHash !== null) {
                $sql .= ', password = ?';
                $params[] = $passwordHash;
            }
            $sql .= ' WHERE id = ?';
            $params[] = $staffId;
            $pdo->prepare($sql)->execute($params);
            if ($target['role'] === 'Team Leader') {
                $pdo->prepare('UPDATE teams SET leader_id = NULL, leader_name = NULL WHERE leader_id = ?')->execute([$staffId]);
                if ($teamId !== null) $pdo->prepare('UPDATE teams SET leader_id = ?, leader_name = ? WHERE id = ?')->execute([$staffId, $name, $teamId]);
                $pdo->prepare('UPDATE clients SET assigned_office_id = ?, assigned_team_id = ?, updated_at = ? WHERE assigned_team_leader_id = ? AND assigned_agent_id IS NULL AND deleted_at IS NULL')
                    ->execute([$officeId, $teamId, $now, $staffId]);
            } elseif ($target['role'] === 'Agent') {
                $pdo->prepare('UPDATE clients SET assigned_office_id = ?, assigned_team_id = ?, updated_at = ? WHERE assigned_agent_id = ? AND deleted_at IS NULL')
                    ->execute([$officeId, $teamId, $now, $staffId]);
            } elseif ($target['role'] === 'Office Manager') {
                $pdo->prepare('UPDATE offices SET manager_id = NULL WHERE manager_id = ?')->execute([$staffId]);
                if ($officeId !== null) $pdo->prepare('UPDATE offices SET manager_id = ?, manager_name = ?, manager_email = ? WHERE id = ?')->execute([$staffId, $name, $email, $officeId]);
            }
            if ($target['role'] === 'Team Leader') $pdo->prepare('UPDATE teams SET leader_name = ? WHERE leader_id = ?')->execute([$name, $staffId]);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
        jsonResponse(['ok' => true, 'staff' => publicStaffRecord($pdo, $staffId)]);
    }
    if ($method === 'DELETE') {
        requireSuperAdmin($pdo, $adminSession);
        if ($permanent) {
            $pdo->beginTransaction();
            try {
                $pdo->prepare('UPDATE clients SET assigned_office_id = NULL, assigned_team_id = NULL, assigned_team_leader_id = NULL, assigned_agent_id = NULL, assigned_by = NULL WHERE assigned_agent_id = ? OR assigned_team_leader_id = ?')->execute([$staffId, $staffId]);
                $pdo->prepare('UPDATE teams SET leader_id = NULL, leader_name = NULL WHERE leader_id = ?')->execute([$staffId]);
                $pdo->prepare('UPDATE offices SET manager_id = NULL, manager_name = ?, manager_email = ? WHERE manager_id = ?')->execute(['Unassigned', '', $staffId]);
                $pdo->prepare('DELETE FROM admin_sessions WHERE user_id = ?')->execute([$staffId]);
                $pdo->prepare("DELETE FROM crm_assignment_restore WHERE entity_type = 'staff' AND entity_id = ?")->execute([$staffId]);
                $pdo->prepare('DELETE FROM staff_users WHERE id = ?')->execute([$staffId]);
                $pdo->commit();
            } catch (Throwable $error) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $error;
            }
            jsonResponse(['ok' => true]);
        }
        $now = date('c');
        $pdo->beginTransaction();
        try {
            $clientIds = snapshotAndClearClientAssignments($pdo, 'staff', $staffId, '(assigned_agent_id = ? OR assigned_team_leader_id = ?)', [$staffId, $staffId], $actor['id']);
            $pdo->prepare("UPDATE staff_users SET deleted_at = ?, deleted_scope_type = 'staff', deleted_scope_id = ? WHERE id = ?")->execute([$now, $staffId, $staffId]);
            $pdo->prepare('DELETE FROM admin_sessions WHERE user_id = ?')->execute([$staffId]);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
        jsonResponse(['ok' => true, 'deleted_at' => $now, 'client_ids' => $clientIds]);
    }
    jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
}
