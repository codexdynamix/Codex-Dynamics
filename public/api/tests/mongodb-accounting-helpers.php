<?php
declare(strict_types=1);

require dirname(__DIR__) . '/lib/mongodb.php';
require dirname(__DIR__) . '/lib/core.php';

function expectAccountingSame(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException($message . ' Expected ' . var_export($expected, true)
            . ', got ' . var_export($actual, true) . '.');
    }
}

function expectAccountingTrue(bool $actual, string $message): void
{
    if (!$actual) throw new RuntimeException($message);
}

putenv('API_STORAGE');
putenv('MONGODB_URI');
putenv('MONGODB_DATABASE');
$apiPath = '/__mongodb_accounting_helper_test__';
$method = 'GET';
$input = [];
$adminSession = null;
$pdo = null;
require dirname(__DIR__) . '/routes/13-authentication-staff-login.php';

expectAccountingSame(
    ['client_id' => 'client-1', 'staff_id' => 'agent-1', 'profile_section' => 'accounting'],
    mongoAccountingPermissionFilter('client-1', 'agent-1', 'accounting'),
    'Accounting grant lookup must remain scoped to the client, staff member, and section.',
);
expectAccountingSame(
    [
        'invoice_id' => 'invoice-1',
        'client_id' => 'client-1',
        'status' => ['$not' => ['$regex' => '^voided$', '$options' => 'i']],
    ],
    mongoAccountingActivePaymentsFilter('client-1', 'invoice-1'),
    'Invoice paid-total query must exclude voided receipts case-insensitively.',
);
expectAccountingSame(
    ['client_id' => 'client-1'],
    mongoAccountingClientFilter('client-1'),
    'Client ledger queries must stay client-scoped.',
);

expectAccountingSame(
    ['id' => 'invoice-1', 'line_items' => '[]'],
    mongoAccountingCleanRow([
        '_id' => 'migration-key',
        '_migration_source' => 'legacy',
        'id' => 'invoice-1',
        'line_items' => '[]',
    ]),
    'Mongo migration metadata must not leak into accounting records.',
);
expectAccountingSame(
    'Ada Lovelace',
    mongoAccountingClientName(['first_name' => 'Ada', 'last_name' => 'Lovelace', 'company' => 'Analytical Engines'], true),
    'Accounting overview client names must retain the first/last-name fallback.',
);
expectAccountingSame(
    'Analytical Engines',
    mongoAccountingClientName(['company' => 'Analytical Engines']),
    'Joined accounting client names must retain the company fallback.',
);
expectAccountingSame(
    ' ',
    mongoAccountingClientName(['name' => ' ', 'company' => 'Analytical Engines']),
    'Joined SQL label fallback must preserve non-empty whitespace names.',
);
expectAccountingSame(
    'Client',
    mongoAccountingClientName([]),
    'Empty joined client names must retain the SQL fallback.',
);
expectAccountingTrue(mongoAccountingValidDate('2024-02-29'), 'Leap-day dates should be accepted.');
expectAccountingTrue(!mongoAccountingValidDate('2025-02-29'), 'Impossible calendar dates must be rejected.');

$officeManager = ['role' => 'Office Manager'];
$readGrant = ['access_level' => 'read'];
$editGrant = ['access_level' => 'edit'];
expectAccountingTrue(
    mongoAccountingCanAccessSection($officeManager, $readGrant, 'accounting', false),
    'An explicit read grant must allow accounting reads.',
);
expectAccountingTrue(
    !mongoAccountingCanAccessSection($officeManager, $readGrant, 'accounting', true),
    'A read grant must not allow accounting writes.',
);
expectAccountingTrue(
    mongoAccountingCanAccessSection($officeManager, $editGrant, 'accounting', true),
    'An edit grant must allow accounting writes.',
);
expectAccountingTrue(
    !mongoAccountingCanAccessSection(['role' => 'Billing'], $editGrant, 'accounting', false),
    'Unrecognized staff roles must not gain accounting access.',
);
expectAccountingTrue(
    mongoAccountingCanAccessSection(['role' => 'Super Admin'], [], 'accounting', true),
    'Super Admin access must remain unconditional.',
);
expectAccountingTrue(mongoAccountingStatusIsVoided('VOIDED'), 'Voided status normalization must ignore case.');
expectAccountingTrue(!mongoAccountingStatusIsVoided(' Voided '), 'SQL void-total semantics must not trim status values.');

fwrite(STDOUT, "MongoDB accounting helper validation passed without an Atlas connection.\n");
