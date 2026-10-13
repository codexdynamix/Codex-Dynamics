<?php
/** Route group: CLIENT PORTAL: SUPPORT TICKETS (included by index.php in order; uses its request globals). */

declare(strict_types=1);

function mongoPortalTicketFindFilter(string $ticketId, string $clientId): array {
    return ['id' => $ticketId, 'client_id' => $clientId];
}

function mongoPortalTicketUpdate(string $clientId, string $ticketId, array $existing, string $text, string $now): array {
    $messages = json_decode((string)($existing['messages'] ?? ''), true);
    if (!is_array($messages)) $messages = [];
    $messages[] = [
        'id' => 'msg_' . time(),
        'sender' => 'client',
        'senderName' => 'Client',
        'text' => $text,
        'createdAt' => $now,
    ];
    return [
        'filter' => mongoPortalTicketFindFilter($ticketId, $clientId),
        'updates' => ['messages' => json_encode($messages), 'status' => 'Open', 'updated_at' => $now],
        'messages' => $messages,
    ];
}

function mongoPortalNewTicket(string $clientId, string $newId, string $ticketNum, mixed $subject, mixed $category, mixed $priority, string $text, string $now): array {
    $messages = [[
        'id' => 'msg_' . time(),
        'sender' => 'client',
        'senderName' => 'Client',
        'text' => $text,
        'createdAt' => $now,
    ]];
    return [
        'id' => $newId,
        'client_id' => $clientId,
        'ticket_number' => $ticketNum,
        'subject' => $subject,
        'category' => $category,
        'priority' => $priority,
        'status' => 'Open',
        'assigned_agent' => null,
        'messages' => json_encode($messages),
        'created_at' => $now,
        'updated_at' => $now,
    ];
}

// -----------------------------------------------------------------------------
// 16. CLIENT PORTAL: SUPPORT TICKETS
// -----------------------------------------------------------------------------
if ($apiPath === '/portal/ticket' && $method === 'POST') {
    if (!empty($portalSession['impersonating'])) jsonResponse(['ok' => false, 'error' => 'Impersonation is read-only.'], 403);
    $clientId = $portalSession['id'];
    $ticketId = $input['ticketId'] ?? $input['ticket_id'] ?? '';
    $text = trim($input['text'] ?? $input['message'] ?? '');
    $sender = 'client';
    $senderName = 'Client';
    $now = date('c');

    if ($ticketId) {
        if (isMongoStorageEnabled()) {
            $existing = mongoFindOne('client_support_tickets', mongoPortalTicketFindFilter((string)$ticketId, (string)$clientId));
        } else {
            $stmtEx = $pdo->prepare("SELECT * FROM client_support_tickets WHERE id = ? AND client_id = ?");
            $stmtEx->execute([$ticketId, $clientId]);
            $existing = $stmtEx->fetch();
        }
        if ($existing) {
            if (isMongoStorageEnabled()) {
                $ticketUpdate = mongoPortalTicketUpdate((string)$clientId, (string)$ticketId, $existing, $text, $now);
                getMongoCollection(mongoCollectionName('client_support_tickets'))->updateOne(
                    $ticketUpdate['filter'],
                    ['$set' => $ticketUpdate['updates']],
                );
                $msgs = $ticketUpdate['messages'];
            } else {
                $msgs = json_decode($existing['messages'] ?: '[]', true) ?: [];
                $msgs[] = ['id' => 'msg_' . time(), 'sender' => $sender, 'senderName' => $senderName, 'text' => $text, 'createdAt' => $now];
                $nextStatus = $sender === 'client' ? 'Open' : $existing['status'];
                $pdo->prepare("UPDATE client_support_tickets SET messages = ?, status = ?, updated_at = ? WHERE id = ?")
                    ->execute([json_encode($msgs), $nextStatus, $now, $ticketId]);
            }
            jsonResponse(['ok' => true, 'ticket_id' => $ticketId, 'messages' => $msgs]);
        }
    } else {
        $newId = 'tick_' . time();
        $ticketNum = 'TICK-' . strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));
        $subject = $input['subject'] ?? 'Support Request';
        $category = $input['category'] ?? 'General';
        $priority = $input['priority'] ?? 'Medium';
        if (isMongoStorageEnabled()) {
            $ticket = mongoPortalNewTicket((string)$clientId, $newId, $ticketNum, $subject, $category, $priority, $text, $now);
            mongoInsert('client_support_tickets', $ticket);
            $initialMsgs = json_decode($ticket['messages'], true) ?: [];
        } else {
            $initialMsgs = [['id' => 'msg_' . time(), 'sender' => 'client', 'senderName' => $senderName, 'text' => $text, 'createdAt' => $now]];
            $pdo->prepare("INSERT INTO client_support_tickets (id, client_id, ticket_number, subject, category, priority, status, assigned_agent, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'Open', NULL, ?, ?, ?)")
                ->execute([$newId, $clientId, $ticketNum, $subject, $category, $priority, json_encode($initialMsgs), $now, $now]);

            $stmtNew = $pdo->prepare("SELECT * FROM client_support_tickets WHERE id = ?");
            $stmtNew->execute([$newId]);
            $ticket = $stmtNew->fetch();
        }
        $ticket['messages'] = $initialMsgs;
        jsonResponse(['ok' => true, 'ticket_id' => $newId, 'ticket_number' => $ticketNum, 'ticket' => $ticket]);
    }
}
