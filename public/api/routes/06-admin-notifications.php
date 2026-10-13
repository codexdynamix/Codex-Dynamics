<?php
/** Route group: ADMIN: NOTIFICATIONS (Send to client or all clients, Sent Log) (included by index.php in order; uses its request globals). */

declare(strict_types=1);

function mongoRouteCleanRow(array $row): array {
    unset($row['_id'], $row['_migration_source']);
    return $row;
}

function mongoRouteCleanRows(array $rows): array {
    return array_map('mongoRouteCleanRow', $rows);
}

function mongoRouteAdminActor(?array $session): array {
    if (!$session || !isset($session['id'])) {
        jsonResponse(['ok' => false, 'error' => 'Authentication required.'], 401);
    }
    $staff = mongoFindOne('staff_users', ['id' => $session['id'], 'deleted_at' => null]);
    if (!$staff || ($staff['status'] ?? null) !== 'Active') {
        jsonResponse(['ok' => false, 'error' => 'Administrator account is unavailable.'], 401);
    }
    $capabilities = $staff['capabilities'] ?? [];
    if (is_string($capabilities)) {
        $decoded = json_decode($capabilities, true);
        $capabilities = is_array($decoded) ? $decoded : [];
    }
    $staff['capabilities'] = is_array($capabilities) ? $capabilities : [];
    return $staff;
}

function mongoRouteRequireAdminCapability(?array $session, string $capability): array {
    $actor = mongoRouteAdminActor($session);
    if ($actor['role'] !== 'Super Admin' && ($actor['capabilities'][$capability] ?? true) === false) {
        jsonResponse(['ok' => false, 'error' => 'This CRM tool is not enabled for your account.'], 403);
    }
    return $actor;
}

function mongoRouteRequireSuperAdmin(?array $session): array {
    $actor = mongoRouteAdminActor($session);
    if ($actor['role'] !== 'Super Admin') {
        jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can perform this action.'], 403);
    }
    return $actor;
}

function mongoRouteActorCanViewClient(array $actor, array $client): bool {
    if (($actor['role'] ?? null) === 'Super Admin') return true;
    if (($actor['role'] ?? null) === 'Office Manager') {
        return !empty($client['assigned_office_id'])
            && ($client['assigned_office_id'] ?? null) === ($actor['office_id'] ?? null);
    }
    if (($actor['role'] ?? null) === 'Team Leader') {
        return (!empty($actor['team_id']) && ($client['assigned_team_id'] ?? null) === $actor['team_id'])
            || ($client['assigned_team_leader_id'] ?? null) === ($actor['id'] ?? null);
    }
    if (($actor['role'] ?? null) === 'Agent') {
        return ($client['assigned_agent_id'] ?? null) === ($actor['id'] ?? null);
    }
    return false;
}

function mongoRouteRequireVisibleClient(array $actor, string $clientId): array {
    $client = mongoFindOne('clients', ['id' => $clientId, 'deleted_at' => null]);
    if (!$client) jsonResponse(['ok' => false, 'error' => 'Client record not found.'], 404);
    if (!mongoRouteActorCanViewClient($actor, $client)) {
        jsonResponse(['ok' => false, 'error' => 'You cannot access this client record.'], 403);
    }
    return $client;
}

function mongoRouteDecodeCapabilities(mixed $value): array {
    if (is_string($value)) {
        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : [];
    }
    return is_array($value) ? $value : [];
}

function mongoRouteCount(string $table, array $filter): int {
    return getMongoCollection(mongoCollectionName($table))->countDocuments($filter);
}

// MongoDB mode handles only operations whose existing SQL semantics can be
// preserved without pretending a multi-document operation is transactional.
if (isMongoStorageEnabled()) {
    if (in_array($apiPath, ['/client/notifications', '/portal/notifications'], true)) {
        if (!$portalSession || empty($portalSession['id'])) {
            jsonResponse(['ok' => false, 'error' => 'Client sign-in required.'], 401);
        }
        $clientId = $portalSession['id'];
        if ($method === 'POST') {
            $now = date('c');
            $action = $input['action'] ?? '';
            if ($action === 'mark_all_read') {
                $rows = mongoFindMany('notifications', [
                    '$or' => [
                        ['user_id' => $clientId],
                        ['user_id' => null],
                        ['user_id' => ''],
                    ],
                ], ['projection' => ['id' => 1]]);
                mongoWithTransaction(static function ($session) use ($rows, $clientId, $now): void {
                    $collection = getMongoCollection(mongoCollectionName('user_notification_reads'));
                    foreach ($rows as $row) {
                        if (!isset($row['id'])) continue;
                        $collection->updateOne(
                            ['user_id' => $clientId, 'notification_id' => $row['id']],
                            ['$set' => ['read_at' => $now]],
                            ['upsert' => true, 'session' => $session],
                        );
                    }
                });
            } elseif (!empty($input['id'])) {
                $notificationId = trim((string)$input['id']);
                getMongoCollection(mongoCollectionName('user_notification_reads'))->updateOne(
                    ['user_id' => $clientId, 'notification_id' => $notificationId],
                    ['$set' => ['read_at' => $now]],
                    ['upsert' => true],
                );
            } else {
                jsonResponse(['ok' => false, 'error' => 'Notification action is required.'], 400);
            }
            jsonResponse(['ok' => true]);
        }
        if ($method !== 'GET') {
            jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
        }
        $rows = mongoFindMany('notifications', [
            '$or' => [
                ['user_id' => $clientId],
                ['user_id' => null],
                ['user_id' => ''],
            ],
        ], ['sort' => ['created_at' => -1], 'limit' => 100]);
        $readRows = mongoFindMany('user_notification_reads', ['user_id' => $clientId]);
        $readsById = [];
        foreach ($readRows as $readRow) $readsById[(string)($readRow['notification_id'] ?? '')] = true;
        $notifications = [];
        foreach ($rows as $row) {
            $notification = mongoRouteCleanRow($row);
            $notification['is_read'] = isset($readsById[(string)($row['id'] ?? '')])
                ? 1
                : (int)($row['is_read'] ?? 0);
            $notifications[] = $notification;
        }
        jsonResponse(['ok' => true, 'notifications' => $notifications, 'total' => count($notifications)]);
    }

    if ($apiPath === '/admin/notifications/read-all' && $method === 'POST') {
        $actor = mongoRouteRequireAdminCapability($adminSession, 'notifications');
        $updated = getMongoCollection(mongoCollectionName('admin_notifications'))->updateMany(
            ['staff_user_id' => $actor['id'], 'read_at' => null],
            ['$set' => ['read_at' => date('c')]],
        );
        jsonResponse(['ok' => true, 'updated' => $updated->getMatchedCount()]);
    }

    if ($apiPath === '/admin/notifications/clear' && $method === 'DELETE') {
        $actor = mongoRouteRequireAdminCapability($adminSession, 'notifications');
        $deleted = mongoDelete('admin_notifications', ['staff_user_id' => $actor['id']]);
        jsonResponse(['ok' => true, 'deleted' => $deleted]);
    }

    if ($apiPath === '/admin/notifications/send' && $method === 'POST') {
        $actor = mongoRouteRequireAdminCapability($adminSession, 'notifications');
        $userId = $input['user_id'] ?? null;
        $message = trim((string)($input['message'] ?? ''));
        $kind = $input['kind'] ?? 'info';
        $title = trim((string)($input['title'] ?? 'Administrator Notice'));
        $type = trim((string)($input['type'] ?? 'project'));
        if ($userId) {
            $userId = trim((string)$userId);
            mongoRouteRequireVisibleClient($actor, $userId);
        } elseif ($actor['role'] !== 'Super Admin') {
            jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can send a notice to all clients.'], 403);
        }
        if ($message === '') {
            jsonResponse(['ok' => false, 'error' => 'Notification message required'], 400);
        }
        $id = 'notif_' . time() . '_' . substr(bin2hex(random_bytes(2)), 0, 4);
        mongoInsert('notifications', [
            'id' => $id,
            'user_id' => $userId,
            'title' => $title,
            'description' => $message,
            'kind' => $kind,
            'type' => $type,
            'is_read' => 0,
            'link' => '/portal/notifications',
            'sent_by' => $actor['id'],
            'created_at' => date('c'),
        ]);
        jsonResponse(['ok' => true, 'id' => $id, 'sent' => 1]);
    }

    if ($apiPath === '/admin/notifications' && $method === 'GET') {
        $actor = mongoRouteRequireAdminCapability($adminSession, 'notifications');
        $limit = max(1, min(100, (int)($_GET['limit'] ?? 50)));
        $onlyUnread = filter_var($_GET['only_unread'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $filter = ['staff_user_id' => $actor['id']];
        if ($onlyUnread) $filter['read_at'] = null;
        $total = mongoRouteCount('admin_notifications', $filter);
        $rows = mongoFindMany('admin_notifications', $filter, ['sort' => ['created_at' => -1], 'limit' => $limit]);
        $rows = array_map(static function (array $row): array {
            return [
                'id' => $row['id'] ?? null,
                'kind' => $row['kind'] ?? null,
                'title' => $row['title'] ?? null,
                'body' => $row['body'] ?? null,
                'read_at' => $row['read_at'] ?? null,
                'created_at' => $row['created_at'] ?? null,
            ];
        }, $rows);
        jsonResponse([
            'ok' => true,
            'notifications' => $rows,
            'unread_count' => mongoRouteCount('admin_notifications', ['staff_user_id' => $actor['id'], 'read_at' => null]),
            'has_more' => $total > count($rows),
        ]);
    }

    if (preg_match('#^/admin/notifications/([^/]+)(?:/(read))?$#', $apiPath, $mongoNotificationMatch)
        && !in_array($mongoNotificationMatch[1], ['read-all', 'clear', 'sent-log', 'send'], true)) {
        $actor = mongoRouteRequireAdminCapability($adminSession, 'notifications');
        $notificationId = rawurldecode($mongoNotificationMatch[1]);
        $action = $mongoNotificationMatch[2] ?? '';
        if ($action === 'read' && $method === 'POST') {
            $result = getMongoCollection(mongoCollectionName('admin_notifications'))->updateOne(
                ['id' => $notificationId, 'staff_user_id' => $actor['id']],
                ['$set' => ['read_at' => date('c')]],
            );
            if ($result->getMatchedCount() === 0) {
                jsonResponse(['ok' => false, 'error' => 'Notification not found.'], 404);
            }
            jsonResponse(['ok' => true]);
        }
        if ($action === '' && $method === 'DELETE') {
            $deleted = mongoDelete('admin_notifications', ['id' => $notificationId, 'staff_user_id' => $actor['id']]);
            if ($deleted === 0) jsonResponse(['ok' => false, 'error' => 'Notification not found.'], 404);
            jsonResponse(['ok' => true]);
        }
    }

    if (preg_match('#^/admin/users/([^/]+)/notifications(?:/(clear|delete))?$#', $apiPath, $mongoUserNotificationMatch)) {
        $actor = mongoRouteRequireAdminCapability($adminSession, 'notifications');
        $clientId = rawurldecode($mongoUserNotificationMatch[1]);
        mongoRouteRequireVisibleClient($actor, $clientId);
        $action = $mongoUserNotificationMatch[2] ?? '';
        if ($action === 'delete' && $method === 'POST') {
            $ids = array_values(array_unique(array_filter(array_map(
                static fn($id) => trim((string)$id),
                is_array($input['ids'] ?? null) ? $input['ids'] : [],
            ))));
            if (count($ids) === 0 || count($ids) > 500) {
                jsonResponse(['ok' => false, 'error' => 'Select between 1 and 500 notifications.'], 400);
            }
            $deleted = mongoDelete('notifications', ['user_id' => $clientId, 'id' => ['$in' => $ids]]);
            jsonResponse(['ok' => true, 'deleted' => $deleted]);
        }
        if ($action === 'clear' && $method === 'DELETE') {
            mongoRouteRequireSuperAdmin($adminSession);
            $deleted = mongoWithTransaction(static function ($session) use ($clientId): int {
                $notifications = getMongoCollection(mongoCollectionName('notifications'));
                $reads = getMongoCollection(mongoCollectionName('user_notification_reads'));
                $deletedCount = $notifications->deleteMany(
                    ['user_id' => $clientId],
                    ['session' => $session],
                )->getDeletedCount();
                $reads->deleteMany(['user_id' => $clientId], ['session' => $session]);
                return $deletedCount;
            });
            jsonResponse(['ok' => true, 'deleted' => $deleted]);
        }
        if ($action !== '' || $method !== 'GET') {
            jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
        }
        $rows = mongoFindMany('notifications', [
            '$or' => [
                ['user_id' => $clientId],
                ['user_id' => null],
                ['user_id' => ''],
            ],
        ], ['sort' => ['created_at' => -1], 'limit' => 200]);
        $readRows = mongoFindMany('user_notification_reads', ['user_id' => $clientId]);
        $readsById = [];
        foreach ($readRows as $readRow) $readsById[(string)($readRow['notification_id'] ?? '')] = $readRow;
        $notifications = [];
        foreach ($rows as $row) {
            $read = $readsById[(string)($row['id'] ?? '')] ?? null;
            $notifications[] = [
                'id' => $row['id'] ?? null,
                'user_id' => $row['user_id'] ?? null,
                'title' => $row['title'] ?? null,
                'description' => $row['description'] ?? null,
                'message' => $row['description'] ?? null,
                'kind' => $row['kind'] ?? null,
                'type' => $row['type'] ?? null,
                'link' => $row['link'] ?? null,
                'sent_by' => $row['sent_by'] ?? null,
                'created_at' => $row['created_at'] ?? null,
                'read_at' => $read['read_at'] ?? null,
                'is_read' => $read ? 1 : (int)($row['is_read'] ?? 0),
                'is_broadcast' => empty($row['user_id']) ? 1 : 0,
            ];
        }
        jsonResponse(['ok' => true, 'notifications' => $notifications, 'total' => count($notifications)]);
    }

    if ($apiPath === '/admin/notifications/sent-log') {
        $actor = mongoRouteRequireAdminCapability($adminSession, 'notifications');
        if ($method === 'DELETE') {
            if ($actor['role'] !== 'Super Admin') {
                jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can clear the sent log.'], 403);
            }
            mongoDelete('notifications', []);
            jsonResponse(['ok' => true]);
        }
        if ($method !== 'GET') {
            jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
        }
        $limit = max(1, min(100, (int)($_GET['limit'] ?? 50)));
        $offset = max(0, (int)($_GET['offset'] ?? 0));
        $filter = $actor['role'] === 'Super Admin' ? [] : ['sent_by' => $actor['id']];
        $total = mongoRouteCount('notifications', $filter);
        $rows = mongoFindMany('notifications', $filter, [
            'sort' => ['created_at' => -1],
            'skip' => $offset,
            'limit' => $limit,
        ]);
        $logs = [];
        foreach ($rows as $row) {
            $clientId = $row['user_id'] ?? null;
            $client = $clientId ? mongoFindOne('clients', ['id' => $clientId]) : null;
            $sender = mongoFindOne('staff_users', ['id' => $row['sent_by'] ?? null]);
            $broadcast = empty($clientId);
            $logs[] = [
                'id' => $row['id'] ?? null,
                'user_id' => $clientId,
                'title' => $row['title'] ?? null,
                'description' => $row['description'] ?? null,
                'message' => $row['description'] ?? null,
                'kind' => $row['kind'] ?? null,
                'type' => $row['type'] ?? null,
                'link' => $row['link'] ?? null,
                'sent_by' => $row['sent_by'] ?? null,
                'created_at' => $row['created_at'] ?? null,
                'recalled_at' => null,
                'user_name' => $broadcast ? 'All clients' : ($client['name'] ?? $client['email'] ?? 'All clients'),
                'user_email' => $client['email'] ?? null,
                'admin_name' => $sender['name'] ?? ($row['sent_by'] ?? null),
                'is_broadcast' => $broadcast ? 1 : 0,
                'recipient_count' => $broadcast ? mongoRouteCount('clients', ['deleted_at' => null]) : 1,
            ];
        }
        jsonResponse([
            'ok' => true,
            'notifications' => $logs,
            'log' => $logs,
            'total' => $total,
            'limit' => $limit,
            'offset' => $offset,
            'has_more' => $offset + count($logs) < $total,
        ]);
    }

    if (preg_match('#^/admin/notifications/sent-log/([^/]+)$#', $apiPath, $mongoSentMatch)
        && $method === 'DELETE') {
        $actor = mongoRouteRequireAdminCapability($adminSession, 'notifications');
        if ($actor['role'] !== 'Super Admin') {
            jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can delete sent-log records.'], 403);
        }
        $deleted = mongoDelete('notifications', ['id' => rawurldecode($mongoSentMatch[1])]);
        jsonResponse(['ok' => true, 'deleted' => $deleted]);
    }
}

// -----------------------------------------------------------------------------
// 6. ADMIN: NOTIFICATIONS (Send to client or all clients, Sent Log)
// -----------------------------------------------------------------------------

if ($apiPath === '/admin/notifications') {
    $actor = requireAdminCapability($pdo, $adminSession, 'notifications');
    if ($method !== 'GET') jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    $limit = max(1, min(100, (int)($_GET['limit'] ?? 50)));
    $onlyUnread = filter_var($_GET['only_unread'] ?? false, FILTER_VALIDATE_BOOLEAN);
    $where = 'staff_user_id = ?' . ($onlyUnread ? ' AND read_at IS NULL' : '');
    $count = $pdo->prepare("SELECT COUNT(*) FROM admin_notifications WHERE {$where}");
    $count->execute([$actor['id']]);
    $total = (int)$count->fetchColumn();
    $stmt = $pdo->prepare("SELECT id, kind, title, body, read_at, created_at
        FROM admin_notifications WHERE {$where} ORDER BY created_at DESC LIMIT ?");
    $stmt->bindValue(1, $actor['id']);
    if ($onlyUnread) {
        $stmt->bindValue(2, $limit, PDO::PARAM_INT);
    } else {
        $stmt->bindValue(2, $limit, PDO::PARAM_INT);
    }
    $stmt->execute();
    $rows = $stmt->fetchAll();
    $unread = $pdo->prepare('SELECT COUNT(*) FROM admin_notifications WHERE staff_user_id = ? AND read_at IS NULL');
    $unread->execute([$actor['id']]);
    jsonResponse([
        'ok' => true,
        'notifications' => $rows,
        'unread_count' => (int)$unread->fetchColumn(),
        'has_more' => $total > count($rows),
    ]);
}

if ($apiPath === '/admin/notifications/read-all' && $method === 'POST') {
    $actor = requireAdminCapability($pdo, $adminSession, 'notifications');
    $stmt = $pdo->prepare('UPDATE admin_notifications SET read_at = ? WHERE staff_user_id = ? AND read_at IS NULL');
    $stmt->execute([date('c'), $actor['id']]);
    jsonResponse(['ok' => true, 'updated' => $stmt->rowCount()]);
}

if ($apiPath === '/admin/notifications/clear' && $method === 'DELETE') {
    $actor = requireAdminCapability($pdo, $adminSession, 'notifications');
    $stmt = $pdo->prepare('DELETE FROM admin_notifications WHERE staff_user_id = ?');
    $stmt->execute([$actor['id']]);
    jsonResponse(['ok' => true, 'deleted' => $stmt->rowCount()]);
}

if (preg_match('#^/admin/notifications/([^/]+)(?:/(read))?$#', $apiPath, $notificationMatch)) {
    $actor = requireAdminCapability($pdo, $adminSession, 'notifications');
    $notificationId = rawurldecode($notificationMatch[1]);
    if (($notificationMatch[2] ?? '') === 'read' && $method === 'POST') {
        $stmt = $pdo->prepare('UPDATE admin_notifications SET read_at = ? WHERE id = ? AND staff_user_id = ?');
        $stmt->execute([date('c'), $notificationId, $actor['id']]);
        if ($stmt->rowCount() === 0) {
            $exists = $pdo->prepare('SELECT id FROM admin_notifications WHERE id = ? AND staff_user_id = ?');
            $exists->execute([$notificationId, $actor['id']]);
            if (!$exists->fetchColumn()) jsonResponse(['ok' => false, 'error' => 'Notification not found.'], 404);
        }
        jsonResponse(['ok' => true]);
    }
    if (($notificationMatch[2] ?? '') === '' && $method === 'DELETE') {
        $stmt = $pdo->prepare('DELETE FROM admin_notifications WHERE id = ? AND staff_user_id = ?');
        $stmt->execute([$notificationId, $actor['id']]);
        if ($stmt->rowCount() === 0) jsonResponse(['ok' => false, 'error' => 'Notification not found.'], 404);
        jsonResponse(['ok' => true]);
    }
}

if (preg_match('#^/admin/users/([^/]+)/notifications(?:/(clear|delete))?$#', $apiPath, $userNotificationMatch)) {
    $actor = requireAdminCapability($pdo, $adminSession, 'notifications');
    $clientId = rawurldecode($userNotificationMatch[1]);
    $action = $userNotificationMatch[2] ?? '';
    requireVisibleClient($pdo, $actor, $clientId);
    if ($action === '' && $method === 'GET') {
        $stmt = $pdo->prepare("
            SELECT n.id, n.user_id, n.title, n.description, n.description AS message, n.kind, n.type, n.link, n.sent_by, n.created_at,
                   r.read_at,
                   CASE WHEN r.notification_id IS NOT NULL THEN 1 ELSE n.is_read END AS is_read,
                   CASE WHEN n.user_id IS NULL OR n.user_id = '' THEN 1 ELSE 0 END AS is_broadcast
            FROM notifications n
            LEFT JOIN user_notification_reads r ON r.notification_id = n.id AND r.user_id = ?
            WHERE n.user_id = ? OR n.user_id IS NULL OR n.user_id = ''
            ORDER BY n.created_at DESC LIMIT 200
        ");
        $stmt->execute([$clientId, $clientId]);
        $rows = $stmt->fetchAll();
        jsonResponse(['ok' => true, 'notifications' => $rows, 'total' => count($rows)]);
    }
    if ($action === 'delete' && $method === 'POST') {
        $ids = array_values(array_unique(array_filter(array_map(
            static fn($id) => trim((string)$id),
            is_array($input['ids'] ?? null) ? $input['ids'] : []
        ))));
        if (count($ids) === 0 || count($ids) > 500) jsonResponse(['ok' => false, 'error' => 'Select between 1 and 500 notifications.'], 400);
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $pdo->prepare("DELETE FROM notifications WHERE user_id = ? AND id IN ({$placeholders})");
        $stmt->execute(array_merge([$clientId], $ids));
        jsonResponse(['ok' => true, 'deleted' => $stmt->rowCount()]);
    }
    if ($action === 'clear' && $method === 'DELETE') {
        requireSuperAdmin($pdo, $adminSession);
        $stmt = $pdo->prepare('DELETE FROM notifications WHERE user_id = ?');
        $stmt->execute([$clientId]);
        $deleted = $stmt->rowCount();
        $pdo->prepare('DELETE FROM user_notification_reads WHERE user_id = ?')->execute([$clientId]);
        jsonResponse(['ok' => true, 'deleted' => $deleted]);
    }
    jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

if ($apiPath === '/admin/notifications/send') {
    $actor = requireAdminCapability($pdo, $adminSession, 'notifications');
    $userId = $input['user_id'] ?? null;
    $message = trim($input['message'] ?? '');
    $kind = $input['kind'] ?? 'info';
    $title = trim($input['title'] ?? 'Administrator Notice');
    $type = trim($input['type'] ?? 'project');
    $now = date('c');

    if ($userId) {
        $userId = trim((string)$userId);
        requireVisibleClient($pdo, $actor, $userId);
    } elseif ($actor['role'] !== 'Super Admin') {
        jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can send a notice to all clients.'], 403);
    }
    if (!$message) {
        jsonResponse(['ok' => false, 'error' => 'Notification message required'], 400);
    }

    $id = 'notif_' . time() . '_' . substr(bin2hex(random_bytes(2)), 0, 4);
    $stmt = $pdo->prepare("
        INSERT INTO notifications (id, user_id, title, description, kind, type, is_read, link, sent_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, '/portal/notifications', ?, ?)
    ");
    $stmt->execute([$id, $userId, $title, $message, $kind, $type, $actor['id'], $now]);

    jsonResponse(['ok' => true, 'id' => $id, 'sent' => 1]);
}

if ($apiPath === '/client/notifications' || $apiPath === '/portal/notifications') {
    $clientId = $portalSession['id'];
    if ($method === 'POST') {
        $now = date('c');
        if (($input['action'] ?? '') === 'mark_all_read') {
            $stmt = $pdo->prepare("SELECT id FROM notifications WHERE user_id = ? OR user_id IS NULL OR user_id = ''");
            $stmt->execute([$clientId]);
            foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $notificationId) {
                $update = $pdo->prepare("UPDATE user_notification_reads SET read_at = ? WHERE user_id = ? AND notification_id = ?");
                $update->execute([$now, $clientId, $notificationId]);
                if ($update->rowCount() === 0) {
                    $pdo->prepare("INSERT INTO user_notification_reads (user_id, notification_id, read_at) VALUES (?, ?, ?)")
                        ->execute([$clientId, $notificationId, $now]);
                }
            }
        } elseif (!empty($input['id'])) {
            $notificationId = trim((string)$input['id']);
            $update = $pdo->prepare("UPDATE user_notification_reads SET read_at = ? WHERE user_id = ? AND notification_id = ?");
            $update->execute([$now, $clientId, $notificationId]);
            if ($update->rowCount() === 0) {
                $pdo->prepare("INSERT INTO user_notification_reads (user_id, notification_id, read_at) VALUES (?, ?, ?)")
                    ->execute([$clientId, $notificationId, $now]);
            }
        } else {
            jsonResponse(['ok' => false, 'error' => 'Notification action is required.'], 400);
        }
        jsonResponse(['ok' => true]);
    }
    if ($method !== 'GET') jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    $stmt = $pdo->prepare("
        SELECT n.*, CASE WHEN r.notification_id IS NOT NULL THEN 1 ELSE n.is_read END AS is_read
        FROM notifications n
        LEFT JOIN user_notification_reads r ON r.notification_id = n.id AND r.user_id = ?
        WHERE n.user_id = ? OR n.user_id IS NULL OR n.user_id = ''
        ORDER BY n.created_at DESC LIMIT 100
    ");
    $stmt->execute([$clientId, $clientId]);
    $logs = $stmt->fetchAll();
    jsonResponse(['ok' => true, 'notifications' => $logs, 'total' => count($logs)]);
}

if ($apiPath === '/admin/notifications/sent-log') {
    $actor = requireAdminCapability($pdo, $adminSession, 'notifications');
    if ($method === 'DELETE') {
        if ($actor['role'] !== 'Super Admin') jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can clear the sent log.'], 403);
        $pdo->exec("DELETE FROM notifications");
        jsonResponse(['ok' => true]);
    }
    if ($method !== 'GET') jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    $limit = max(1, min(100, (int)($_GET['limit'] ?? 50)));
    $offset = max(0, (int)($_GET['offset'] ?? 0));
    $where = $actor['role'] === 'Super Admin' ? '1 = 1' : 'n.sent_by = ?';
    $countStmt = $pdo->prepare("SELECT COUNT(*) FROM notifications n WHERE {$where}");
    $countStmt->execute($actor['role'] === 'Super Admin' ? [] : [$actor['id']]);
    $total = (int)$countStmt->fetchColumn();
    $stmt = $pdo->prepare("
        SELECT n.id, n.user_id, n.title, n.description, n.description AS message, n.kind, n.type, n.link,
               n.sent_by, n.created_at, NULL AS recalled_at,
               COALESCE(c.name, c.email, 'All clients') AS user_name,
               c.email AS user_email,
               COALESCE(s.name, n.sent_by) AS admin_name,
               CASE WHEN n.user_id IS NULL OR n.user_id = '' THEN 1 ELSE 0 END AS is_broadcast,
               CASE WHEN n.user_id IS NULL OR n.user_id = ''
                    THEN (SELECT COUNT(*) FROM clients WHERE deleted_at IS NULL)
                    ELSE 1 END AS recipient_count
        FROM notifications n
        LEFT JOIN clients c ON c.id = n.user_id
        LEFT JOIN staff_users s ON s.id = n.sent_by
        WHERE {$where}
        ORDER BY n.created_at DESC
        LIMIT ? OFFSET ?
    ");
    $params = $actor['role'] === 'Super Admin' ? [] : [$actor['id']];
    $params[] = $limit;
    $params[] = $offset;
    $stmt->execute($params);
    $logs = $stmt->fetchAll();
    jsonResponse([
        'ok' => true,
        'notifications' => $logs,
        'log' => $logs,
        'total' => $total,
        'limit' => $limit,
        'offset' => $offset,
        'has_more' => $offset + count($logs) < $total,
    ]);
}

if (preg_match('#^/admin/notifications/sent-log/([^/]+)$#', $apiPath, $sentNotificationMatch) && $method === 'DELETE') {
    $actor = requireAdminCapability($pdo, $adminSession, 'notifications');
    if ($actor['role'] !== 'Super Admin') jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can delete sent-log records.'], 403);
    $stmt = $pdo->prepare('DELETE FROM notifications WHERE id = ?');
    $stmt->execute([rawurldecode($sentNotificationMatch[1])]);
    jsonResponse(['ok' => true, 'deleted' => $stmt->rowCount()]);
}
