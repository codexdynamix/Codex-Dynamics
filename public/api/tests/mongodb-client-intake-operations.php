<?php
declare(strict_types=1);

final class IntakeOperationsResponse extends RuntimeException
{
    public function __construct(public readonly array $payload, public readonly int $status)
    {
        parent::__construct('Response captured.');
    }
}

$GLOBALS['intakeOperationsRows'] = [];
$GLOBALS['intakeOperationsWrites'] = [];

function isMongoStorageEnabled(): bool { return true; }
function mongoAuthEmailFilter(string $email, bool $trimStoredValue = false): array {
    $quoted = preg_quote(strtolower(trim($email)), '/');
    return ['email' => ['$regex' => ($trimStoredValue ? '^\\s*' : '^') . $quoted . ($trimStoredValue ? '\\s*$' : '$'), '$options' => 'i']];
}
function intakeOperationsMatches(array $row, array $filter): bool {
    foreach ($filter as $field => $value) {
        if ($field === '$expr') {
            $email = strtolower(trim((string)($row['email'] ?? '')));
            if (($row['status'] ?? null) !== 'pending' || $email !== 'new@example.com') return false;
        } elseif ($field === 'deleted_at' && $value === null) {
            if (array_key_exists('deleted_at', $row) && $row['deleted_at'] !== null) return false;
        } elseif (is_array($value) && isset($value['$regex'])) {
            $options = ($value['$options'] ?? '') === 'i' ? 'i' : '';
            if (preg_match('/' . str_replace('/', '\\/', $value['$regex']) . '/' . $options, (string)($row[$field] ?? '')) !== 1) return false;
        } elseif (($row[$field] ?? null) !== $value) {
            return false;
        }
    }
    return true;
}
function mongoFindOne(string $table, array $filter): ?array {
    foreach ($GLOBALS['intakeOperationsRows'][$table] ?? [] as $row) {
        if (intakeOperationsMatches($row, $filter)) return $row;
    }
    return null;
}
function mongoFindMany(string $table, array $filter = [], array $options = []): array {
    return array_values(array_filter(
        $GLOBALS['intakeOperationsRows'][$table] ?? [],
        static fn(array $row): bool => intakeOperationsMatches($row, $filter),
    ));
}
function mongoInsert(string $table, array $document): void {
    $GLOBALS['intakeOperationsRows'][$table][] = $document;
    $GLOBALS['intakeOperationsWrites'][] = [$table, $document];
}
function mongoUpsert(string $table, array $filter, array $updates): void {
    foreach ($GLOBALS['intakeOperationsRows'][$table] ?? [] as &$row) {
        if (intakeOperationsMatches($row, $filter)) {
            $row = array_merge($row, $updates);
            $GLOBALS['intakeOperationsWrites'][] = [$table, $filter, $updates];
            return;
        }
    }
    unset($row);
    $GLOBALS['intakeOperationsRows'][$table][] = array_merge($filter, $updates);
    $GLOBALS['intakeOperationsWrites'][] = [$table, $filter, $updates];
}
function jsonResponse(mixed $data, int $status = 200): void { throw new IntakeOperationsResponse($data, $status); }
function normalizeClientRow(array $row): array {
    unset($row['_id']);
    foreach (['comment_history', 'status_history', 'appointments'] as $field) {
        if (!is_array($row[$field] ?? null)) $row[$field] = [];
    }
    return $row;
}
function publicSiteConfig(?array $config): ?array {
    if ($config !== null) unset($config['webhookUrl'], $config['webhook_url']);
    return $config;
}
function encryptClientSecret(string $plainText): string { return 'encrypted-for-test-only'; }

function dispatchIntakeOperations(string $path, string $routeMethod, array $routeInput = [], array $query = [], ?array $staff = null): IntakeOperationsResponse {
    global $apiPath, $method, $input, $pdo, $adminSession, $portalSession;
    $apiPath = $path;
    $method = $routeMethod;
    $input = $routeInput;
    $pdo = null;
    $adminSession = $staff === null ? null : ['id' => $staff['id']];
    $portalSession = null;
    $_GET = $query;
    try {
        require dirname(__DIR__) . '/routes/02-client-intake.php';
    } catch (IntakeOperationsResponse $response) {
        return $response;
    }
    throw new RuntimeException('The route did not return a response.');
}

function expectIntakeOperations(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}

$signup = dispatchIntakeOperations('/portal/signup-request', 'POST', [
    'name' => 'Morgan Example', 'email' => ' New@Example.com ', 'countryCode' => 'GB',
]);
expectIntakeOperations($signup->status === 202, 'Valid signup requests must preserve the generic 202 response.');
expectIntakeOperations(count($GLOBALS['intakeOperationsRows']['signup_requests']) === 1, 'A pending signup request should be stored once.');
expectIntakeOperations($GLOBALS['intakeOperationsRows']['signup_requests'][0]['email'] === 'new@example.com', 'Signup emails must be normalized.');
expectIntakeOperations($GLOBALS['intakeOperationsRows']['signup_requests'][0]['request_data'] !== '', 'Signup request details must retain the SQL JSON field.');

$duplicateSignup = dispatchIntakeOperations('/portal/signup-request', 'POST', [
    'name' => 'Morgan Example', 'email' => 'new@example.com',
]);
expectIntakeOperations($duplicateSignup->status === 202, 'Signup retries must retain a generic response.');
expectIntakeOperations(count($GLOBALS['intakeOperationsRows']['signup_requests']) === 1, 'Pending signup requests must be idempotent.');

$invalidSignup = dispatchIntakeOperations('/portal/signup-request', 'POST', ['name' => '', 'email' => 'bad']);
expectIntakeOperations($invalidSignup->status === 422, 'Invalid signup details must preserve validation.');

$GLOBALS['intakeOperationsRows']['clients'][] = ['id' => 'client-1', 'email' => 'reset@example.com'];
$GLOBALS['intakeOperationsRows']['client_portal_access'][] = [
    'client_id' => 'client-1', 'status' => 'Active', 'portal_enabled' => 1,
];
$reset = dispatchIntakeOperations('/portal/password-reset-request', 'POST', ['email' => 'RESET@example.com']);
expectIntakeOperations($reset->status === 202, 'Password-reset requests must keep the generic 202 response.');
expectIntakeOperations(count($GLOBALS['intakeOperationsRows']['password_reset_requests']) === 1, 'An active portal account should create a reset request.');
expectIntakeOperations($GLOBALS['intakeOperationsRows']['password_reset_requests'][0]['attempt_count'] === 0, 'A reset request must reset attempts.');

$GLOBALS['intakeOperationsRows']['platform_settings'][] = [
    'id' => 'global', 'settings_json' => '{"theme":"dark"}',
    'site_config_json' => '{"brand":"Example","webhookUrl":"private"}',
];
$settings = dispatchIntakeOperations('/crm/settings', 'GET');
expectIntakeOperations($settings->payload['settings'] === ['theme' => 'dark'], 'Mongo settings must retain the decoded settings shape.');
expectIntakeOperations(!isset($settings->payload['site_config']['webhookUrl']), 'Mongo settings must not expose webhook credentials.');

$GLOBALS['intakeOperationsRows']['staff_users'][] = [
    'id' => 'staff-1', 'name' => 'Office Manager', 'role' => 'Office Manager', 'status' => 'Active',
    'office_id' => 'office-1', 'capabilities' => '{}', 'deleted_at' => null,
];
$GLOBALS['intakeOperationsRows']['clients'][] = [
    'id' => 'visible', 'name' => 'Visible Client', 'email' => 'visible@example.com', 'assigned_office_id' => 'office-1',
    'created_at' => '2026-01-02T00:00:00Z', 'comment_history' => '[]',
];
$GLOBALS['intakeOperationsRows']['clients'][] = [
    'id' => 'hidden', 'name' => 'Hidden Client', 'assigned_office_id' => 'office-2',
    'created_at' => '2026-01-03T00:00:00Z',
];
$list = dispatchIntakeOperations('/admin/clients', 'GET', [], [], $GLOBALS['intakeOperationsRows']['staff_users'][0]);
expectIntakeOperations($list->payload['total'] === 1, 'Admin list counts must respect office-based authorization scope.');
expectIntakeOperations($list->payload['clients'][0]['id'] === 'visible', 'Only in-scope clients may be returned.');
expectIntakeOperations(!array_key_exists('_id', $list->payload['clients'][0]), 'Mongo metadata must not appear in client responses.');

$invalidCompletion = dispatchIntakeOperations('/portal/signup/complete', 'POST', []);
expectIntakeOperations($invalidCompletion->status === 422, 'Credential completion must validate before applying the Mongo transaction guard.');
$GLOBALS['intakeOperationsRows']['signup_requests'][] = [
    'id' => 'signup-approved', 'email' => 'new@example.com', 'status' => 'approved',
    'verification_code_hash' => password_hash('654321', PASSWORD_DEFAULT),
    'verification_expires_at' => date('c', time() + 600), 'verification_attempts' => 0,
];
$blockedFlow = dispatchIntakeOperations('/portal/signup/complete', 'POST', [
    'email' => 'new@example.com', 'verification_code' => '654321', 'password' => 'safe-password',
]);
expectIntakeOperations($blockedFlow->status === 501, 'Cross-collection credential creation must remain explicitly fail-closed without transactions.');

fwrite(STDOUT, "MongoDB client-intake operations passed without Atlas.\n");
