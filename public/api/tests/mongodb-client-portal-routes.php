<?php
declare(strict_types=1);

require dirname(__DIR__) . '/lib/mongodb.php';

function portalMongoExpectSame(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException($message . "\nExpected: " . var_export($expected, true) . "\nActual: " . var_export($actual, true));
    }
}

$apiPath = '/__mongodb_test__';
$method = 'GET';
$input = [];
$portalSession = [];
$pdo = null;
require dirname(__DIR__) . '/routes/15-client-portal-complete-dashboard-data.php';
require dirname(__DIR__) . '/routes/16-client-portal-support-tickets.php';

$queries = mongoPortalDataQueries('client-17');
portalMongoExpectSame(['client_websites', ['client_id' => 'client-17'], []], $queries['websites'], 'Website reads must be scoped to the authenticated client.');
portalMongoExpectSame(['client_support_tickets', ['client_id' => 'client-17'], ['sort' => ['created_at' => -1]]], $queries['tickets'], 'Dashboard tickets must remain client-scoped and newest-first.');
portalMongoExpectSame(
    ['client_id' => 'client-17', 'status' => ['$exists' => true, '$nin' => ['Draft', null]]],
    $queries['invoices'][1],
    'Invoice reads must preserve SQL status <> Draft semantics, including NULL exclusion.',
);
portalMongoExpectSame(
    ['$or' => [['user_id' => 'client-17'], ['user_id' => null], ['user_id' => '']]],
    $queries['notifications'][1],
    'Notifications must include only client-owned and global rows.',
);
portalMongoExpectSame(['user_id' => 'client-17'], $queries['messages'][1], 'Messages must remain client-scoped.');
portalMongoExpectSame(
    ['user_id' => 'client-17', 'notification_id' => ['$in' => [7, '8']]],
    mongoPortalNotificationReadFilter('client-17', [
        ['id' => 7],
        ['id' => '8'],
        ['id' => 7],
        ['_id' => 'without-sql-id'],
    ]),
    'Notification read lookups must be limited to the client and selected notifications.',
);

$notificationRows = normalizeMongoPortalNotifications('client-17', [
    ['_id' => 'hash-a', '_migration_source' => 'legacy', 'id' => 1, 'created_at' => '2026-10-12T10:00:00Z', 'is_read' => 0],
    ['_id' => 'hash-b', 'id' => 2, 'created_at' => '2026-10-12T09:00:00Z', 'is_read' => 0],
    ['_id' => 'hash-c', 'id' => 3, 'created_at' => '2026-10-12T08:00:00Z', 'is_read' => 1],
], [
    ['user_id' => 'client-17', 'notification_id' => 1],
    ['user_id' => 'client-17', 'notification_id' => 1],
    ['user_id' => 'other-client', 'notification_id' => 2],
]);
portalMongoExpectSame(
    [
        ['id' => 1, 'created_at' => '2026-10-12T10:00:00Z', 'is_read' => 1],
        ['id' => 1, 'created_at' => '2026-10-12T10:00:00Z', 'is_read' => 1],
        ['id' => 2, 'created_at' => '2026-10-12T09:00:00Z', 'is_read' => 0],
        ['id' => 3, 'created_at' => '2026-10-12T08:00:00Z', 'is_read' => 1],
    ],
    $notificationRows,
    'Notification normalization must preserve joined rows, owner-specific reads, ordering, and omit Mongo metadata.',
);

$profileUpdates = mongoPortalProfileUpdates(
    ['name' => ' Client Name ', 'portalPreferences' => ['billingAlerts' => false]],
    ['portal_preferences' => '{"emailDigest":false,"securityAlerts":true}'],
    '2026-10-13T00:00:00+00:00',
);
portalMongoExpectSame('Client Name', $profileUpdates['name'], 'Profile text fields must retain trimming.');
portalMongoExpectSame(
    '{"emailDigest":false,"billingAlerts":false,"securityAlerts":true}',
    $profileUpdates['portal_preferences'],
    'Portal preference updates must merge only supported keys with current values and defaults.',
);
portalMongoExpectSame('2026-10-13T00:00:00+00:00', $profileUpdates['updated_at'], 'Mongo profile updates must set updated_at.');

$ticketUpdate = mongoPortalTicketUpdate(
    'client-17',
    'ticket-4',
    ['messages' => '[{"id":"msg-old","sender":"agent","text":"Hello"}]', 'status' => 'Closed'],
    'Please reopen',
    '2026-10-13T00:00:00+00:00',
);
portalMongoExpectSame(['id' => 'ticket-4', 'client_id' => 'client-17'], $ticketUpdate['filter'], 'Ticket updates must use both ticket and client ids.');
portalMongoExpectSame('Open', $ticketUpdate['updates']['status'], 'A client reply must reopen a ticket.');
portalMongoExpectSame('Please reopen', $ticketUpdate['messages'][1]['text'], 'Client ticket replies must append the supplied text.');
portalMongoExpectSame('client', $ticketUpdate['messages'][1]['sender'], 'Client ticket replies must preserve sender metadata.');

$newTicket = mongoPortalNewTicket('client-17', 'tick-1', 'TICK-A1B2C3D4', 'Subject', 'General', 'Medium', 'Help', '2026-10-13T00:00:00+00:00');
portalMongoExpectSame('client-17', $newTicket['client_id'], 'New tickets must be associated with the authenticated client.');
portalMongoExpectSame('Open', $newTicket['status'], 'New tickets must start Open.');
portalMongoExpectSame('Help', json_decode($newTicket['messages'], true)[0]['text'], 'New ticket messages must be stored in the legacy JSON format.');
portalMongoExpectSame(
    ['id' => 'ticket-4', 'client_id' => 'client-17'],
    mongoPortalTicketFindFilter('ticket-4', 'client-17'),
    'Ticket lookup must not use imported _id in place of preserved SQL fields.',
);

fwrite(STDOUT, "MongoDB client portal route validation passed.\n");
