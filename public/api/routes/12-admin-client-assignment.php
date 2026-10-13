<?php
/** Route group: ADMIN: CLIENT ASSIGNMENT (included by index.php in order; uses its request globals). */

declare(strict_types=1);

function adminAssignmentMongoCleanClient(array $client): array
{
    return normalizeClientRow(mongoRouteCleanRow($client));
}

function adminAssignmentMongoHistory(mixed $raw): array
{
    if (is_array($raw)) return array_values($raw);
    if (!is_string($raw) || $raw === '') return [];
    $history = json_decode($raw, true);
    return is_array($history) ? array_values($history) : [];
}

function adminAssignmentMongoHistoryJson(array $history): string
{
    return json_encode(array_values($history), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?: '[]';
}

function adminAssignmentMongoVersionFilter(array $client, array $fields): array
{
    $filter = ['id' => $client['id'], 'deleted_at' => null];
    foreach (array_unique(array_merge($fields, [
        'assigned_office_id',
        'assigned_team_id',
        'assigned_team_leader_id',
        'assigned_agent_id',
    ])) as $field) {
        $filter[$field] = $client[$field] ?? null;
    }
    return $filter;
}

function adminAssignmentMongoSignupItems(array $rows): array
{
    $items = [];
    foreach ($rows as $row) {
        $details = json_decode((string)($row['request_data'] ?? ''), true);
        if (!is_array($details)) $details = [];
        $items[] = array_merge($details, [
            'id' => $row['id'] ?? null,
            'name' => $row['name'] ?? null,
            'email' => $row['email'] ?? null,
            'status' => $row['status'] ?? null,
            'createdAt' => $row['created_at'] ?? null,
        ]);
    }
    return $items;
}

function adminAssignmentMongoResetQueueItem(array $client, array $request): array
{
    return [
        'id' => $client['id'] ?? null,
        'user_name' => $client['name'] ?? null,
        'user_email' => $client['email'] ?? null,
        'requested_at' => $request['requested_at'] ?? null,
    ];
}

function adminAssignmentMongoTransaction(callable $operation): mixed
{
    $session = getMongoDatabase()->getManager()->startSession();
    try {
        $session->startTransaction();
        $result = $operation($session);
        $session->commitTransaction();
        return $result;
    } catch (Throwable $error) {
        try {
            $session->abortTransaction();
        } catch (Throwable) {
        }
        throw $error;
    } finally {
        $session->endSession();
    }
}

function adminAssignmentMongoResolve(array $input): array
{
    $officeId = optionalId($input['office_id'] ?? null);
    $teamId = optionalId($input['team_id'] ?? null);
    $leaderId = optionalId($input['team_leader_id'] ?? null);
    $agentId = optionalId($input['agent_id'] ?? null);

    if ($officeId !== null && !mongoFindOne('offices', ['id' => $officeId, 'deleted_at' => null])) {
        jsonResponse(['ok' => false, 'error' => 'The selected office is unavailable.'], 422);
    }
    if ($teamId !== null) {
        $team = mongoFindOne('teams', ['id' => $teamId, 'deleted_at' => null]);
        if (!$team) jsonResponse(['ok' => false, 'error' => 'The selected team is unavailable.'], 422);
        if ($officeId !== null && !empty($team['office_id']) && $officeId !== $team['office_id']) {
            jsonResponse(['ok' => false, 'error' => 'The selected team does not belong to that office.'], 422);
        }
        if ($officeId === null && !empty($team['office_id'])) $officeId = (string)$team['office_id'];
    }
    if ($leaderId !== null) {
        $leader = mongoFindOne('staff_users', ['id' => $leaderId, 'deleted_at' => null]);
        if (!$leader || ($leader['role'] ?? null) !== 'Team Leader') {
            jsonResponse(['ok' => false, 'error' => 'The selected team leader is unavailable.'], 422);
        }
        if ($teamId !== null && ($leader['team_id'] ?? null) !== $teamId) {
            jsonResponse(['ok' => false, 'error' => 'The selected team leader does not belong to that team.'], 422);
        }
        if ($officeId !== null && !empty($leader['office_id']) && $leader['office_id'] !== $officeId) {
            jsonResponse(['ok' => false, 'error' => 'The selected team leader does not belong to that office.'], 422);
        }
    }
    if ($agentId !== null) {
        $agent = mongoFindOne('staff_users', ['id' => $agentId, 'deleted_at' => null]);
        if (!$agent || ($agent['role'] ?? null) !== 'Agent') {
            jsonResponse(['ok' => false, 'error' => 'The selected agent is unavailable.'], 422);
        }
        if ($teamId !== null && ($agent['team_id'] ?? null) !== $teamId) {
            jsonResponse(['ok' => false, 'error' => 'The selected agent does not belong to that team.'], 422);
        }
        if ($officeId !== null && !empty($agent['office_id']) && $agent['office_id'] !== $officeId) {
            jsonResponse(['ok' => false, 'error' => 'The selected agent does not belong to that office.'], 422);
        }
        $teamId = optionalId($agent['team_id'] ?? null);
        $officeId = optionalId($agent['office_id'] ?? null);
        $leaderId = null;
    }
    return [
        'office_id' => $officeId,
        'team_id' => $teamId,
        'team_leader_id' => $leaderId,
        'agent_id' => $agentId,
    ];
}

function adminAssignmentMongoAssertCanAssign(array $actor, array $assignment): void
{
    if (($actor['role'] ?? null) === 'Super Admin') return;
    if (($actor['role'] ?? null) === 'Office Manager') {
        $officeId = optionalId($actor['office_id'] ?? null);
        if ($officeId === null) jsonResponse(['ok' => false, 'error' => 'Your account is not assigned to an office.'], 403);
        if ($assignment['office_id'] !== null && $assignment['office_id'] !== $officeId) {
            jsonResponse(['ok' => false, 'error' => 'You can only assign clients within your office.'], 403);
        }
        foreach ([['teams', 'team_id'], ['staff_users', 'agent_id'], ['staff_users', 'team_leader_id']] as [$table, $key]) {
            if ($assignment[$key] === null) continue;
            $record = mongoFindOne($table, ['id' => $assignment[$key], 'deleted_at' => null]);
            if (!$record || ($record['office_id'] ?? null) !== $officeId) {
                jsonResponse(['ok' => false, 'error' => 'You can only assign clients to staff and teams in your office.'], 403);
            }
        }
        return;
    }
    if (($actor['role'] ?? null) === 'Team Leader') {
        $teamId = optionalId($actor['team_id'] ?? null);
        if ($assignment['team_id'] !== null && $assignment['team_id'] !== $teamId) {
            jsonResponse(['ok' => false, 'error' => 'You can only assign clients within your team.'], 403);
        }
        if ($assignment['agent_id'] !== null) {
            $agent = mongoFindOne('staff_users', ['id' => $assignment['agent_id'], 'deleted_at' => null]);
            if (!$teamId || !$agent || ($agent['team_id'] ?? null) !== $teamId) {
                jsonResponse(['ok' => false, 'error' => 'You can only assign clients to agents in your team.'], 403);
            }
        }
        if ($assignment['team_leader_id'] !== null && $assignment['team_leader_id'] !== $actor['id']) {
            jsonResponse(['ok' => false, 'error' => 'You can only assign clients directly to yourself.'], 403);
        }
        $officeId = optionalId($actor['office_id'] ?? null);
        if ($assignment['office_id'] !== null && $assignment['office_id'] !== $officeId) {
            jsonResponse(['ok' => false, 'error' => 'You can only assign clients within your office.'], 403);
        }
        return;
    }
    if (($actor['role'] ?? null) === 'Agent') {
        if ($assignment['agent_id'] === $actor['id']
            && $assignment['team_id'] === optionalId($actor['team_id'] ?? null)
            && $assignment['office_id'] === optionalId($actor['office_id'] ?? null)) return;
        jsonResponse(['ok' => false, 'error' => 'You can only assign a new client to yourself.'], 403);
    }
    jsonResponse(['ok' => false, 'error' => 'Your role cannot reassign clients.'], 403);
}

function adminAssignmentMongoSave(array $client, array $assignment, array $actor, mixed $session): array
{
    $now = date('c');
    $previous = [
        'office_id' => $client['assigned_office_id'] ?? null,
        'team_id' => $client['assigned_team_id'] ?? null,
        'team_leader_id' => $client['assigned_team_leader_id'] ?? null,
        'agent_id' => $client['assigned_agent_id'] ?? null,
    ];
    $set = [
        'assigned_office_id' => $assignment['office_id'],
        'assigned_team_id' => $assignment['team_id'],
        'assigned_team_leader_id' => $assignment['team_leader_id'],
        'assigned_agent_id' => $assignment['agent_id'],
        'assigned_by' => $actor['id'],
        'updated_at' => $now,
    ];
    $result = getMongoCollection(mongoCollectionName('clients'))->updateOne(
        adminAssignmentMongoVersionFilter($client, []),
        ['$set' => $set],
        ['session' => $session],
    );
    if ($result->getMatchedCount() === 0) {
        jsonResponse(['ok' => false, 'error' => 'The client changed during this operation. Refresh and try again.'], 409);
    }
    $historyId = 'lah_' . bin2hex(random_bytes(10));
    adminAssignmentMongoSessionInsert('client_assignment_history', [
        '_id' => $historyId,
        'id' => $historyId,
        'client_id' => (string)$client['id'],
        'actor_id' => (string)$actor['id'],
        'previous_assignment' => json_encode($previous),
        'new_assignment' => json_encode($assignment),
        'created_at' => $now,
    ], $session);
    $updated = array_merge($client, $set);
    $agent = $assignment['agent_id'] === null ? null : mongoDocumentToArray(
        getMongoCollection(mongoCollectionName('staff_users'))->findOne(
            ['id' => $assignment['agent_id']],
            ['session' => $session],
        ),
    );
    $updated['assigned_agent_name'] = $agent['name'] ?? null;
    return $updated;
}

function adminAssignmentMongoSessionInsert(string $table, array $document, mixed $session): void
{
    getMongoCollection(mongoCollectionName($table))->insertOne($document, ['session' => $session]);
}

if (isMongoStorageEnabled()) {
    if (preg_match('#^/admin/clients/(?:assign-bulk|bulk-assign)$#', $apiPath) && $method === 'POST') {
        $actor = mongoRouteAdminActor($adminSession);
        if (isset($input['assignments'])) {
            $entries = $input['assignments'];
            if (!is_array($entries) || count($entries) === 0 || count($entries) > 5000) {
                jsonResponse(['ok' => false, 'error' => 'Provide between 1 and 5,000 client assignments.'], 400);
            }
            $prepared = [];
            $seen = [];
            foreach ($entries as $entry) {
                if (!is_array($entry)) jsonResponse(['ok' => false, 'error' => 'An assignment entry is invalid.'], 400);
                $clientId = trim((string)($entry['client_id'] ?? $entry['clientId'] ?? ''));
                if ($clientId === '' || isset($seen[$clientId])) {
                    jsonResponse(['ok' => false, 'error' => 'Each client must appear exactly once in the assignment list.'], 422);
                }
                $seen[$clientId] = true;
                $client = mongoFindOne('clients', ['id' => $clientId, 'deleted_at' => null]);
                if (!$client) jsonResponse(['ok' => false, 'error' => "Client {$clientId} is unavailable."], 404);
                if (!mongoRouteActorCanViewClient($actor, $client)) {
                    jsonResponse(['ok' => false, 'error' => 'You cannot access this client.'], 403);
                }
                $assignment = adminAssignmentMongoResolve([
                    'office_id' => $entry['assigned_office_id'] ?? $entry['officeId'] ?? $entry['office_id'] ?? null,
                    'team_id' => $entry['assigned_team_id'] ?? $entry['teamId'] ?? $entry['team_id'] ?? null,
                    'team_leader_id' => $entry['assigned_team_leader_id'] ?? $entry['teamLeaderId'] ?? $entry['team_leader_id'] ?? null,
                    'agent_id' => $entry['assigned_agent_id'] ?? $entry['agentId'] ?? $entry['agent_id'] ?? null,
                ]);
                adminAssignmentMongoAssertCanAssign($actor, $assignment);
                $prepared[] = [$client, $assignment];
            }
        } else {
            $ids = $input['client_ids'] ?? $input['ids'] ?? [];
            if (!is_array($ids) || count($ids) === 0) jsonResponse(['ok' => false, 'error' => 'Select at least one client.'], 400);
            $clientIds = array_values(array_unique(array_filter(array_map(static fn($id) => trim((string)$id), $ids))));
            $assignment = adminAssignmentMongoResolve([
                'office_id' => $input['assigned_office_id'] ?? $input['officeId'] ?? $input['office_id'] ?? null,
                'team_id' => $input['assigned_team_id'] ?? $input['teamId'] ?? $input['team_id'] ?? null,
                'team_leader_id' => $input['assigned_team_leader_id'] ?? $input['teamLeaderId'] ?? $input['team_leader_id'] ?? null,
                'agent_id' => $input['assigned_agent_id'] ?? $input['agentId'] ?? $input['agent_id'] ?? null,
            ]);
            adminAssignmentMongoAssertCanAssign($actor, $assignment);
            $prepared = [];
            foreach ($clientIds as $clientId) {
                $client = mongoFindOne('clients', ['id' => $clientId, 'deleted_at' => null]);
                if (!$client) jsonResponse(['ok' => false, 'error' => "Client {$clientId} is unavailable."], 404);
                if (!mongoRouteActorCanViewClient($actor, $client)) {
                    jsonResponse(['ok' => false, 'error' => 'You cannot access this client.'], 403);
                }
                $prepared[] = [$client, $assignment];
            }
        }
        $updated = adminAssignmentMongoTransaction(static function ($session) use ($prepared, $actor): array {
            $rows = [];
            foreach ($prepared as [$client, $assignment]) {
                $rows[] = adminAssignmentMongoCleanClient(adminAssignmentMongoSave($client, $assignment, $actor, $session));
            }
            return $rows;
        });
        jsonResponse(['ok' => true, 'updated' => count($updated), 'clients' => $updated]);
    }

    if (preg_match('#^/admin/clients/([^/]+)/assign$#', $apiPath, $m) && $method === 'POST') {
        $actor = mongoRouteAdminActor($adminSession);
        $clientId = rawurldecode($m[1]);
        $client = mongoFindOne('clients', ['id' => $clientId, 'deleted_at' => null]);
        if (!$client) jsonResponse(['ok' => false, 'error' => 'Client not found.'], 404);
        if (!mongoRouteActorCanViewClient($actor, $client)) {
            jsonResponse(['ok' => false, 'error' => 'You cannot access this client.'], 403);
        }
        $assignment = adminAssignmentMongoResolve([
            'office_id' => $input['assigned_office_id'] ?? $input['officeId'] ?? $input['office_id'] ?? null,
            'team_id' => $input['assigned_team_id'] ?? $input['teamId'] ?? $input['team_id'] ?? null,
            'team_leader_id' => $input['assigned_team_leader_id'] ?? $input['teamLeaderId'] ?? $input['team_leader_id'] ?? null,
            'agent_id' => $input['assigned_agent_id'] ?? $input['agentId'] ?? $input['agent_id'] ?? null,
        ]);
        adminAssignmentMongoAssertCanAssign($actor, $assignment);
        $updated = adminAssignmentMongoTransaction(
            static fn($session) => adminAssignmentMongoCleanClient(adminAssignmentMongoSave($client, $assignment, $actor, $session)),
        );
        jsonResponse(['ok' => true, 'client' => $updated]);
    }

    if ($apiPath === '/admin/clients/bulk-status' && $method === 'POST') {
        $actor = mongoRouteAdminActor($adminSession);
        if ($actor['role'] !== 'Super Admin') {
            jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can bulk-update client status.'], 403);
        }
        $ids = $input['ids'] ?? [];
        $status = trim((string)($input['status'] ?? ''));
        $allowedStatuses = ['Active', 'Suspended', 'Disabled', 'New', 'In Line', 'No Answer', 'Deposit', 'Failed Deposit', 'Didn\'t Register', 'Not Interested', 'Low Potential', 'NA1', 'NA2', 'NA3', 'Never Answer', 'No Potential', 'Wrong Person', 'Wrong Number', 'Call Back'];
        if (!is_array($ids) || count($ids) === 0 || count($ids) > 5000 || !in_array($status, $allowedStatuses, true)) {
            jsonResponse(['ok' => false, 'error' => 'Provide selected client IDs and a valid status.'], 422);
        }
        $ids = array_values(array_unique(array_filter(array_map(static fn($id) => trim((string)$id), $ids))));
        $updated = adminAssignmentMongoTransaction(static function ($session) use ($ids, $status): array {
            $changed = [];
            $collection = getMongoCollection(mongoCollectionName('clients'));
            foreach ($ids as $id) {
                $result = $collection->updateOne(
                    ['id' => $id, 'deleted_at' => null],
                    ['$set' => ['status' => $status, 'updated_at' => date('c')]],
                    ['session' => $session],
                );
                if ($result->getMatchedCount() > 0) $changed[] = $id;
            }
            return $changed;
        });
        jsonResponse(['ok' => true, 'updated' => count($updated), 'ids' => $updated]);
    }

    if (preg_match('#^/admin/clients/([^/]+)/(reset-status|comments|status-history)(?:/([^/]+))?$#', $apiPath, $mongoMatch)) {
        $actor = mongoRouteAdminActor($adminSession);
        $clientId = rawurldecode($mongoMatch[1]);
        $action = $mongoMatch[2];
        $entryId = isset($mongoMatch[3]) ? rawurldecode($mongoMatch[3]) : null;
        $supported = ($method === 'POST' && $action === 'reset-status')
            || ($method === 'DELETE' && $action === 'comments')
            || ($method === 'DELETE' && $action === 'status-history' && $entryId !== null);
        if (!$supported) jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);

        $client = mongoFindOne('clients', ['id' => $clientId, 'deleted_at' => null]);
        if (!$client) jsonResponse(['ok' => false, 'error' => 'Client record not found.'], 404);
        if (!mongoRouteActorCanViewClient($actor, $client)) {
            jsonResponse(['ok' => false, 'error' => 'You cannot access this client record.'], 403);
        }

        $now = date('c');
        $set = ['updated_at' => $now];
        $versionFields = [];
        if ($method === 'POST' && $action === 'reset-status') {
            $history = adminAssignmentMongoHistory($client['status_history'] ?? null);
            $history[] = [
                'id' => 'st_' . bin2hex(random_bytes(5)),
                'from_stage' => (string)($client['stage'] ?? ''),
                'to_stage' => 'New',
                'by_admin_id' => $actor['id'],
                'by_name' => $actor['name'] ?? '',
                'created_at' => $now,
            ];
            $set['stage'] = 'New';
            $set['status'] = 'New';
            $set['status_history'] = adminAssignmentMongoHistoryJson($history);
            $versionFields = ['stage', 'status', 'status_history'];
        } elseif ($action === 'comments') {
            $comments = adminAssignmentMongoHistory($client['comment_history'] ?? null);
            if ($entryId === null) {
                $comments = [];
            } else {
                $comments = array_values(array_filter($comments, static fn($comment) =>
                    !is_array($comment) || (string)($comment['id'] ?? $comment['comment_id'] ?? '') !== $entryId
                ));
            }
            $set['comment_history'] = adminAssignmentMongoHistoryJson($comments);
            $versionFields = ['comment_history'];
        } else {
            $history = adminAssignmentMongoHistory($client['status_history'] ?? null);
            $history = array_values(array_filter($history, static fn($entry) =>
                !is_array($entry) || (string)($entry['id'] ?? '') !== $entryId
            ));
            $set['status_history'] = adminAssignmentMongoHistoryJson($history);
            $versionFields = ['status_history'];
        }

        $result = getMongoCollection(mongoCollectionName('clients'))->updateOne(
            adminAssignmentMongoVersionFilter($client, $versionFields),
            ['$set' => $set],
        );
        if ($result->getMatchedCount() === 0) {
            jsonResponse(['ok' => false, 'error' => 'The client changed during this operation. Refresh and try again.'], 409);
        }
        $updated = mongoFindOne('clients', ['id' => $clientId]);
        jsonResponse(['ok' => true, 'client' => adminAssignmentMongoCleanClient($updated ?? $client)]);
    }

    if ($apiPath === '/admin/clients/bin/cleanup' && $method === 'POST') {
        $actor = mongoRouteAdminActor($adminSession);
        if ($actor['role'] !== 'Super Admin') {
            jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can clean up the recycle bin.'], 403);
        }
        $days = filter_var($input['older_than_days'] ?? 30, FILTER_VALIDATE_INT);
        if ($days === false || $days < 1 || $days > 3650) {
            jsonResponse(['ok' => false, 'error' => 'The cleanup age must be between 1 and 3,650 days.'], 422);
        }
        $cutoff = date('c', time() - ($days * 86400));
        $clients = mongoFindMany('clients', ['deleted_at' => ['$ne' => null]]);
        $ids = [];
        foreach ($clients as $client) {
            if ((string)($client['deleted_at'] ?? '') !== '' && (string)$client['deleted_at'] < $cutoff) {
                $ids[] = (string)$client['id'];
            }
        }
        $deletedIds = adminAssignmentMongoTransaction(static function ($session) use ($ids): array {
            $deleted = [];
            $clients = getMongoCollection(mongoCollectionName('clients'));
            $history = getMongoCollection(mongoCollectionName('client_assignment_history'));
            foreach ($ids as $id) {
                $result = $clients->deleteOne(['id' => $id, 'deleted_at' => ['$ne' => null]], ['session' => $session]);
                if ($result->getDeletedCount() > 0) {
                    $history->deleteMany(['client_id' => $id], ['session' => $session]);
                    $deleted[] = $id;
                }
            }
            return $deleted;
        });
        jsonResponse(['ok' => true, 'deleted' => count($deletedIds), 'ids' => $deletedIds]);
    }

    if ($apiPath === '/admin/clients/bin/purge-all' && $method === 'POST') {
        $actor = mongoRouteAdminActor($adminSession);
        if ($actor['role'] !== 'Super Admin') {
            jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can permanently purge the recycle bin.'], 403);
        }
        if (!is_array($input['ids'] ?? []) || count($input['ids'] ?? []) > 5000) {
            jsonResponse(['ok' => false, 'error' => 'Provide a valid list of client IDs.'], 422);
        }
        $requested = $input['ids'] ?? [];
        $filter = ['deleted_at' => ['$ne' => null]];
        if ($requested) {
            $requested = array_values(array_unique(array_filter(array_map(static fn($id) => trim((string)$id), $requested))));
            if (!$requested) jsonResponse(['ok' => true, 'deleted' => 0, 'ids' => []]);
            $filter['id'] = ['$in' => $requested];
        }
        $clients = mongoFindMany('clients', $filter);
        $ids = array_values(array_map(static fn($client) => (string)$client['id'], $clients));
        $deletedIds = adminAssignmentMongoTransaction(static function ($session) use ($ids): array {
            if (!$ids) return [];
            $result = getMongoCollection(mongoCollectionName('clients'))->deleteMany(
                ['id' => ['$in' => $ids], 'deleted_at' => ['$ne' => null]],
                ['session' => $session],
            );
            getMongoCollection(mongoCollectionName('client_assignment_history'))->deleteMany(
                ['client_id' => ['$in' => $ids]],
                ['session' => $session],
            );
            return $result->getDeletedCount() === count($ids) ? $ids : throw new RuntimeException('Recycle-bin purge changed concurrently.');
        });
        jsonResponse(['ok' => true, 'deleted' => count($deletedIds), 'ids' => $deletedIds]);
    }

    if ($apiPath === '/admin/signup-requests') {
        $actor = mongoRouteAdminActor($adminSession);
        if ($actor['role'] !== 'Super Admin') {
            jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can manage signup requests.'], 403);
        }
        if ($method !== 'GET') jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
        $status = trim((string)($_GET['status'] ?? 'pending'));
        $filter = $status === 'all' ? [] : ['status' => $status];
        $rows = mongoFindMany('signup_requests', $filter, ['sort' => ['created_at' => -1]]);
        $items = adminAssignmentMongoSignupItems($rows);
        jsonResponse(['ok' => true, 'items' => $items, 'total' => count($items)]);
    }

    if (preg_match('#^/admin/signup-requests/([^/]+)(?:/(approve|reject))?$#', $apiPath, $mongoMatch)) {
        $actor = mongoRouteAdminActor($adminSession);
        if ($actor['role'] !== 'Super Admin') {
            jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can manage signup requests.'], 403);
        }
        $requestId = rawurldecode($mongoMatch[1]);
        $action = $mongoMatch[2] ?? '';
        $request = mongoFindOne('signup_requests', ['id' => $requestId]);
        if (!$request) jsonResponse(['ok' => false, 'error' => 'Signup request not found.'], 404);
        if ($method === 'DELETE' && $action === '') {
            mongoDelete('signup_requests', ['id' => $requestId]);
            jsonResponse(['ok' => true, 'id' => $requestId, 'deleted' => true]);
        }
        if ($method === 'POST' && $action === 'reject') {
            $reason = trim((string)($input['reason'] ?? ''));
            $code = trim((string)($input['code'] ?? ''));
            getMongoCollection(mongoCollectionName('signup_requests'))->updateOne(
                ['id' => $requestId, 'status' => 'pending'],
                ['$set' => [
                    'status' => 'rejected',
                    'rejection_reason' => $reason !== '' ? $reason : $code,
                    'reviewed_at' => date('c'),
                ]],
            );
            jsonResponse(['ok' => true, 'id' => $requestId, 'status' => 'rejected']);
        }
        if ($method === 'POST' && $action === 'approve') {
            if (($request['status'] ?? null) !== 'pending') {
                jsonResponse(['ok' => false, 'error' => 'This request has already been reviewed.'], 409);
            }
            $code = trim((string)($input['verification_code'] ?? $input['verificationCode'] ?? ''));
            if (!preg_match('/^\d{6}$/', $code)) {
                jsonResponse(['ok' => false, 'error' => 'Enter a six-digit verification code.'], 422);
            }
            $data = json_decode((string)($request['request_data'] ?? ''), true);
            if (!is_array($data)) jsonResponse(['ok' => false, 'error' => 'Signup request data is invalid.'], 422);
            $email = strtolower(trim((string)($request['email'] ?? '')));
            $emailPattern = '^\s*' . preg_quote($email, '/') . '\s*$';
            $candidates = mongoFindMany('clients', [
                'email' => ['$regex' => $emailPattern, '$options' => 'i'],
                'deleted_at' => null,
            ]);
            usort($candidates, static fn($left, $right) =>
                [(string)($left['created_at'] ?? ''), (string)($left['id'] ?? '')]
                <=> [(string)($right['created_at'] ?? ''), (string)($right['id'] ?? '')]
            );
            $candidates = array_map(static fn($client) => array_intersect_key($client, array_flip(['id', 'name', 'company', 'email'])), $candidates);
            $requestedClientId = trim((string)($input['client_id'] ?? ''));
            if ($candidates && $requestedClientId === '') {
                jsonResponse([
                    'ok' => false,
                    'code' => 'CLIENT_IDENTITY_SELECTION_REQUIRED',
                    'error' => 'Choose the Client record this portal signup belongs to. Email alone is not enough to link identities.',
                    'candidateClients' => $candidates,
                ], 409);
            }
            $matchedClient = null;
            if ($requestedClientId !== '') {
                foreach ($candidates as $candidate) {
                    if ((string)$candidate['id'] === $requestedClientId) {
                        $matchedClient = $candidate;
                        break;
                    }
                }
                if (!$matchedClient) {
                    jsonResponse(['ok' => false, 'error' => 'The selected Client record does not match this signup email.'], 422);
                }
                if (mongoFindOne('client_portal_access', ['client_id' => $requestedClientId])) {
                    jsonResponse(['ok' => false, 'error' => 'This Client already has a portal access record.'], 409);
                }
            }
            $assignment = adminAssignmentMongoResolve([
                'office_id' => $input['assigned_office_id'] ?? $input['office_id'] ?? null,
                'team_id' => $input['assigned_team_id'] ?? $input['team_id'] ?? null,
                'team_leader_id' => $input['assigned_team_leader_id'] ?? null,
                'agent_id' => $input['agent_id'] ?? $input['assigned_agent_id'] ?? null,
            ]);
            adminAssignmentMongoAssertCanAssign($actor, $assignment);
            $now = date('c');
            $name = trim((string)($data['name'] ?? $request['name'] ?? ''));
            $parts = preg_split('/\s+/', $name, 2) ?: [$name, ''];
            $firstName = (string)($parts[0] ?? '');
            $lastName = (string)($parts[1] ?? '');
            $clientId = $matchedClient ? $requestedClientId : 'client_' . bin2hex(random_bytes(10));
            $client = adminAssignmentMongoTransaction(static function ($session) use (
                $requestId, $actor, $assignment, $matchedClient, $clientId, $email, $data,
                $name, $firstName, $lastName, $now, $code
            ): array {
                $requests = getMongoCollection(mongoCollectionName('signup_requests'));
                $requestFresh = mongoDocumentToArray($requests->findOne(['id' => $requestId], ['session' => $session]));
                if (!$requestFresh || ($requestFresh['status'] ?? null) !== 'pending') {
                    jsonResponse(['ok' => false, 'error' => 'This request has already been reviewed.'], 409);
                }
                if ($matchedClient) {
                    $clientFresh = mongoDocumentToArray(getMongoCollection(mongoCollectionName('clients'))->findOne(
                        ['id' => $clientId, 'deleted_at' => null],
                        ['session' => $session],
                    ));
                    if (!$clientFresh) jsonResponse(['ok' => false, 'error' => 'The selected Client record is unavailable.'], 422);
                    $portalAccess = getMongoCollection(mongoCollectionName('client_portal_access'))->findOne(
                        ['client_id' => $clientId],
                        ['session' => $session],
                    );
                    if ($portalAccess !== null) {
                        jsonResponse(['ok' => false, 'error' => 'This Client already has a portal access record.'], 409);
                    }
                    $hasAssignment = (bool)array_filter($assignment, static fn($value) => $value !== null);
                    $clientRow = $hasAssignment
                        ? adminAssignmentMongoSave($clientFresh, $assignment, $actor, $session)
                        : $clientFresh;
                    if (!$hasAssignment && !empty($clientRow['assigned_agent_id'])) {
                        $assignedAgent = mongoDocumentToArray(getMongoCollection(mongoCollectionName('staff_users'))->findOne(
                            ['id' => $clientRow['assigned_agent_id']],
                            ['session' => $session],
                        ));
                        $clientRow['assigned_agent_name'] = $assignedAgent['name'] ?? null;
                    } elseif (!$hasAssignment) {
                        $clientRow['assigned_agent_name'] = null;
                    }
                } else {
                    $clientRow = [
                        '_id' => $clientId,
                        'id' => $clientId,
                        'first_name' => $firstName,
                        'last_name' => $lastName,
                        'name' => $name,
                        'email' => $email,
                        'phone' => trim((string)($data['phone'] ?? '')),
                        'country' => trim((string)($data['country'] ?? '')),
                        'country_code' => trim((string)($data['country_code'] ?? '')),
                        'company' => trim((string)($data['company'] ?? '')),
                        'message' => trim((string)($data['message'] ?? '')),
                        'source' => 'signup_request',
                        'stage' => 'New',
                        'status' => 'New',
                        'assigned_office_id' => $assignment['office_id'],
                        'assigned_team_id' => $assignment['team_id'],
                        'assigned_team_leader_id' => $assignment['team_leader_id'],
                        'assigned_agent_id' => $assignment['agent_id'],
                        'assigned_by' => $actor['id'],
                        'created_at' => $now,
                        'updated_at' => $now,
                        'deleted_at' => null,
                    ];
                    adminAssignmentMongoSessionInsert('clients', $clientRow, $session);
                }
                adminAssignmentMongoSessionInsert('client_portal_access', [
                    '_id' => $clientId,
                    'client_id' => $clientId,
                    'password_hash' => '',
                    'status' => 'Active',
                    'portal_enabled' => 0,
                    'created_at' => $now,
                ], $session);
                $result = $requests->updateOne(
                    ['id' => $requestId, 'status' => 'pending'],
                    ['$set' => [
                        'status' => 'approved',
                        'verification_code_hash' => password_hash($code, PASSWORD_DEFAULT),
                        'verification_expires_at' => date('c', time() + 3600),
                        'verification_attempts' => 0,
                        'client_id' => $clientId,
                        'reviewed_at' => $now,
                    ]],
                    ['session' => $session],
                );
                if ($result->getMatchedCount() !== 1) {
                    jsonResponse(['ok' => false, 'error' => 'This request has already been reviewed.'], 409);
                }
                return $clientRow;
            });
            jsonResponse([
                'ok' => true,
                'client' => adminAssignmentMongoCleanClient($client),
                'client_id' => $clientId,
            ]);
        }
        jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }

    if ($apiPath === '/admin/password-reset-requests') {
        $actor = mongoRouteAdminActor($adminSession);
        if ($actor['role'] !== 'Super Admin') {
            jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can manage password-reset requests.'], 403);
        }
        if ($method !== 'GET') jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
        $requests = mongoFindMany('password_reset_requests', ['status' => 'pending']);
        $items = [];
        foreach ($requests as $request) {
            $client = mongoFindOne('clients', ['id' => $request['user_id'] ?? null]);
            if (!$client) continue;
            $access = mongoFindOne('client_portal_access', ['client_id' => $client['id']]);
            if (!$access || ($access['status'] ?? null) !== 'Active' || (int)($access['portal_enabled'] ?? 0) !== 1) continue;
            $items[] = adminAssignmentMongoResetQueueItem($client, $request);
        }
        usort($items, static fn($left, $right) =>
            (strtotime((string)($left['requested_at'] ?? '')) ?: 0) <=> (strtotime((string)($right['requested_at'] ?? '')) ?: 0)
        );
        jsonResponse(['ok' => true, 'items' => $items]);
    }

    if (preg_match('#^/admin/password-reset-requests/([^/]+)/send-code$#', $apiPath, $mongoMatch)
        && $method === 'POST') {
        $actor = mongoRouteAdminActor($adminSession);
        if ($actor['role'] !== 'Super Admin') {
            jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can send password-reset codes.'], 403);
        }
        $userId = rawurldecode($mongoMatch[1]);
        $code = trim((string)($input['code'] ?? ''));
        if (!preg_match('/^\d{6}$/', $code)) {
            jsonResponse(['ok' => false, 'error' => 'Enter a six-digit reset code.'], 422);
        }
        $now = date('c');
        $expiresAt = date('c', time() + 3600);
        if (!mongoFindOne('password_reset_requests', ['user_id' => $userId, 'status' => 'pending'])) {
            jsonResponse(['ok' => false, 'error' => 'Pending password-reset request not found.'], 404);
        }
        adminAssignmentMongoTransaction(static function ($session) use ($userId, $now, $expiresAt, $code): void {
            getMongoCollection(mongoCollectionName('password_reset_requests'))->updateMany(
                ['user_id' => $userId],
                ['$set' => [
                    'status' => 'sent',
                    'code_hash' => password_hash($code, PASSWORD_DEFAULT),
                    'expires_at' => $expiresAt,
                    'sent_at' => $now,
                    'attempt_count' => 0,
                ]],
                ['session' => $session],
            );
        });
        jsonResponse(['ok' => true, 'user_id' => $userId, 'expires_at' => $expiresAt]);
    }

    if ($apiPath === '/admin/pending-counts' && $method === 'GET') {
        mongoRouteAdminActor($adminSession);
        jsonResponse([
            'ok' => true,
            'signups' => mongoRouteCount('signup_requests', ['status' => 'pending']),
            'password_resets' => mongoRouteCount('password_reset_requests', ['status' => 'pending']),
        ]);
    }

    if (preg_match('#^/admin/client-workspaces/([^/]+)$#', $apiPath, $mongoMatch)) {
        $actor = mongoRouteAdminActor($adminSession);
        if ($actor['role'] !== 'Super Admin') {
            jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can manage client workspaces.'], 403);
        }
        $userId = rawurldecode($mongoMatch[1]);
        if (!mongoFindOne('clients', ['id' => $userId])) {
            jsonResponse(['ok' => false, 'error' => 'Client account not found.'], 404);
        }
        if ($method === 'GET') {
            $row = mongoFindOne('client_workspaces', ['user_id' => $userId]);
            $workspace = $row === null ? null : json_decode((string)($row['workspace_json'] ?? ''), true);
            if ($row !== null && !is_array($workspace)) {
                jsonResponse(['ok' => false, 'error' => 'Stored client workspace data is invalid.'], 500);
            }
            jsonResponse(['ok' => true, 'workspace' => $workspace]);
        }
        if ($method === 'PUT') {
            if (!is_array($input) || strlen(json_encode($input) ?: '') > 1048576) {
                jsonResponse(['ok' => false, 'error' => 'Workspace data must be a JSON object under 1 MB.'], 422);
            }
            if (json_encode($input, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) === false) {
                jsonResponse(['ok' => false, 'error' => 'Workspace data could not be encoded.'], 422);
            }
            $json = json_encode($input, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            getMongoCollection(mongoCollectionName('client_workspaces'))->updateOne(
                ['user_id' => $userId],
                [
                    '$set' => ['workspace_json' => $json, 'updated_at' => date('c')],
                    '$setOnInsert' => ['_id' => $userId],
                ],
                ['upsert' => true],
            );
            jsonResponse(['ok' => true, 'workspace' => $input]);
        }
        jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }

    $mongoRouteGroupPaths = [
        '#^/admin/clients/(?:assign-bulk|bulk-assign|bulk-status|bin/(?:cleanup|purge-all))$#',
        '#^/admin/clients/[^/]+/assign$#',
        '#^/admin/clients/[^/]+/(?:reset-status|comments(?:/[^/]+)?|status-history(?:/[^/]+)?)$#',
        '#^/admin/signup-requests(?:/[^/]+(?:/(?:approve|reject))?)?$#',
        '#^/admin/password-reset-requests(?:/[^/]+/send-code)?$#',
        '#^/admin/pending-counts$#',
        '#^/admin/client-workspaces/[^/]+$#',
    ];
    foreach ($mongoRouteGroupPaths as $pattern) {
        if (preg_match($pattern, $apiPath) === 1) {
            jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
        }
    }
}

// -----------------------------------------------------------------------------
// 12. ADMIN: CLIENT ASSIGNMENT
// -----------------------------------------------------------------------------
if (preg_match('#^/admin/clients/(?:assign-bulk|bulk-assign)$#', $apiPath) && $method === 'POST') {
    $actor = requireActiveAdminStaff($pdo, $adminSession);
    if (isset($input['assignments'])) {
        if (!is_array($input['assignments']) || count($input['assignments']) === 0 || count($input['assignments']) > 5000) {
            jsonResponse(['ok' => false, 'error' => 'Provide between 1 and 5,000 client assignments.'], 400);
        }
        $prepared = [];
        $seen = [];
        $lookup = $pdo->prepare('SELECT * FROM clients WHERE id = ? AND deleted_at IS NULL');
        foreach ($input['assignments'] as $entry) {
            if (!is_array($entry)) jsonResponse(['ok' => false, 'error' => 'An assignment entry is invalid.'], 400);
            $clientId = trim((string)($entry['client_id'] ?? $entry['clientId'] ?? ''));
            if ($clientId === '' || isset($seen[$clientId])) jsonResponse(['ok' => false, 'error' => 'Each client must appear exactly once in the assignment list.'], 422);
            $seen[$clientId] = true;
            $lookup->execute([$clientId]);
            $client = $lookup->fetch();
            if (!$client) jsonResponse(['ok' => false, 'error' => "Client {$clientId} is unavailable."], 404);
            if (!actorCanViewClient($actor, $client)) jsonResponse(['ok' => false, 'error' => 'You cannot access this client.'], 403);
            $assignment = validateClientAssignment($pdo, [
                'office_id' => $entry['assigned_office_id'] ?? $entry['officeId'] ?? $entry['office_id'] ?? null,
                'team_id' => $entry['assigned_team_id'] ?? $entry['teamId'] ?? $entry['team_id'] ?? null,
                'team_leader_id' => $entry['assigned_team_leader_id'] ?? $entry['teamLeaderId'] ?? $entry['team_leader_id'] ?? null,
                'agent_id' => $entry['assigned_agent_id'] ?? $entry['agentId'] ?? $entry['agent_id'] ?? null,
            ]);
            assertCanAssignClient($actor, $assignment, $pdo);
            $prepared[] = [
                'client_id' => $clientId,
                'assignment' => $assignment,
            ];
        }
        $pdo->beginTransaction();
        try {
            $updated = [];
            foreach ($prepared as $entry) $updated[] = normalizeClientRow(saveClientAssignment($pdo, $entry['client_id'], $entry['assignment'], $actor));
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
        jsonResponse(['ok' => true, 'updated' => count($updated), 'clients' => $updated]);
    }
    $clientIds = $input['client_ids'] ?? $input['ids'] ?? [];
    if (!is_array($clientIds) || count($clientIds) === 0) jsonResponse(['ok' => false, 'error' => 'Select at least one client.'], 400);
    $clientIds = array_values(array_unique(array_filter(array_map(static fn($id) => trim((string)$id), $clientIds))));
    $officeId = $input['assigned_office_id'] ?? $input['officeId'] ?? $input['office_id'] ?? null;
    $teamId = $input['assigned_team_id'] ?? $input['teamId'] ?? $input['team_id'] ?? null;
    $teamLeaderId = $input['assigned_team_leader_id'] ?? $input['teamLeaderId'] ?? $input['team_leader_id'] ?? null;
    $agentId = $input['assigned_agent_id'] ?? $input['agentId'] ?? $input['agent_id'] ?? null;
    $assignment = validateClientAssignment($pdo, ['office_id' => $officeId, 'team_id' => $teamId, 'team_leader_id' => $teamLeaderId, 'agent_id' => $agentId]);
    assertCanAssignClient($actor, $assignment, $pdo);
    $clientRows = [];
    $clientLookup = $pdo->prepare('SELECT * FROM clients WHERE id = ? AND deleted_at IS NULL');
    foreach ($clientIds as $clientId) {
        $clientLookup->execute([$clientId]);
        $client = $clientLookup->fetch();
        if (!$client) jsonResponse(['ok' => false, 'error' => "Client {$clientId} is unavailable."], 404);
        if (!actorCanViewClient($actor, $client)) jsonResponse(['ok' => false, 'error' => 'You cannot access this client.'], 403);
        $clientRows[] = $clientId;
    }
    $pdo->beginTransaction();
    try {
        $updated = [];
        foreach ($clientRows as $clientId) $updated[] = normalizeClientRow(saveClientAssignment($pdo, $clientId, $assignment, $actor));
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
    jsonResponse(['ok' => true, 'updated' => count($updated), 'clients' => $updated]);
}

if (preg_match('#^/admin/clients/([^/]+)/assign$#', $apiPath, $m) && $method === 'POST') {
    $actor = requireActiveAdminStaff($pdo, $adminSession);
    $clientId = $m[1];
    $officeId = $input['assigned_office_id'] ?? $input['officeId'] ?? $input['office_id'] ?? null;
    $teamId = $input['assigned_team_id'] ?? $input['teamId'] ?? $input['team_id'] ?? null;
    $teamLeaderId = $input['assigned_team_leader_id'] ?? $input['teamLeaderId'] ?? $input['team_leader_id'] ?? null;
    $agentId = $input['assigned_agent_id'] ?? $input['agentId'] ?? $input['agent_id'] ?? null;
    $stmt = $pdo->prepare('SELECT * FROM clients WHERE id = ? AND deleted_at IS NULL');
    $stmt->execute([$clientId]);
    $client = $stmt->fetch();
    if (!$client) jsonResponse(['ok' => false, 'error' => 'Client not found.'], 404);
    if (!actorCanViewClient($actor, $client)) jsonResponse(['ok' => false, 'error' => 'You cannot access this client.'], 403);
    $assignment = validateClientAssignment($pdo, ['office_id' => $officeId, 'team_id' => $teamId, 'team_leader_id' => $teamLeaderId, 'agent_id' => $agentId]);
    assertCanAssignClient($actor, $assignment, $pdo);
    $pdo->beginTransaction();
    try {
        $updated = saveClientAssignment($pdo, $clientId, $assignment, $actor);
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
    jsonResponse(['ok' => true, 'client' => normalizeClientRow($updated)]);
}

// Admin client actions called by the bulk toolbar and client profile dialogs.
if ($apiPath === '/admin/clients/bulk-status' && $method === 'POST') {
    $actor = requireActiveAdminStaff($pdo, $adminSession);
    if ($actor['role'] !== 'Super Admin') jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can bulk-update client status.'], 403);
    $ids = $input['ids'] ?? [];
    $status = trim((string)($input['status'] ?? ''));
    $allowedStatuses = ['Active', 'Suspended', 'Disabled', 'New', 'In Line', 'No Answer', 'Deposit', 'Failed Deposit', 'Didn\'t Register', 'Not Interested', 'Low Potential', 'NA1', 'NA2', 'NA3', 'Never Answer', 'No Potential', 'Wrong Person', 'Wrong Number', 'Call Back'];
    if (!is_array($ids) || count($ids) === 0 || count($ids) > 5000 || !in_array($status, $allowedStatuses, true)) {
        jsonResponse(['ok' => false, 'error' => 'Provide selected client IDs and a valid status.'], 422);
    }
    $ids = array_values(array_unique(array_filter(array_map(static fn($id) => trim((string)$id), $ids))));
    $pdo->beginTransaction();
    try {
        $update = $pdo->prepare('UPDATE clients SET status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL');
        $updated = [];
        foreach ($ids as $id) {
            $update->execute([$status, date('c'), $id]);
            if ($update->rowCount() > 0) $updated[] = $id;
        }
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
    jsonResponse(['ok' => true, 'updated' => count($updated), 'ids' => $updated]);
}

if (preg_match('#^/admin/clients/([^/]+)/(reset-status|comments|status-history)(?:/([^/]+))?$#', $apiPath, $m)) {
    $actor = requireActiveAdminStaff($pdo, $adminSession);
    $clientId = rawurldecode($m[1]);
    $action = $m[2];
    $entryId = isset($m[3]) ? rawurldecode($m[3]) : null;
    if ($method === 'POST' && $action === 'reset-status') {
        $client = requireVisibleClient($pdo, $actor, $clientId);
        $history = json_decode((string)($client['status_history'] ?? '[]'), true);
        if (!is_array($history)) $history = [];
        $history[] = [
            'id' => 'st_' . bin2hex(random_bytes(5)),
            'from_stage' => (string)($client['stage'] ?? ''),
            'to_stage' => 'New',
            'by_admin_id' => $actor['id'],
            'by_name' => $actor['name'],
            'created_at' => date('c'),
        ];
        $pdo->prepare('UPDATE clients SET stage = ?, status = ?, status_history = ?, updated_at = ? WHERE id = ?')
            ->execute(['New', 'New', json_encode($history, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), date('c'), $clientId]);
    } elseif ($method === 'DELETE' && $action === 'comments') {
        $client = requireVisibleClient($pdo, $actor, $clientId);
        if ($entryId === null) {
            $pdo->prepare('UPDATE clients SET comment_history = ?, updated_at = ? WHERE id = ?')
                ->execute(['[]', date('c'), $clientId]);
        } else {
            $comments = json_decode((string)($client['comment_history'] ?? '[]'), true);
            if (!is_array($comments)) $comments = [];
            $comments = array_values(array_filter($comments, static fn($comment) =>
                !is_array($comment) || (string)($comment['id'] ?? $comment['comment_id'] ?? '') !== $entryId
            ));
            $pdo->prepare('UPDATE clients SET comment_history = ?, updated_at = ? WHERE id = ?')
                ->execute([json_encode($comments, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), date('c'), $clientId]);
        }
    } elseif ($method === 'DELETE' && $action === 'status-history' && $entryId !== null) {
        $client = requireVisibleClient($pdo, $actor, $clientId);
        $history = json_decode((string)($client['status_history'] ?? '[]'), true);
        if (!is_array($history)) $history = [];
        $history = array_values(array_filter($history, static fn($entry) =>
            !is_array($entry) || (string)($entry['id'] ?? '') !== $entryId
        ));
        $pdo->prepare('UPDATE clients SET status_history = ?, updated_at = ? WHERE id = ?')
            ->execute([json_encode($history, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), date('c'), $clientId]);
    } else {
        jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }
    $updatedClient = $pdo->prepare('SELECT * FROM clients WHERE id = ?');
    $updatedClient->execute([$clientId]);
    jsonResponse(['ok' => true, 'client' => normalizeClientRow($updatedClient->fetch() ?: [])]);
}

if ($apiPath === '/admin/clients/bin/cleanup' && $method === 'POST') {
    $actor = requireActiveAdminStaff($pdo, $adminSession);
    if ($actor['role'] !== 'Super Admin') jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can clean up the recycle bin.'], 403);
    $days = filter_var($input['older_than_days'] ?? 30, FILTER_VALIDATE_INT);
    if ($days === false || $days < 1 || $days > 3650) jsonResponse(['ok' => false, 'error' => 'The cleanup age must be between 1 and 3,650 days.'], 422);
    $cutoff = date('c', time() - ($days * 86400));
    $q = $pdo->prepare('SELECT id FROM clients WHERE deleted_at IS NOT NULL AND deleted_at < ?');
    $q->execute([$cutoff]);
    $ids = array_map('strval', $q->fetchAll(PDO::FETCH_COLUMN));
    if ($ids) {
        $pdo->beginTransaction();
        try {
            $assignmentHistory = $pdo->prepare('DELETE FROM client_assignment_history WHERE client_id = ?');
            $deleteClient = $pdo->prepare('DELETE FROM clients WHERE id = ? AND deleted_at IS NOT NULL');
            foreach ($ids as $id) {
                $assignmentHistory->execute([$id]);
                $deleteClient->execute([$id]);
            }
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
    }
    jsonResponse(['ok' => true, 'deleted' => count($ids), 'ids' => $ids]);
}

if ($apiPath === '/admin/clients/bin/purge-all' && $method === 'POST') {
    $actor = requireActiveAdminStaff($pdo, $adminSession);
    if ($actor['role'] !== 'Super Admin') jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can permanently purge the recycle bin.'], 403);
    $requestedIds = $input['ids'] ?? [];
    if (!is_array($requestedIds) || count($requestedIds) > 5000) jsonResponse(['ok' => false, 'error' => 'Provide a valid list of client IDs.'], 422);
    if ($requestedIds) {
        $requestedIds = array_values(array_unique(array_filter(array_map(static fn($id) => trim((string)$id), $requestedIds))));
        $placeholders = implode(',', array_fill(0, count($requestedIds), '?'));
        $q = $pdo->prepare("SELECT id FROM clients WHERE deleted_at IS NOT NULL AND id IN ({$placeholders})");
        $q->execute($requestedIds);
    } else {
        $q = $pdo->query('SELECT id FROM clients WHERE deleted_at IS NOT NULL');
    }
    $ids = array_map('strval', $q->fetchAll(PDO::FETCH_COLUMN));
    if ($ids) {
        $pdo->beginTransaction();
        try {
            $assignmentHistory = $pdo->prepare('DELETE FROM client_assignment_history WHERE client_id = ?');
            $deleteClient = $pdo->prepare('DELETE FROM clients WHERE id = ? AND deleted_at IS NOT NULL');
            foreach ($ids as $id) {
                $assignmentHistory->execute([$id]);
                $deleteClient->execute([$id]);
            }
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
    }
    jsonResponse(['ok' => true, 'deleted' => count($ids), 'ids' => $ids]);
}

// Registration and password-reset queues used by the Super Admin tools.
if ($apiPath === '/admin/signup-requests') {
    $actor = requireActiveAdminStaff($pdo, $adminSession);
    if ($actor['role'] !== 'Super Admin') jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can manage signup requests.'], 403);
    if ($method !== 'GET') jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    $status = trim((string)($_GET['status'] ?? 'pending'));
    if ($status === 'all') {
        $rows = $pdo->query('SELECT * FROM signup_requests ORDER BY created_at DESC')->fetchAll();
    } else {
        $stmt = $pdo->prepare('SELECT * FROM signup_requests WHERE status = ? ORDER BY created_at DESC');
        $stmt->execute([$status]);
        $rows = $stmt->fetchAll();
    }
    $items = [];
    foreach ($rows as $row) {
        $details = json_decode((string)$row['request_data'], true);
        if (!is_array($details)) $details = [];
        $items[] = array_merge($details, [
            'id' => $row['id'],
            'name' => $row['name'],
            'email' => $row['email'],
            'status' => $row['status'],
            'createdAt' => $row['created_at'],
        ]);
    }
    jsonResponse(['ok' => true, 'items' => $items, 'total' => count($items)]);
}

if (preg_match('#^/admin/signup-requests/([^/]+)(?:/(approve|reject))?$#', $apiPath, $m)) {
    $actor = requireActiveAdminStaff($pdo, $adminSession);
    if ($actor['role'] !== 'Super Admin') jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can manage signup requests.'], 403);
    $requestId = rawurldecode($m[1]);
    $action = $m[2] ?? '';
    $q = $pdo->prepare('SELECT * FROM signup_requests WHERE id = ?');
    $q->execute([$requestId]);
    $request = $q->fetch();
    if (!$request) jsonResponse(['ok' => false, 'error' => 'Signup request not found.'], 404);
    if ($method === 'DELETE' && $action === '') {
        $pdo->prepare('DELETE FROM signup_requests WHERE id = ?')->execute([$requestId]);
        jsonResponse(['ok' => true, 'id' => $requestId, 'deleted' => true]);
    }
    if ($method === 'POST' && $action === 'reject') {
        $reason = trim((string)($input['reason'] ?? ''));
        $code = trim((string)($input['code'] ?? ''));
        $pdo->prepare("UPDATE signup_requests SET status = 'rejected', rejection_reason = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'")
            ->execute([$reason !== '' ? $reason : $code, date('c'), $requestId]);
        jsonResponse(['ok' => true, 'id' => $requestId, 'status' => 'rejected']);
    }
    if ($method === 'POST' && $action === 'approve') {
        if ($request['status'] !== 'pending') jsonResponse(['ok' => false, 'error' => 'This request has already been reviewed.'], 409);
        $code = trim((string)($input['verification_code'] ?? $input['verificationCode'] ?? ''));
        if (!preg_match('/^\d{6}$/', $code)) jsonResponse(['ok' => false, 'error' => 'Enter a six-digit verification code.'], 422);
        $data = json_decode((string)$request['request_data'], true);
        if (!is_array($data)) jsonResponse(['ok' => false, 'error' => 'Signup request data is invalid.'], 422);
        $email = strtolower(trim((string)$request['email']));
        $candidateStmt = $pdo->prepare("SELECT id, name, company, email FROM clients WHERE LOWER(TRIM(email)) = ? AND deleted_at IS NULL ORDER BY created_at, id");
        $candidateStmt->execute([$email]);
        $candidates = $candidateStmt->fetchAll(PDO::FETCH_ASSOC);
        $requestedClientId = trim((string)($input['client_id'] ?? ''));
        if ($candidates && $requestedClientId === '') {
            jsonResponse([
                'ok' => false,
                'code' => 'CLIENT_IDENTITY_SELECTION_REQUIRED',
                'error' => 'Choose the Client record this portal signup belongs to. Email alone is not enough to link identities.',
                'candidateClients' => $candidates,
            ], 409);
        }
        $matchedClient = null;
        if ($requestedClientId !== '') {
            foreach ($candidates as $candidate) {
                if ((string)$candidate['id'] === $requestedClientId) {
                    $matchedClient = $candidate;
                    break;
                }
            }
            if (!$matchedClient) {
                jsonResponse(['ok' => false, 'error' => 'The selected Client record does not match this signup email.'], 422);
            }
            $accessExists = $pdo->prepare('SELECT client_id FROM client_portal_access WHERE client_id = ?');
            $accessExists->execute([$requestedClientId]);
            if ($accessExists->fetchColumn()) {
                jsonResponse(['ok' => false, 'error' => 'This Client already has a portal access record.'], 409);
            }
        }
        $assignment = validateClientAssignment($pdo, [
            'office_id' => $input['assigned_office_id'] ?? $input['office_id'] ?? null,
            'team_id' => $input['assigned_team_id'] ?? $input['team_id'] ?? null,
            'team_leader_id' => $input['assigned_team_leader_id'] ?? null,
            'agent_id' => $input['agent_id'] ?? $input['assigned_agent_id'] ?? null,
        ]);
        assertCanAssignClient($actor, $assignment, $pdo);
        $now = date('c');
        $name = trim((string)($data['name'] ?? $request['name']));
        $parts = preg_split('/\s+/', $name, 2) ?: [$name, ''];
        $firstName = (string)($parts[0] ?? '');
        $lastName = (string)($parts[1] ?? '');
        $clientId = $matchedClient ? $requestedClientId : 'client_' . bin2hex(random_bytes(10));
        $client = null;
        $pdo->beginTransaction();
        try {
            if ($matchedClient) {
                $clientQuery = $pdo->prepare('SELECT * FROM clients WHERE id = ? AND deleted_at IS NULL');
                $clientQuery->execute([$clientId]);
                $client = $clientQuery->fetch() ?: [];
                if (array_filter($assignment, static fn($value) => $value !== null)) {
                    $client = saveClientAssignment($pdo, $clientId, $assignment, $actor);
                }
            } else {
                $pdo->prepare("INSERT INTO clients (id, first_name, last_name, name, email, phone, country, country_code, company, message, source, stage, status, assigned_office_id, assigned_team_id, assigned_team_leader_id, assigned_agent_id, assigned_by, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'signup_request', 'New', 'New', ?, ?, ?, ?, ?, ?, ?)")
                    ->execute([
                        $clientId, $firstName, $lastName, $name, $email,
                        trim((string)($data['phone'] ?? '')),
                        trim((string)($data['country'] ?? '')),
                        trim((string)($data['country_code'] ?? '')),
                        trim((string)($data['company'] ?? '')),
                        trim((string)($data['message'] ?? '')),
                        $assignment['office_id'], $assignment['team_id'], $assignment['team_leader_id'], $assignment['agent_id'],
                        $actor['id'], $now, $now,
                    ]);
                $clientQuery = $pdo->prepare('SELECT * FROM clients WHERE id = ?');
                $clientQuery->execute([$clientId]);
                $client = $clientQuery->fetch() ?: [];
            }
            $pdo->prepare("INSERT INTO client_portal_access (client_id, password_hash, status, portal_enabled, created_at)
                VALUES (?, '', 'Active', 0, ?)")
                ->execute([$clientId, $now]);
            $pdo->prepare("UPDATE signup_requests SET status = 'approved', verification_code_hash = ?, verification_expires_at = ?, verification_attempts = 0, client_id = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'")
                ->execute([password_hash($code, PASSWORD_DEFAULT), date('c', time() + 3600), $clientId, $now, $requestId]);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
        jsonResponse(['ok' => true, 'client' => normalizeClientRow($client), 'client_id' => $clientId]);
    }
    jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

if ($apiPath === '/admin/password-reset-requests') {
    $actor = requireActiveAdminStaff($pdo, $adminSession);
    if ($actor['role'] !== 'Super Admin') jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can manage password-reset requests.'], 403);
    if ($method !== 'GET') jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    $rows = $pdo->query("SELECT c.id, c.name AS user_name, c.email AS user_email, r.requested_at
        FROM password_reset_requests r
        JOIN clients c ON c.id = r.user_id
        JOIN client_portal_access a ON a.client_id = c.id
        WHERE r.status = 'pending' AND a.status = 'Active' AND a.portal_enabled = 1
        ORDER BY r.requested_at ASC")->fetchAll();
    foreach ($rows as &$row) $row['id'] = $row['id'];
    unset($row);
    jsonResponse(['ok' => true, 'items' => $rows]);
}

if (preg_match('#^/admin/password-reset-requests/([^/]+)/send-code$#', $apiPath, $m) && $method === 'POST') {
    $actor = requireActiveAdminStaff($pdo, $adminSession);
    if ($actor['role'] !== 'Super Admin') jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can send password-reset codes.'], 403);
    $userId = rawurldecode($m[1]);
    $code = trim((string)($input['code'] ?? ''));
    if (!preg_match('/^\d{6}$/', $code)) jsonResponse(['ok' => false, 'error' => 'Enter a six-digit reset code.'], 422);
    $stmt = $pdo->prepare("SELECT user_id FROM password_reset_requests WHERE user_id = ? AND status = 'pending'");
    $stmt->execute([$userId]);
    if (!$stmt->fetchColumn()) jsonResponse(['ok' => false, 'error' => 'Pending password-reset request not found.'], 404);
    $now = date('c');
    $pdo->prepare("UPDATE password_reset_requests SET status = 'sent', code_hash = ?, expires_at = ?, sent_at = ?, attempt_count = 0 WHERE user_id = ?")
        ->execute([password_hash($code, PASSWORD_DEFAULT), date('c', time() + 3600), $now, $userId]);
    jsonResponse(['ok' => true, 'user_id' => $userId, 'expires_at' => date('c', time() + 3600)]);
}

if ($apiPath === '/admin/pending-counts' && $method === 'GET') {
    requireActiveAdminStaff($pdo, $adminSession);
    $signups = (int)$pdo->query("SELECT COUNT(*) FROM signup_requests WHERE status = 'pending'")->fetchColumn();
    $resets = (int)$pdo->query("SELECT COUNT(*) FROM password_reset_requests WHERE status = 'pending'")->fetchColumn();
    jsonResponse(['ok' => true, 'signups' => $signups, 'password_resets' => $resets]);
}

if (preg_match('#^/admin/client-workspaces/([^/]+)$#', $apiPath, $m)) {
    $actor = requireActiveAdminStaff($pdo, $adminSession);
    if ($actor['role'] !== 'Super Admin') jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can manage client workspaces.'], 403);
    $userId = rawurldecode($m[1]);
    $clientStmt = $pdo->prepare('SELECT id FROM clients WHERE id = ?');
    $clientStmt->execute([$userId]);
    if (!$clientStmt->fetchColumn()) jsonResponse(['ok' => false, 'error' => 'Client account not found.'], 404);
    if ($method === 'GET') {
        $workspaceStmt = $pdo->prepare('SELECT workspace_json FROM client_workspaces WHERE user_id = ?');
        $workspaceStmt->execute([$userId]);
        $raw = $workspaceStmt->fetchColumn();
        $workspace = $raw === false ? null : json_decode((string)$raw, true);
        if ($raw !== false && !is_array($workspace)) jsonResponse(['ok' => false, 'error' => 'Stored client workspace data is invalid.'], 500);
        jsonResponse(['ok' => true, 'workspace' => $workspace]);
    }
    if ($method === 'PUT') {
        if (!is_array($input) || strlen(json_encode($input) ?: '') > 1048576) {
            jsonResponse(['ok' => false, 'error' => 'Workspace data must be a JSON object under 1 MB.'], 422);
        }
        $json = json_encode($input, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($json === false) jsonResponse(['ok' => false, 'error' => 'Workspace data could not be encoded.'], 422);
        $exists = $pdo->prepare('SELECT user_id FROM client_workspaces WHERE user_id = ?');
        $exists->execute([$userId]);
        if ($exists->fetchColumn()) {
            $pdo->prepare('UPDATE client_workspaces SET workspace_json = ?, updated_at = ? WHERE user_id = ?')
                ->execute([$json, date('c'), $userId]);
        } else {
            $pdo->prepare('INSERT INTO client_workspaces (user_id, workspace_json, updated_at) VALUES (?, ?, ?)')
                ->execute([$userId, $json, date('c')]);
        }
        jsonResponse(['ok' => true, 'workspace' => $input]);
    }
    jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
}
