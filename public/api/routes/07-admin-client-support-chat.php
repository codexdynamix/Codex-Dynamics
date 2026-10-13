<?php
/** Route group: ADMIN <-> CLIENT SUPPORT CHAT (included by index.php in order; uses its request globals). */

declare(strict_types=1);

function mongoSupportCleanRow(array $row): array {
    unset($row['_id'], $row['_migration_source']);
    return $row;
}

function mongoSupportIdFilter(string $id): array {
    if (ctype_digit($id)) {
        return ['$or' => [['id' => $id], ['id' => (int)$id]]];
    }
    return ['id' => $id];
}

function mongoSupportPresenceFilter(string $clientId, string $actorType, string $actorId): array {
    return ['client_id' => $clientId, 'actor_type' => $actorType, 'actor_id' => $actorId];
}

function mongoSupportUnreadFilter(string $clientId, string $sender): array {
    return ['user_id' => $clientId, 'sender' => $sender, 'is_read' => 0];
}

function mongoSupportMessageId(array $message): string {
    return (string)($message['id'] ?? '');
}

function mongoSupportMessageWriteFilter(array $message): array {
    if (array_key_exists('_id', $message)) {
        return ['_id' => $message['_id']];
    }
    return mongoSupportIdFilter(mongoSupportMessageId($message));
}

function mongoSupportMessageDocuments(
    string $messageId,
    string $userId,
    string $sender,
    string $senderId,
    string $senderName,
    string $body,
    string $now,
): array {
    $auditId = 'aud_' . bin2hex(random_bytes(8));
    return [
        'message' => [
            'id' => $messageId,
            'user_id' => $userId,
            'sender' => $sender,
            'sender_id' => $senderId,
            'sender_name' => $senderName,
            'body' => $body,
            'is_read' => 0,
            'created_at' => $now,
        ],
        'audit' => [
            'id' => $auditId,
            'user_id' => $userId,
            'action' => $sender === 'client' ? 'SUPPORT_MESSAGE_RECEIVED' : 'SUPPORT_MESSAGE_SENT',
            'details' => $sender === 'client'
                ? 'Client sent a support message.'
                : 'Staff sent a support message.',
            'created_at' => $now,
        ],
    ];
}

function mongoSupportTransaction(callable $operation): mixed {
    $session = null;
    try {
        $autoload = dirname(__DIR__) . '/vendor/autoload.php';
        if (!is_file($autoload)) {
            throw new RuntimeException('MongoDB dependencies are missing.');
        }
        require_once $autoload;
        if (!extension_loaded('mongodb')) {
            throw new RuntimeException('The PHP MongoDB extension is unavailable.');
        }
        [$uri, $databaseName] = mongoConfiguration();
        $mongoClient = new \MongoDB\Client($uri, [], ['serverSelectionTimeoutMS' => 5000]);
        $session = $mongoClient->startSession();
        $session->startTransaction();
        $database = $mongoClient->selectDatabase($databaseName);
        $result = $operation($database, $session);
        $session->commitTransaction();
        return $result;
    } catch (Throwable) {
        if ($session !== null) {
            try {
                $session->abortTransaction();
            } catch (Throwable) {
                // Keep the API response generic and fail closed if abort also fails.
            }
        }
        jsonResponse([
            'ok' => false,
            'error' => 'Atomic support-chat changes are unavailable in MongoDB mode.',
        ], 501);
    } finally {
        if ($session !== null) {
            try {
                $session->endSession();
            } catch (Throwable) {
                // Ending a session after commit must not change the response.
            }
        }
    }
}

function mongoSupportWriteMessageTransaction(array $documents, array $client, string $body, bool $notifyStaff): void {
    mongoSupportTransaction(static function ($database, $session) use ($documents, $client, $body, $notifyStaff): void {
        $database->selectCollection(mongoCollectionName('messages'))
            ->insertOne($documents['message'], ['session' => $session]);
        $database->selectCollection(mongoCollectionName('audit_logs'))
            ->insertOne($documents['audit'], ['session' => $session]);

        if (!$notifyStaff) return;
        $recipientIds = array_values(array_unique(array_filter([
            $client['assigned_agent_id'] ?? null,
            $client['assigned_team_leader_id'] ?? null,
        ])));
        if (!$recipientIds && !empty($client['assigned_office_id'])) {
            foreach ($database->selectCollection(mongoCollectionName('staff_users'))->find([
                'office_id' => $client['assigned_office_id'],
                'role' => 'Office Manager',
                'status' => 'Active',
                'deleted_at' => null,
            ], ['session' => $session]) as $manager) {
                $recipientIds[] = (string)($manager['id'] ?? '');
            }
        }

        foreach (array_unique($recipientIds) as $recipientId) {
            if ($recipientId === '') continue;
            $activeStaff = $database->selectCollection(mongoCollectionName('staff_users'))->findOne([
                'id' => (string)$recipientId,
                'status' => 'Active',
                'deleted_at' => null,
            ], ['session' => $session]);
            if ($activeStaff !== null) {
                $notificationId = 'an_' . bin2hex(random_bytes(12));
                $database->selectCollection(mongoCollectionName('admin_notifications'))->insertOne([
                    'id' => $notificationId,
                    'staff_user_id' => (string)$recipientId,
                    'kind' => 'client_message',
                    'title' => 'New client message',
                    'body' => substr($body, 0, 2000),
                    'created_at' => $documents['message']['created_at'],
                ], ['session' => $session]);
            }
        }
    });
}

function mongoSupportClearClientConversation(string $clientId): int {
    return mongoSupportTransaction(static function ($database, $session) use ($clientId): int {
        $deleted = $database->selectCollection(mongoCollectionName('messages'))
            ->deleteMany(['user_id' => $clientId], ['session' => $session])
            ->getDeletedCount();
        $database->selectCollection(mongoCollectionName('crm_message_presence'))
            ->deleteMany(['client_id' => $clientId], ['session' => $session]);
        return $deleted;
    });
}

// Keep MongoDB chat requests out of the PDO implementation below. Cross-
// collection operations are transactional or fail closed.
if (isMongoStorageEnabled()) {
    if ($apiPath === '/admin/messages/unread_counts') {
        $actor = mongoRouteRequireAdminCapability($adminSession, 'chat');
        $visibleClients = [];
        foreach (mongoFindMany('clients', ['deleted_at' => null]) as $client) {
            if (mongoRouteActorCanViewClient($actor, $client) && isset($client['id'])) {
                $visibleClients[(string)$client['id']] = true;
            }
        }

        $counts = [];
        $total = 0;
        foreach (mongoFindMany('messages', ['sender' => 'client', 'is_read' => 0]) as $message) {
            $clientId = (string)($message['user_id'] ?? '');
            if ($clientId === '' || !isset($visibleClients[$clientId])) continue;
            $counts[$clientId] = ($counts[$clientId] ?? 0) + 1;
            $total++;
        }
        jsonResponse(['ok' => true, 'counts' => $counts, 'total' => $total]);
    }

    if ($apiPath === '/admin/presence' && $method === 'POST') {
        $actor = mongoRouteAdminActor($adminSession);
        $now = date('c');
        getMongoCollection(mongoCollectionName('admin_sessions'))->updateOne(
            ['token_hash' => $adminSession['token_hash'] ?? null, 'user_id' => $actor['id']],
            ['$set' => ['last_seen_at' => $now]],
        );
        jsonResponse(['ok' => true, 'staff_id' => $actor['id'], 'last_seen_at' => $now]);
    }

    if (in_array($apiPath, ['/admin/messages/presence', '/portal/messages/presence'], true)) {
        $isAdminPresence = $apiPath === '/admin/messages/presence';
        $clientId = $isAdminPresence
            ? trim((string)($_GET['user_id'] ?? $input['user_id'] ?? ''))
            : (string)$portalSession['id'];
        if ($isAdminPresence) {
            $actor = mongoRouteRequireAdminCapability($adminSession, 'chat');
            if ($clientId === '') jsonResponse(['ok' => false, 'error' => 'user_id is required.'], 400);
            mongoRouteRequireVisibleClient($actor, $clientId);
            $actorType = 'staff';
            $actorId = (string)$actor['id'];
        } else {
            $actorType = 'client';
            $actorId = $clientId;
        }

        if ($method === 'POST') {
            $now = date('c');
            $presenceFilter = mongoSupportPresenceFilter($clientId, $actorType, $actorId);
            $existingPresence = mongoFindOne('crm_message_presence', $presenceFilter);
            $stableId = $existingPresence['_id'] ?? 'presence_' . hash(
                'sha256',
                $clientId . "\0" . $actorType . "\0" . $actorId,
            );
            getMongoCollection(mongoCollectionName('crm_message_presence'))->updateOne(
                ['_id' => $stableId],
                ['$set' => [
                    'client_id' => $clientId,
                    'actor_type' => $actorType,
                    'actor_id' => $actorId,
                    'is_typing' => !empty($input['is_typing']) ? 1 : 0,
                    'last_seen_at' => $now,
                ]],
                ['upsert' => true],
            );
            jsonResponse(['ok' => true, 'last_seen_at' => $now]);
        }

        if ($method !== 'GET') jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
        $cutoff = date('c', time() - 15);
        $presenceRows = mongoFindMany('crm_message_presence', [
            'client_id' => $clientId,
            'last_seen_at' => ['$gte' => $cutoff],
        ]);
        $presence = ['client_typing' => false, 'staff_typing' => false, 'staff_online' => false];
        foreach ($presenceRows as $row) {
            if (($row['actor_type'] ?? null) === 'client' && (int)($row['is_typing'] ?? 0) === 1) {
                $presence['client_typing'] = true;
            }
            if (($row['actor_type'] ?? null) === 'staff') {
                $presence['staff_online'] = true;
                if ((int)($row['is_typing'] ?? 0) === 1) $presence['staff_typing'] = true;
            }
        }
        jsonResponse(['ok' => true, 'presence' => $presence]);
    }

    if (in_array($apiPath, ['/admin/messages', '/client/messages'], true)
        && in_array($method, ['GET', 'POST'], true)) {
        $isClientMessageRoute = $apiPath === '/client/messages';
        $actor = $isClientMessageRoute ? null : mongoRouteRequireAdminCapability($adminSession, 'chat');
        if ($method === 'POST') {
            $userId = $isClientMessageRoute
                ? (string)$portalSession['id']
                : trim((string)($input['user_id'] ?? $input['userId'] ?? ''));
            $body = trim((string)($input['body'] ?? $input['text'] ?? ''));
            if (!$userId || !$body) {
                jsonResponse(['ok' => false, 'error' => 'user_id and body required'], 400);
            }
            if (strlen($body) > 5000) {
                jsonResponse(['ok' => false, 'error' => 'Messages cannot exceed 5,000 characters.'], 422);
            }
            $client = $isClientMessageRoute
                ? (mongoFindOne('clients', ['id' => $userId, 'deleted_at' => null]) ?? [])
                : mongoRouteRequireVisibleClient($actor, $userId);
            $sender = $isClientMessageRoute ? 'client' : 'agent';
            $senderId = $isClientMessageRoute ? (string)$portalSession['id'] : (string)$actor['id'];
            $senderName = $isClientMessageRoute
                ? (string)($portalSession['name'] ?? 'Client')
                : (string)($actor['name'] ?? 'Support Agent');
            $messageId = 'msg_' . bin2hex(random_bytes(12));
            $now = date('c');
            $documents = mongoSupportMessageDocuments(
                $messageId,
                $userId,
                $sender,
                $senderId,
                $senderName,
                $body,
                $now,
            );
            mongoSupportWriteMessageTransaction($documents, $client, $body, $isClientMessageRoute);
            jsonResponse([
                'ok' => true,
                'message' => [
                    'id' => $messageId,
                    'user_id' => $userId,
                    'sender' => $sender,
                    'sender_id' => $senderId,
                    'sender_name' => $senderName,
                    'body' => $body,
                    'created_at' => $now,
                    'edited_at' => null,
                    'agent_id' => $isClientMessageRoute ? null : $actor['id'],
                ],
            ]);
        }

        $userId = $isClientMessageRoute ? (string)$portalSession['id'] : trim((string)($_GET['user_id'] ?? ''));
        if (!$userId) {
            jsonResponse(['ok' => true, 'messages' => [], 'unread_count' => 0]);
        }
        $client = null;
        if (!$isClientMessageRoute) {
            $client = mongoRouteRequireVisibleClient($actor, $userId);
        }
        $limit = max(1, min(200, (int)($_GET['limit'] ?? 100)));
        $before = trim((string)($_GET['before'] ?? ''));
        $filter = ['user_id' => $userId];
        if ($before !== '') $filter['created_at'] = ['$lt' => $before];
        $messages = mongoFindMany('messages', $filter, ['sort' => ['created_at' => -1], 'limit' => $limit + 1]);
        $hasMore = count($messages) > $limit;
        if ($hasMore) array_pop($messages);
        $messages = array_reverse(array_map('mongoSupportCleanRow', $messages));
        $unreadCount = getMongoCollection(mongoCollectionName('messages'))->countDocuments(
            mongoSupportUnreadFilter($userId, $isClientMessageRoute ? 'agent' : 'client'),
        );
        $response = [
            'ok' => true,
            'user' => $isClientMessageRoute
                ? ['id' => $userId]
                : [
                    'id' => $userId,
                    'name' => $client['name'] ?? '',
                    'email' => $client['email'] ?? '',
                    'company' => $client['company'] ?? '',
                ],
            'messages' => $messages,
            'unread_count' => (int)$unreadCount,
            'has_more' => $hasMore,
        ];
        jsonResponse($response);
    }

    if ($apiPath === '/client/messages' && $method === 'DELETE') {
        $clientId = (string)$portalSession['id'];
        $deleted = mongoSupportClearClientConversation($clientId);
        jsonResponse(['ok' => true, 'deleted' => $deleted]);
    }

    if (preg_match('#^/(admin|client)/messages/([^/]+)$#', $apiPath, $editMatch) && $method === 'PATCH') {
        $isClient = $editMatch[1] === 'client';
        $messageId = rawurldecode($editMatch[2]);
        $message = mongoFindOne('messages', mongoSupportIdFilter($messageId));
        if (!$message) jsonResponse(['ok' => false, 'error' => 'Message not found.'], 404);

        if ($isClient) {
            $actorId = (string)$portalSession['id'];
            if ((string)($message['user_id'] ?? '') !== $actorId
                || ($message['sender'] ?? null) !== 'client'
                || (string)($message['sender_id'] ?? '') !== $actorId) {
                jsonResponse(['ok' => false, 'error' => 'You can only edit your own messages.'], 403);
            }
        } else {
            $actor = mongoRouteRequireAdminCapability($adminSession, 'chat');
            mongoRouteRequireVisibleClient($actor, (string)($message['user_id'] ?? ''));
            $isSuperAdmin = $actor['role'] === 'Super Admin';
            if (($message['sender'] ?? null) !== 'agent'
                || (!$isSuperAdmin && (string)($message['sender_id'] ?? '') !== (string)$actor['id'])) {
                jsonResponse(['ok' => false, 'error' => 'You can only edit your own staff messages.'], 403);
            }
            $actorId = (string)$actor['id'];
        }

        $createdAt = strtotime((string)($message['created_at'] ?? ''));
        if ($createdAt === false || $createdAt < time() - 420) {
            jsonResponse(['ok' => false, 'error' => 'Messages can only be edited within seven minutes of sending.'], 422);
        }
        $body = trim((string)($input['body'] ?? ''));
        if ($body === '' || strlen($body) > 5000) {
            jsonResponse(['ok' => false, 'error' => 'Enter a message of 1 to 5,000 characters.'], 422);
        }
        $editedAt = date('c');
        getMongoCollection(mongoCollectionName('messages'))->updateOne(
            [
                ...mongoSupportMessageWriteFilter($message),
                'user_id' => $message['user_id'],
                'sender' => $message['sender'],
                'sender_id' => $message['sender_id'] ?? null,
                'created_at' => $message['created_at'],
            ],
            ['$set' => ['body' => $body, 'edited_at' => $editedAt]],
        );
        jsonResponse(['ok' => true, 'message' => [
            'id' => $messageId,
            'user_id' => (string)$message['user_id'],
            'sender' => (string)$message['sender'],
            'sender_id' => (string)($message['sender_id'] ?? $actorId),
            'sender_name' => (string)($message['sender_name'] ?? ''),
            'body' => $body,
            'created_at' => (string)$message['created_at'],
            'edited_at' => $editedAt,
        ]]);
    }

    if ($apiPath === '/admin/messages/read' && $method === 'POST') {
        $actor = mongoRouteRequireAdminCapability($adminSession, 'chat');
        $userId = trim((string)($input['user_id'] ?? ''));
        if (!$userId) jsonResponse(['ok' => false, 'error' => 'user_id is required.'], 400);
        mongoRouteRequireVisibleClient($actor, $userId);
        $marked = mongoSupportTransaction(static function ($database, $session) use ($userId): int {
            return $database->selectCollection(mongoCollectionName('messages'))
                ->updateMany(
                    mongoSupportUnreadFilter($userId, 'client'),
                    ['$set' => ['is_read' => 1]],
                    ['session' => $session],
                )
                ->getModifiedCount();
        });
        jsonResponse(['ok' => true, 'marked' => $marked]);
    }

    if (($apiPath === '/admin/messages/clear' && $method === 'POST')
        || ($apiPath === '/admin/messages' && $method === 'DELETE')) {
        $actor = mongoRouteRequireAdminCapability($adminSession, 'chat');
        $userId = trim((string)($_GET['user_id'] ?? $input['user_id'] ?? ''));
        if (!$userId) jsonResponse(['ok' => false, 'error' => 'user_id is required.'], 400);
        mongoRouteRequireVisibleClient($actor, $userId);
        $deleted = mongoSupportTransaction(static function ($database, $session) use ($userId): int {
            return $database->selectCollection(mongoCollectionName('messages'))
                ->deleteMany(['user_id' => $userId], ['session' => $session])
                ->getDeletedCount();
        });
        jsonResponse(['ok' => true, 'deleted' => $deleted]);
    }

    if (preg_match('#^/admin/messages/([^/]+)/attachment$#', $apiPath, $attachmentMatch) && $method === 'GET') {
        $actor = mongoRouteRequireAdminCapability($adminSession, 'chat');
        $message = mongoFindOne('messages', mongoSupportIdFilter(rawurldecode($attachmentMatch[1])));
        if (!$message || empty($message['attachment_path'])) {
            jsonResponse(['ok' => false, 'error' => 'Attachment not found.'], 404);
        }
        mongoRouteRequireVisibleClient($actor, (string)$message['user_id']);

        $relativePath = str_replace('\\', '/', (string)$message['attachment_path']);
        $relativePath = ltrim($relativePath, '/');
        if (!str_starts_with($relativePath, 'uploads/messages/')) {
            jsonResponse(['ok' => false, 'error' => 'Attachment path is not valid.'], 404);
        }
        $storageRoot = realpath(dirname(__DIR__) . '/uploads/messages');
        $filePath = realpath(dirname(__DIR__) . '/' . $relativePath);
        if (!$storageRoot || !$filePath || !is_file($filePath)
            || !str_starts_with($filePath, $storageRoot . DIRECTORY_SEPARATOR)) {
            jsonResponse(['ok' => false, 'error' => 'Attachment file is unavailable.'], 404);
        }
        $mime = function_exists('mime_content_type')
            ? (mime_content_type($filePath) ?: 'application/octet-stream')
            : 'application/octet-stream';
        $filename = preg_replace('/[^A-Za-z0-9._ -]/', '_', basename((string)($message['attachment_name'] ?? 'Attachment'))) ?: 'Attachment';
        $inline = in_array(strtolower($mime), ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'], true);
        header('Content-Type: ' . $mime);
        header('Content-Length: ' . (string)filesize($filePath));
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: private, no-store');
        header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . '; filename="' . addcslashes($filename, '"\\') . '"');
        readfile($filePath);
        exit;
    }

    if (preg_match('#^/admin/messages/([^/]+)$#', $apiPath, $messageMatch) && $method === 'DELETE') {
        $actor = mongoRouteRequireAdminCapability($adminSession, 'chat');
        $messageId = rawurldecode($messageMatch[1]);
        $message = mongoFindOne('messages', mongoSupportIdFilter($messageId));
        if (!$message) jsonResponse(['ok' => false, 'error' => 'Message not found.'], 404);
        mongoRouteRequireVisibleClient($actor, (string)$message['user_id']);
        getMongoCollection(mongoCollectionName('messages'))->deleteOne([
            ...mongoSupportMessageWriteFilter($message),
            'user_id' => $message['user_id'],
        ]);
        jsonResponse(['ok' => true]);
    }

    return;
}

// -----------------------------------------------------------------------------
// 7. ADMIN <-> CLIENT SUPPORT CHAT
// -----------------------------------------------------------------------------
if ($apiPath === '/admin/messages/unread_counts') {
    $actor = requireAdminCapability($pdo, $adminSession, 'chat');
    $scope = buildAdminClientscope($actor['role'], $actor['office_id'], $actor['team_id'], $actor['id']);
    [$scopeSql, $scopeParams] = $scope;
    $scopeClause = $scopeSql !== '' ? " AND ({$scopeSql})" : '';
    $stmt = $pdo->prepare("SELECT m.user_id, COUNT(*) AS unread_count
        FROM messages m INNER JOIN clients l ON l.id = m.user_id
        WHERE m.sender = 'client' AND m.is_read = 0 AND l.deleted_at IS NULL{$scopeClause}
        GROUP BY m.user_id");
    $stmt->execute($scopeParams);
    $counts = [];
    $total = 0;
    foreach ($stmt->fetchAll() as $row) {
        $counts[$row['user_id']] = (int)$row['unread_count'];
        $total += (int)$row['unread_count'];
    }
    jsonResponse(['ok' => true, 'counts' => $counts, 'total' => $total]);
}

if ($apiPath === '/admin/presence' && $method === 'POST') {
    $actor = requireActiveAdminStaff($pdo, $adminSession);
    $stmt = $pdo->prepare('UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ? AND user_id = ?');
    $now = date('c');
    $stmt->execute([$now, $adminSession['token_hash'], $actor['id']]);
    jsonResponse(['ok' => true, 'staff_id' => $actor['id'], 'last_seen_at' => $now]);
}

if ($apiPath === '/admin/messages/presence' || $apiPath === '/portal/messages/presence') {
    $isAdminPresence = $apiPath === '/admin/messages/presence';
    $clientId = $isAdminPresence
        ? trim((string)($_GET['user_id'] ?? $input['user_id'] ?? ''))
        : (string)$portalSession['id'];
    if ($isAdminPresence) {
        $actor = requireAdminCapability($pdo, $adminSession, 'chat');
        if ($clientId === '') jsonResponse(['ok' => false, 'error' => 'user_id is required.'], 400);
        requireVisibleClient($pdo, $actor, $clientId);
        $actorType = 'staff';
        $actorId = $actor['id'];
    } else {
        $actorType = 'client';
        $actorId = $clientId;
    }

    if ($method === 'POST') {
        $typing = $isAdminPresence
            ? !empty($input['is_typing'])
            : !empty($input['is_typing']);
        $now = date('c');
        $exists = $pdo->prepare('SELECT 1 FROM crm_message_presence WHERE client_id = ? AND actor_type = ? AND actor_id = ?');
        $exists->execute([$clientId, $actorType, $actorId]);
        if ($exists->fetchColumn()) {
            $pdo->prepare('UPDATE crm_message_presence SET is_typing = ?, last_seen_at = ? WHERE client_id = ? AND actor_type = ? AND actor_id = ?')
                ->execute([$typing ? 1 : 0, $now, $clientId, $actorType, $actorId]);
        } else {
            $pdo->prepare('INSERT INTO crm_message_presence (client_id, actor_type, actor_id, is_typing, last_seen_at) VALUES (?, ?, ?, ?, ?)')
                ->execute([$clientId, $actorType, $actorId, $typing ? 1 : 0, $now]);
        }
        jsonResponse(['ok' => true, 'last_seen_at' => $now]);
    }

    if ($method !== 'GET') jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    $cutoff = date('c', time() - 15);
    $presenceStmt = $pdo->prepare('SELECT actor_type, actor_id, is_typing, last_seen_at FROM crm_message_presence WHERE client_id = ? AND last_seen_at >= ?');
    $presenceStmt->execute([$clientId, $cutoff]);
    $presence = ['client_typing' => false, 'staff_typing' => false, 'staff_online' => false];
    foreach ($presenceStmt->fetchAll() as $row) {
        if ($row['actor_type'] === 'client' && (int)$row['is_typing'] === 1) $presence['client_typing'] = true;
        if ($row['actor_type'] === 'staff') {
            $presence['staff_online'] = true;
            if ((int)$row['is_typing'] === 1) $presence['staff_typing'] = true;
        }
    }
    jsonResponse(['ok' => true, 'presence' => $presence]);
}

if (($apiPath === '/admin/messages' || $apiPath === '/client/messages')
    && in_array($method, ['GET', 'POST'], true)) {
    $isClientMessageRoute = $apiPath === '/client/messages';
    $actor = $isClientMessageRoute ? null : requireAdminCapability($pdo, $adminSession, 'chat');
    if ($method === 'POST') {
        $userId = $isClientMessageRoute ? $portalSession['id'] : trim($input['user_id'] ?? $input['userId'] ?? '');
        $body = trim($input['body'] ?? $input['text'] ?? '');
        $sender = $isClientMessageRoute ? 'client' : 'agent';
        $senderName = $isClientMessageRoute ? (string)($portalSession['name'] ?? 'Client') : (string)($actor['name'] ?? 'Support Agent');
        $senderId = $isClientMessageRoute ? (string)$portalSession['id'] : (string)$actor['id'];

        if (!$userId || !$body) {
            jsonResponse(['ok' => false, 'error' => 'user_id and body required'], 400);
        }
        if (strlen($body) > 5000) jsonResponse(['ok' => false, 'error' => 'Messages cannot exceed 5,000 characters.'], 422);
        $client = null;
        if (!$isClientMessageRoute) {
            $client = requireVisibleClient($pdo, $actor, $userId);
        }

        $msgId = 'msg_' . bin2hex(random_bytes(12));
        $now = date('c');
        $stmt = $pdo->prepare("
            INSERT INTO messages (id, user_id, sender, sender_id, sender_name, body, is_read, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?)
        ");
        $stmt->execute([$msgId, $userId, $sender, $senderId, $senderName, $body, $now]);

        $action = $sender === 'client' ? 'SUPPORT_MESSAGE_RECEIVED' : 'SUPPORT_MESSAGE_SENT';
        $details = $sender === 'client' ? 'Client sent a support message.' : 'Staff sent a support message.';
        $auditId = 'aud_' . bin2hex(random_bytes(8));
        $pdo->prepare("INSERT INTO audit_logs (id, user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)")
            ->execute([$auditId, $userId, $action, $details, $now]);

        if ($isClientMessageRoute) {
            $clientstmt = $pdo->prepare('SELECT assigned_agent_id, assigned_team_leader_id, assigned_office_id FROM clients WHERE id = ? AND deleted_at IS NULL');
            $clientstmt->execute([$userId]);
            $client = $clientstmt->fetch() ?: null;
            $recipientIds = array_values(array_unique(array_filter([
                $client['assigned_agent_id'] ?? null,
                $client['assigned_team_leader_id'] ?? null,
            ])));
            if (!$recipientIds && !empty($client['assigned_office_id'])) {
                $managerStmt = $pdo->prepare("SELECT id FROM staff_users WHERE office_id = ? AND role = 'Office Manager' AND status = 'Active' AND deleted_at IS NULL");
                $managerStmt->execute([$client['assigned_office_id']]);
                $recipientIds = $managerStmt->fetchAll(PDO::FETCH_COLUMN);
            }
            foreach ($recipientIds as $recipientId) {
                $activeStmt = $pdo->prepare("SELECT id FROM staff_users WHERE id = ? AND status = 'Active' AND deleted_at IS NULL");
                $activeStmt->execute([$recipientId]);
                if ($activeStmt->fetchColumn()) {
                    createAdminNotification($pdo, (string)$recipientId, 'client_message', 'New client message', substr($body, 0, 240));
                }
            }
        }

        jsonResponse([
            'ok' => true,
            'message' => [
                'id' => $msgId,
                'user_id' => $userId,
                'sender' => $sender,
                'sender_id' => $senderId,
                'sender_name' => $senderName,
                'body' => $body,
                'created_at' => $now,
                'edited_at' => null,
                'agent_id' => $isClientMessageRoute ? null : $actor['id'],
            ]
        ]);
    }

    $userId = $isClientMessageRoute ? $portalSession['id'] : trim($_GET['user_id'] ?? '');
    if (!$userId) {
        jsonResponse(['ok' => true, 'messages' => [], 'unread_count' => 0]);
    }
    if (!$isClientMessageRoute) {
        $client = requireVisibleClient($pdo, $actor, $userId);
    }
    $limit = max(1, min(200, (int)($_GET['limit'] ?? 100)));
    $before = trim((string)($_GET['before'] ?? ''));
    $where = 'user_id = ?';
    $params = [$userId];
    if ($before !== '') {
        $where .= ' AND created_at < ?';
        $params[] = $before;
    }
    $params[] = $limit + 1;
    $stmt = $pdo->prepare("SELECT * FROM messages WHERE {$where} ORDER BY created_at DESC LIMIT ?");
    $stmt->execute($params);
    $msgs = $stmt->fetchAll();
    $hasMore = count($msgs) > $limit;
    if ($hasMore) array_pop($msgs);
    $msgs = array_reverse($msgs);
    $unreadQuery = $pdo->prepare("SELECT COUNT(*) FROM messages WHERE user_id = ? AND sender = ? AND is_read = 0");
    $unreadQuery->execute([$userId, $isClientMessageRoute ? 'agent' : 'client']);
    $unreadCount = (int)$unreadQuery->fetchColumn();

    jsonResponse([
        'ok' => true,
        'user' => $isClientMessageRoute
            ? ['id' => $userId]
            : ['id' => $userId, 'name' => $client['name'] ?? '', 'email' => $client['email'] ?? '', 'company' => $client['company'] ?? ''],
        'messages' => $msgs,
        'unread_count' => $unreadCount,
        'has_more' => $hasMore,
    ]);
}

if ($apiPath === '/client/messages' && $method === 'DELETE') {
    $clientId = (string)$portalSession['id'];
    $stmt = $pdo->prepare('DELETE FROM messages WHERE user_id = ?');
    $stmt->execute([$clientId]);
    $pdo->prepare('DELETE FROM crm_message_presence WHERE client_id = ?')->execute([$clientId]);
    jsonResponse(['ok' => true, 'deleted' => $stmt->rowCount()]);
}

if (preg_match('#^/(admin|client)/messages/([^/]+)$#', $apiPath, $editMatch) && $method === 'PATCH') {
    $isClient = $editMatch[1] === 'client';
    $messageId = rawurldecode($editMatch[2]);
    $messageStmt = $pdo->prepare('SELECT * FROM messages WHERE id = ? LIMIT 1');
    $messageStmt->execute([$messageId]);
    $message = $messageStmt->fetch();
    if (!$message) jsonResponse(['ok' => false, 'error' => 'Message not found.'], 404);

    if ($isClient) {
        $actorId = (string)$portalSession['id'];
        if ($message['user_id'] !== $actorId || $message['sender'] !== 'client' || (string)($message['sender_id'] ?? '') !== $actorId) {
            jsonResponse(['ok' => false, 'error' => 'You can only edit your own messages.'], 403);
        }
    } else {
        $actor = requireAdminCapability($pdo, $adminSession, 'chat');
        requireVisibleClient($pdo, $actor, (string)$message['user_id']);
        $isSuperAdmin = $actor['role'] === 'Super Admin';
        if ($message['sender'] !== 'agent' || (!$isSuperAdmin && (string)($message['sender_id'] ?? '') !== (string)$actor['id'])) {
            jsonResponse(['ok' => false, 'error' => 'You can only edit your own staff messages.'], 403);
        }
        $actorId = (string)$actor['id'];
    }

    $createdAt = strtotime((string)$message['created_at']);
    if ($createdAt === false || $createdAt < time() - 420) {
        jsonResponse(['ok' => false, 'error' => 'Messages can only be edited within seven minutes of sending.'], 422);
    }
    $body = trim((string)($input['body'] ?? ''));
    if ($body === '' || strlen($body) > 5000) {
        jsonResponse(['ok' => false, 'error' => 'Enter a message of 1 to 5,000 characters.'], 422);
    }
    $editedAt = date('c');
    $pdo->prepare('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?')->execute([$body, $editedAt, $messageId]);
    jsonResponse(['ok' => true, 'message' => [
        'id' => $messageId,
        'user_id' => (string)$message['user_id'],
        'sender' => (string)$message['sender'],
        'sender_id' => (string)($message['sender_id'] ?? $actorId),
        'sender_name' => (string)($message['sender_name'] ?? ''),
        'body' => $body,
        'created_at' => (string)$message['created_at'],
        'edited_at' => $editedAt,
    ]]);
}

if ($apiPath === '/admin/messages/read' && $method === 'POST') {
    $actor = requireAdminCapability($pdo, $adminSession, 'chat');
    $userId = trim($input['user_id'] ?? '');
    if (!$userId) jsonResponse(['ok' => false, 'error' => 'user_id is required.'], 400);
    requireVisibleClient($pdo, $actor, $userId);
    $stmt = $pdo->prepare("UPDATE messages SET is_read = 1 WHERE user_id = ? AND sender = 'client' AND is_read = 0");
    $stmt->execute([$userId]);
    jsonResponse(['ok' => true, 'marked' => $stmt->rowCount()]);
}

if (($apiPath === '/admin/messages/clear' && $method === 'POST')
    || ($apiPath === '/admin/messages' && $method === 'DELETE')) {
    $actor = requireAdminCapability($pdo, $adminSession, 'chat');
    $userId = trim((string)($_GET['user_id'] ?? $input['user_id'] ?? ''));
    if (!$userId) jsonResponse(['ok' => false, 'error' => 'user_id is required.'], 400);
    requireVisibleClient($pdo, $actor, $userId);
    $stmt = $pdo->prepare('DELETE FROM messages WHERE user_id = ?');
    $stmt->execute([$userId]);
    jsonResponse(['ok' => true, 'deleted' => $stmt->rowCount()]);
}

if (preg_match('#^/admin/messages/([^/]+)/attachment$#', $apiPath, $attachmentMatch) && $method === 'GET') {
    $actor = requireAdminCapability($pdo, $adminSession, 'chat');
    $messageStmt = $pdo->prepare('SELECT * FROM messages WHERE id = ?');
    $messageStmt->execute([rawurldecode($attachmentMatch[1])]);
    $message = $messageStmt->fetch();
    if (!$message || empty($message['attachment_path'])) jsonResponse(['ok' => false, 'error' => 'Attachment not found.'], 404);
    requireVisibleClient($pdo, $actor, (string)$message['user_id']);

    $relativePath = str_replace('\\', '/', (string)$message['attachment_path']);
    $relativePath = ltrim($relativePath, '/');
    if (!str_starts_with($relativePath, 'uploads/messages/')) {
        jsonResponse(['ok' => false, 'error' => 'Attachment path is not valid.'], 404);
    }
    $storageRoot = realpath(dirname(__DIR__) . '/uploads/messages');
    $filePath = realpath(dirname(__DIR__) . '/' . $relativePath);
    if (!$storageRoot || !$filePath || !is_file($filePath) || !str_starts_with($filePath, $storageRoot . DIRECTORY_SEPARATOR)) {
        jsonResponse(['ok' => false, 'error' => 'Attachment file is unavailable.'], 404);
    }
    $mime = function_exists('mime_content_type') ? (mime_content_type($filePath) ?: 'application/octet-stream') : 'application/octet-stream';
    $filename = preg_replace('/[^A-Za-z0-9._ -]/', '_', basename((string)($message['attachment_name'] ?? 'Attachment'))) ?: 'Attachment';
    $inline = in_array(strtolower($mime), ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'], true);
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . (string)filesize($filePath));
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, no-store');
    header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . '; filename="' . addcslashes($filename, '"\\') . '"');
    readfile($filePath);
    exit;
}

if (preg_match('#^/admin/messages/([^/]+)$#', $apiPath, $messageMatch) && $method === 'DELETE') {
    $actor = requireAdminCapability($pdo, $adminSession, 'chat');
    $messageStmt = $pdo->prepare('SELECT id, user_id FROM messages WHERE id = ?');
    $messageStmt->execute([rawurldecode($messageMatch[1])]);
    $message = $messageStmt->fetch();
    if (!$message) jsonResponse(['ok' => false, 'error' => 'Message not found.'], 404);
    requireVisibleClient($pdo, $actor, (string)$message['user_id']);
    $pdo->prepare('DELETE FROM messages WHERE id = ?')->execute([$message['id']]);
    jsonResponse(['ok' => true]);
}
