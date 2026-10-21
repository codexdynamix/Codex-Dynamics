<?php
/**
 * Codex Dynamics - Complete MongoDB API for Hostinger Shared Hosting
 *
 * Designed to run on Hostinger Shared Hosting with PHP 8.0+ and the 'mongodb' PHP Extension.
 */

declare(strict_types=1);

ini_set('display_errors', '0');
error_reporting(E_ALL);

// ---------------------------------------------------------------------------
// 1. CORS & Response Helpers
// ---------------------------------------------------------------------------
function sendCors(): void {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
    header('Access-Control-Allow-Credentials: true');
}

function jsonOut(mixed $data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    sendCors();
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

sendCors();

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    jsonOut(['ok' => true]);
}

// ---------------------------------------------------------------------------
// 2. Configuration & MongoDB Connection
// ---------------------------------------------------------------------------
$configFile = __DIR__ . '/config.php';
$config = file_exists($configFile) ? require $configFile : [];
$mongoUri = $config['mongodb_uri'] ?? getenv('MONGODB_URI') ?: '';
$mongoDbName = $config['mongodb_database'] ?? getenv('MONGODB_DATABASE') ?: 'codex_dynamics';

// Autoload composer if available
$vendorAutoload = __DIR__ . '/vendor/autoload.php';
if (file_exists($vendorAutoload)) {
    require_once $vendorAutoload;
}

class MongoService {
    private static ?object $client = null;
    private static string $databaseName = 'codex_dynamics';
    private static bool $isExtensionLoaded = false;

    public static function init(string $uri, string $dbName): void {
        self::$databaseName = $dbName;
        self::$isExtensionLoaded = extension_loaded('mongodb');

        if (!self::$isExtensionLoaded) {
            jsonOut(['ok' => false, 'error' => 'MongoDB PHP support is required.'], 503);
        }
        if (!class_exists('MongoDB\\Client')) {
            jsonOut(['ok' => false, 'error' => 'MongoDB PHP library is missing. Install the API Composer dependencies.'], 503);
        }
        if (!str_starts_with($uri, 'mongodb://') && !str_starts_with($uri, 'mongodb+srv://')) {
            jsonOut(['ok' => false, 'error' => 'MONGODB_URI is required to use this API.'], 503);
        }

        try {
            self::$client = new MongoDB\Client($uri, [], ['serverSelectionTimeoutMS' => 4000]);
        } catch (Throwable $e) {
            error_log('[MongoService] Could not connect to the configured MongoDB database.');
            jsonOut(['ok' => false, 'error' => 'MongoDB is unavailable.'], 503);
        }
    }

    public static function ping(): bool {
        if (self::$client === null) return false;
        try {
            self::$client->selectDatabase(self::$databaseName)->command(['ping' => 1]);
            return true;
        } catch (Throwable $error) {
            error_log('[MongoService] MongoDB health check failed.');
            return false;
        }
    }

    public static function isExtensionActive(): bool {
        return self::$isExtensionLoaded;
    }

    public static function getDatabaseName(): string {
        return self::$databaseName;
    }

    public static function getCollection(string $name, array $filter = [], int $limit = 200, int $skip = 0, array $sort = [], array $projection = []): array {
        $col = self::$client->selectDatabase(self::$databaseName)->selectCollection($name);
        $options = ['limit' => $limit, 'skip' => $skip];
        if ($sort) $options['sort'] = $sort;
        if ($projection) $options['projection'] = $projection;
        $cursor = $col->find($filter, $options);
        $results = [];
        foreach ($cursor as $doc) {
            $arr = (array)$doc;
            unset($arr['_id']);
            $results[] = $arr;
        }
        return $results;
    }

    public static function updateOne(string $name, array $filter, array $updates): int {
        return self::updateOneWithOptions($name, $filter, $updates);
    }

    public static function updateOneWithOptions(string $name, array $filter, array $updates, array $options = []): int {
        $result = self::$client
            ->selectDatabase(self::$databaseName)
            ->selectCollection($name)
            ->updateOne($filter, ['$set' => $updates], $options);
        return $result->getMatchedCount();
    }

    public static function updateOneWithOperators(string $name, array $filter, array $operators, array $options = []): int {
        $result = self::$client
            ->selectDatabase(self::$databaseName)
            ->selectCollection($name)
            ->updateOne($filter, $operators, $options);
        return $result->getMatchedCount();
    }

    public static function addToSetOne(string $name, array $filter, string $field, mixed $value): int {
        $result = self::$client
            ->selectDatabase(self::$databaseName)
            ->selectCollection($name)
            ->updateOne($filter, ['$addToSet' => [$field => $value]]);
        return $result->getMatchedCount();
    }

    public static function updateMany(string $name, array $filter, array $updates): int {
        $result = self::$client
            ->selectDatabase(self::$databaseName)
            ->selectCollection($name)
            ->updateMany($filter, ['$set' => $updates]);
        return $result->getModifiedCount();
    }

    public static function deleteOne(string $name, array $filter): int {
        $result = self::$client
            ->selectDatabase(self::$databaseName)
            ->selectCollection($name)
            ->deleteOne($filter);
        return $result->getDeletedCount();
    }

    public static function deleteMany(string $name, array $filter): int {
        return self::$client
            ->selectDatabase(self::$databaseName)
            ->selectCollection($name)
            ->deleteMany($filter)
            ->getDeletedCount();
    }

    public static function countDocuments(string $name, array $filter = []): int {
        return self::$client
            ->selectDatabase(self::$databaseName)
            ->selectCollection($name)
            ->countDocuments($filter);
    }

    public static function insert(string $name, array $doc): array {
        $col = self::$client->selectDatabase(self::$databaseName)->selectCollection($name);
        if (!isset($doc['id'])) {
            $doc['id'] = 'doc_' . time() . '_' . substr(bin2hex(random_bytes(4)), 0, 6);
        }
        $doc['created_at'] = $doc['created_at'] ?? date('c');
        $col->insertOne($doc);
        unset($doc['_id']);
        return $doc;
    }

    public static function findOne(string $name, array $filter): ?array {
        $doc = self::$client->selectDatabase(self::$databaseName)->selectCollection($name)->findOne($filter);
        if ($doc === null) return null;
        $result = (array)$doc;
        unset($result['_id']);
        return $result;
    }

}

MongoService::init($mongoUri, $mongoDbName);

function clientAccessEncryptionKey(): string {
    $source = (string)($GLOBALS['mongoUri'] ?? '');
    if ($source === '') {
        jsonOut(['ok' => false, 'error' => 'Client access storage is unavailable.'], 503);
    }
    return hash('sha256', 'codex-dynamics-client-access:' . $source, true);
}

function encryptClientAccessSecret(string $value): ?array {
    if ($value === '') return null;
    $iv = random_bytes(12);
    $tag = '';
    $encrypted = openssl_encrypt($value, 'aes-256-gcm', clientAccessEncryptionKey(), OPENSSL_RAW_DATA, $iv, $tag);
    if ($encrypted === false) {
        jsonOut(['ok' => false, 'error' => 'Could not encrypt client access data.'], 500);
    }
    return [
        'version' => '1',
        'iv' => base64_encode($iv),
        'tag' => base64_encode($tag),
        'data' => base64_encode($encrypted),
    ];
}

function decryptClientAccessSecret(mixed $value): string {
    if (is_object($value)) $value = (array)$value;
    if (!is_array($value) || ($value['version'] ?? '') !== '1') return '';
    $iv = base64_decode((string)($value['iv'] ?? ''), true);
    $tag = base64_decode((string)($value['tag'] ?? ''), true);
    $encrypted = base64_decode((string)($value['data'] ?? ''), true);
    if ($iv === false || $tag === false || $encrypted === false) {
        error_log('[client-access] Saved access data is malformed.');
        jsonOut(['ok' => false, 'error' => 'Saved client access data could not be decrypted.'], 500);
    }
    $decrypted = openssl_decrypt($encrypted, 'aes-256-gcm', clientAccessEncryptionKey(), OPENSSL_RAW_DATA, $iv, $tag);
    if ($decrypted === false) {
        error_log('[client-access] Saved access data could not be decrypted.');
        jsonOut(['ok' => false, 'error' => 'Saved client access data could not be decrypted.'], 500);
    }
    return $decrypted;
}

function hostingerMailApiRequest(string $token, string $endpoint = '/api/v1/me'): array {
    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => "Accept: application/json\r\nAuthorization: Bearer {$token}\r\n",
            'timeout' => 15,
            'ignore_errors' => true,
        ],
    ]);
    $responseBody = file_get_contents('https://api.mail.hostinger.com' . $endpoint, false, $context);
    $statusLine = $http_response_header[0] ?? '';
    preg_match('/\s(\d{3})\s/', $statusLine, $statusMatch);
    $status = (int)($statusMatch[1] ?? 0);
    if ($responseBody === false || $status === 0) {
        jsonOut(['ok' => false, 'error' => 'Could not reach the Hostinger Mail API. Check server outbound HTTPS connectivity and try again.'], 502);
    }
    $decoded = json_decode($responseBody, true);
    if ($status < 200 || $status >= 300) {
        $message = is_array($decoded) ? ($decoded['error'] ?? $decoded['message'] ?? '') : '';
        if ($status === 401 || $status === 403) {
            $message = 'Hostinger rejected the API token. Confirm it is a Hostinger Mail API token with mailbox access.';
        } elseif ($message === '') {
            $message = "Hostinger Mail API returned HTTP {$status}.";
        }
        jsonOut(['ok' => false, 'error' => $message], 502);
    }
    if (!is_array($decoded)) {
        jsonOut(['ok' => false, 'error' => 'Hostinger Mail API returned an unreadable response.'], 502);
    }
    return $decoded;
}

function hostingerMailApiRequestMethod(string $token, string $endpoint, string $method = 'GET', ?array $payload = null): array {
    $headers = "Accept: application/json\r\nAuthorization: Bearer {$token}\r\n";
    $content = '';
    if ($payload !== null) {
        $headers .= "Content-Type: application/json\r\n";
        $content = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($content === false) {
            jsonOut(['ok' => false, 'error' => 'Could not encode the Hostinger Mail request.'], 500);
        }
    }
    $httpOptions = [
        'method' => $method,
        'header' => $headers,
        'timeout' => 20,
        'ignore_errors' => true,
    ];
    if ($payload !== null) $httpOptions['content'] = $content;
    $context = stream_context_create(['http' => $httpOptions]);
    $responseBody = file_get_contents('https://api.mail.hostinger.com' . $endpoint, false, $context);
    $statusLine = $http_response_header[0] ?? '';
    preg_match('/\s(\d{3})\s/', $statusLine, $statusMatch);
    $status = (int)($statusMatch[1] ?? 0);
    if ($responseBody === false || $status === 0) {
        jsonOut(['ok' => false, 'error' => 'Could not reach the Hostinger Mail API. Check server outbound HTTPS connectivity and try again.'], 502);
    }
    $decoded = $responseBody === '' ? [] : json_decode($responseBody, true);
    if ($status < 200 || $status >= 300) {
        $message = is_array($decoded) ? (string)($decoded['error'] ?? $decoded['message'] ?? '') : '';
        if ($status === 401 || $status === 403) {
            $message = 'Hostinger rejected the API token or denied access to this mailbox.';
        } elseif ($message === '') {
            $message = "Hostinger Mail API returned HTTP {$status}.";
        }
        jsonOut(['ok' => false, 'error' => $message], 502);
    }
    if (!is_array($decoded)) {
        jsonOut(['ok' => false, 'error' => 'Hostinger Mail API returned an unreadable response.'], 502);
    }
    return $decoded;
}

function hostingerMailApiBinaryRequest(string $token, string $endpoint): array {
    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => "Accept: */*\r\nAuthorization: Bearer {$token}\r\n",
            'timeout' => 20,
            'ignore_errors' => true,
        ],
    ]);
    $responseBody = file_get_contents('https://api.mail.hostinger.com' . $endpoint, false, $context);
    $statusLine = $http_response_header[0] ?? '';
    preg_match('/\s(\d{3})\s/', $statusLine, $statusMatch);
    $status = (int)($statusMatch[1] ?? 0);
    if ($responseBody === false || $status === 0) {
        jsonOut(['ok' => false, 'error' => 'Could not reach the Hostinger Mail API.'], 502);
    }
    if ($status < 200 || $status >= 300) {
        jsonOut(['ok' => false, 'error' => "Hostinger Mail API returned HTTP {$status}."], 502);
    }
    $contentType = 'application/octet-stream';
    foreach ($http_response_header as $header) {
        if (preg_match('/^Content-Type:\s*([a-z0-9.+-]+\/[a-z0-9.+-]+)/i', $header, $match)) {
            $contentType = $match[1];
            break;
        }
    }
    return ['body' => $responseBody, 'contentType' => $contentType];
}

function portalMailSetSessionCookie(string $token): void {
    $forwardedProto = strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''));
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || $forwardedProto === 'https';
    setcookie('cdx_portal_session', $token, [
        'expires' => time() + 43200,
        'path' => '/api/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function adminSetSessionCookie(string $token): void {
    $forwardedProto = strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''));
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || $forwardedProto === 'https';
    setcookie('cdx_admin_session', $token, [
        'expires' => time() + 43200,
        'path' => '/api/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function adminClearSessionCookie(): void {
    $forwardedProto = strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''));
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || $forwardedProto === 'https';
    setcookie('cdx_admin_session', '', [
        'expires' => time() - 3600,
        'path' => '/api/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function portalMailClientFromRequest(): array {
    $headers = function_exists('getallheaders') ? getallheaders() : [];
    $authorization = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? $headers['Authorization'] ?? $headers['authorization'] ?? '');
    $token = trim((string)($_COOKIE['cdx_portal_session'] ?? ''));
    if ($token === '' && preg_match('/^Bearer\s+(.+)$/i', trim($authorization), $match)) {
        $token = trim($match[1]);
    }
    if (!preg_match('/^cdx_portal_(?:mongo|php_mongo|impersonate)_(.+)_(\d{10,13})$/', $token, $tokenMatch)) {
        jsonOut(['ok' => false, 'error' => 'Your portal session is invalid. Sign in again.'], 401);
    }
    $issuedAt = (int)$tokenMatch[2];
    if (strlen($tokenMatch[2]) === 13) $issuedAt = (int)floor($issuedAt / 1000);
    if ($issuedAt > time() + 60 || time() - $issuedAt > 43200) {
        jsonOut(['ok' => false, 'error' => 'Your portal session has expired. Sign in again.'], 401);
    }
    $sessionId = 'client_' . $tokenMatch[1] . '_' . ($issuedAt * 1000);
    $sessionRecord = MongoService::findOne('live_sessions', ['id' => $sessionId]);
    if (($sessionRecord['revoked'] ?? false) === true) {
        jsonOut(['ok' => false, 'error' => 'This portal session has been terminated. Sign in again.'], 401);
    }
    $client = MongoService::findOne('clients', ['id' => $tokenMatch[1]]);
    if (!$client || !hostingerMailClientIsActive($client)) {
        jsonOut(['ok' => false, 'error' => 'The client portal account is unavailable.'], 401);
    }
    if (!(bool)($client['portalEnabled'] ?? $client['portal_enabled'] ?? false)) {
        jsonOut(['ok' => false, 'error' => 'The client portal is disabled for this account.'], 403);
    }
    $now = date('c');
    $page = substr((string)(parse_url($_SERVER['REQUEST_URI'] ?? '/portal', PHP_URL_PATH) ?: '/portal'), 0, 300);
    $visits = is_array($sessionRecord['page_visits'] ?? null) ? $sessionRecord['page_visits'] : [];
    if (!$visits || ($visits[count($visits) - 1]['page'] ?? '') !== $page) {
        $visits[] = ['page' => $page, 'visited_at' => $now];
    }
    $headers = function_exists('getallheaders') ? getallheaders() : [];
    MongoService::updateOneWithOptions('live_sessions', ['id' => $sessionId], [
        'user_type' => 'client',
        'user_id' => (string)$client['id'],
        'client_id' => (string)$client['id'],
        'display_name' => (string)($client['name'] ?? $client['full_name'] ?? $client['display_name'] ?? 'Client'),
        'display_email' => (string)($client['email'] ?? ''),
        'role' => 'Client',
        'current_page' => $page,
        'last_seen_at' => $now,
        'is_online' => true,
        'ip' => (string)($_SERVER['REMOTE_ADDR'] ?? ''),
        'user_agent' => substr((string)($_SERVER['HTTP_USER_AGENT'] ?? $headers['User-Agent'] ?? ''), 0, 500),
        'page_visits' => array_slice($visits, -100),
        'logged_in_at' => date('c', $issuedAt),
        'revoked' => false,
    ], ['upsert' => true]);
    return $client;
}

function adminSessionIdentityFromRequest(): ?array {
    $headers = function_exists('getallheaders') ? getallheaders() : [];
    $authorization = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? $headers['Authorization'] ?? $headers['authorization'] ?? '');
    $token = trim((string)($_COOKIE['cdx_admin_session'] ?? ''));
    if ($token === '' && preg_match('/^Bearer\s+(.+)$/i', trim($authorization), $bearerMatch)) {
        $token = trim($bearerMatch[1]);
    }
    if (!preg_match('/^cdx_adm_(?:mongo|php_mongo)_(.+)_(\d{10,13})$/i', $token, $match)) return null;
    $issuedAt = (int)$match[2];
    if (strlen($match[2]) === 10) $issuedAt *= 1000;
    else $issuedAt = (int)floor($issuedAt / 1);
    if ($issuedAt > (time() * 1000) + 60000 || (time() * 1000) - $issuedAt > 43200000) return null;
    return ['staff_id' => $match[1], 'issued_at' => $issuedAt, 'id' => 'staff_' . $match[1] . '_' . $issuedAt];
}

function chatStaffFromRequest(): array {
    static $cachedStaff = null;
    if ($cachedStaff !== null) return $cachedStaff;

    $identity = adminSessionIdentityFromRequest();
    if ($identity === null) {
        jsonOut(['ok' => false, 'error' => 'A valid staff session is required.'], 401);
    }
    $session = MongoService::findOne('live_sessions', ['id' => $identity['id']]);
    if (($session['revoked'] ?? false) === true) {
        jsonOut(['ok' => false, 'error' => 'This staff session has been terminated. Sign in again.'], 401);
    }
    $staff = MongoService::findOne('staff_users', ['id' => $identity['staff_id']]);
    if (!$staff || ($staff['status'] ?? '') === 'Suspended' || !empty($staff['deleted_at']) || ($staff['is_bin'] ?? false) === true) {
        jsonOut(['ok' => false, 'error' => 'The staff account is unavailable.'], 401);
    }
    $cachedStaff = $staff;
    return $cachedStaff;
}

function requireChatSuperAdminFromRequest(): array {
    $staff = chatStaffFromRequest();
    $role = strtolower((string)(preg_replace('/[\s_-]+/', '', (string)($staff['role'] ?? '')) ?? ''));
    if ($role !== 'superadmin') {
        jsonOut(['ok' => false, 'error' => 'Only Super Admin can clear client history.'], 403);
    }

    function requireSessionSuperAdminFromRequest(): array {
        $staff = chatStaffFromRequest();
        $role = strtolower((string)(preg_replace('/[\s_-]+/', '', (string)($staff['role'] ?? '')) ?? ''));
        if ($role !== 'superadmin') {
            jsonOut(['ok' => false, 'error' => 'Only Super Admin can manage active sessions.'], 403);
        }
        return $staff;
    }

    function sessionApiTimestamp(mixed $value): int {
        if (is_numeric($value)) return (int)$value;
        $timestamp = $value ? strtotime((string)$value) : false;
        return $timestamp === false ? 0 : $timestamp;
    }

    function sessionApiRow(array $row): array {
        $lastSeen = sessionApiTimestamp($row['last_seen_at'] ?? null);
        return array_merge($row, [
            'logged_in_at' => (int)floor(sessionApiTimestamp($row['logged_in_at'] ?? null)),
            'last_seen_at' => (int)floor($lastSeen),
            'logged_out_at' => !empty($row['logged_out_at']) ? (int)floor(sessionApiTimestamp($row['logged_out_at'])) : null,
            'is_online' => ($row['revoked'] ?? false) !== true && (time() - $lastSeen <= 90),
        ]);
    }
    return $staff;
}

function notificationStaffCanNotifyClient(array $staff, array $client): bool {
    $role = strtolower((string)(preg_replace('/[\s_-]+/', '', (string)($staff['role'] ?? '')) ?? ''));
    $agentId = (string)($client['assignedToAgent'] ?? $client['assigned_agent_id'] ?? $client['agentId'] ?? $client['agent_id'] ?? '');
    $agent = $agentId !== '' ? MongoService::findOne('staff_users', ['id' => $agentId]) : null;
    $teamId = (string)($client['assignedToTeam'] ?? $client['assigned_team_id'] ?? $client['teamId'] ?? $client['team_id'] ?? $agent['teamId'] ?? $agent['team_id'] ?? '');
    $team = $teamId !== '' ? MongoService::findOne('teams', ['id' => $teamId]) : null;
    $clientOfficeId = (string)($client['assignedToOffice'] ?? $client['assigned_office_id'] ?? $client['officeId'] ?? $client['office_id'] ?? $agent['officeId'] ?? $agent['office_id'] ?? $team['officeId'] ?? $team['office_id'] ?? '');
    if ($role === 'officemanager') {
        $officeId = (string)($staff['officeId'] ?? $staff['office_id'] ?? '');
        return $officeId !== '' && $clientOfficeId === $officeId;
    }
    if ($role === 'teamleader') {
        $staffTeamId = (string)($staff['teamId'] ?? $staff['team_id'] ?? '');
        $clientTeamLeaderId = (string)($client['assignedToTeamLeader'] ?? $client['assigned_team_leader_id'] ?? '');
        return ($staffTeamId !== '' && $teamId === $staffTeamId)
            || ($clientTeamLeaderId !== '' && $clientTeamLeaderId === (string)($staff['id'] ?? ''));
    }
    if ($role === 'agent') {
        return $agentId !== '' && $agentId === (string)($staff['id'] ?? '');
    }
    return false;
}

function chatMessageFilter(string $clientId): array {
    return ['$or' => [
        ['user_id' => $clientId],
        ['clientId' => $clientId],
        ['client_id' => $clientId],
    ]];
}

function notificationClientFilter(string $clientId): array {
    return ['$or' => [
        ['user_id' => $clientId],
        ['clientId' => $clientId],
        ['client_id' => $clientId],
    ]];
}

function chatPresenceIsFresh(mixed $timestamp, int $seconds): bool {
    if (!is_string($timestamp) || $timestamp === '') return false;
    $time = strtotime($timestamp);
    return $time !== false && time() - $time <= $seconds && time() - $time >= -60;
}

function hostingerMailEnabledAssignment(string $clientId, string $resourceId): array {
    $assignment = MongoService::findOne('client_mailboxes', [
        'clientId' => $clientId,
        'providerMailboxId' => $resourceId,
    ]);
    $enabled = $assignment['enabled'] ?? false;
    if (!$assignment || !($enabled === true || $enabled === 1 || $enabled === '1')) {
        jsonOut(['ok' => false, 'error' => 'This mailbox is not assigned and enabled for your client portal.'], 403);
    }
    return $assignment;
}

function hostingerMailPageQuery(): array {
    return [
        'page' => max(1, (int)($_GET['page'] ?? 1)),
        'perPage' => min(100, max(1, (int)($_GET['perPage'] ?? 25))),
    ];
}

function hostingerMailMessagesResult(array $response): array {
    $messages = $response['data'] ?? [];
    if (is_array($messages) && isset($messages['data']) && is_array($messages['data'])) {
        $messages = $messages['data'];
    }
    return [
        'messages' => is_array($messages) ? $messages : [],
        'pagination' => $response['pagination'] ?? null,
    ];
}

function hostingerMailDraftResponse(array $draft): array {
    unset($draft['clientId'], $draft['mailboxId'], $draft['created_at']);
    return $draft;
}

function hostingerMailApiData(array $response): array {
    $data = $response['data'] ?? $response;
    if (is_array($data) && isset($data['data']) && is_array($data['data'])) {
        $data = $data['data'];
    }
    return is_array($data) ? $data : [];
}

function hostingerMailIntegration(): array {
    return MongoService::findOne('hostinger_mail_integrations', []) ?: [];
}

function hostingerMailMailboxList(array $integration): array {
    $token = trim((string)($integration['token'] ?? ''));
    if ($token === '') {
        jsonOut(['ok' => false, 'error' => 'Hostinger Mail API is not configured. Save a valid token first.'], 503);
    }
    $account = hostingerMailApiData(hostingerMailApiRequest($token));
    if (!is_array($account['mailboxes'] ?? null)) {
        jsonOut(['ok' => false, 'error' => 'Hostinger Mail API did not return a mailbox list.'], 502);
    }
    return $account['mailboxes'];
}

function hostingerMailClientIsActive(array $client): bool {
    return !((bool)($client['is_bin'] ?? false))
        && (!isset($client['deleted_at']) || $client['deleted_at'] === '');
}

function hostingerMailAssignmentResponse(array $assignment, ?array $client = null): array {
    return [
        'id' => (string)($assignment['id'] ?? ''),
        'clientId' => (string)($assignment['clientId'] ?? ''),
        'providerMailboxId' => (string)($assignment['providerMailboxId'] ?? ''),
        'emailAddress' => (string)($assignment['emailAddress'] ?? ''),
        'displayName' => (string)($assignment['displayName'] ?? $assignment['emailAddress'] ?? ''),
        'enabled' => (bool)($assignment['enabled'] ?? false),
        'createdAt' => $assignment['createdAt'] ?? null,
        'updatedAt' => $assignment['updatedAt'] ?? null,
        'clientName' => $client['name'] ?? null,
        'clientEmail' => $client['email'] ?? null,
        'clientCompany' => $client['company'] ?? null,
        'portalActive' => $client === null
            ? false
            : (bool)($client['portalEnabled'] ?? $client['portal_enabled'] ?? false),
    ];
}

// ---------------------------------------------------------------------------
// 3. Routing
// ---------------------------------------------------------------------------
$uri = $_SERVER['REQUEST_URI'] ?? '/';
$path = parse_url($uri, PHP_URL_PATH) ?: '/';
$path = preg_replace('#^/api#', '', $path);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$rawInput = file_get_contents('php://input');
$body = json_decode($rawInput, true) ?: [];

function collectProjectCategories(array $savedCategories, array $projects): array {
    $categories = [];
    foreach ([$savedCategories, $projects] as $records) {
        foreach ($records as $record) {
            $name = trim((string)($record['name'] ?? $record['category'] ?? ''));
            if ($name === '') continue;
            $key = strtolower($name);
            $categories[$key] = $name;
        }
    }
    return array_values($categories);
}

function identityReviewPairKey(string $clientIdA, string $clientIdB): string {
    $ids = [$clientIdA, $clientIdB];
    sort($ids, SORT_STRING);
    return hash('sha256', json_encode($ids, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}

function buildClientIdentityReviews(array $clients, array $savedReviews): array {
    $savedByPair = [];
    foreach ($savedReviews as $saved) {
        $idA = (string)($saved['client_id_a'] ?? '');
        $idB = (string)($saved['client_id_b'] ?? '');
        if ($idA === '' || $idB === '' || $idA === $idB) continue;
        $pairKey = (string)($saved['pair_key'] ?? identityReviewPairKey($idA, $idB));
        $savedByPair[$pairKey] = $saved;
    }

    $groups = [];
    foreach ($clients as $client) {
        if (($client['is_bin'] ?? false) === true || !empty($client['deleted_at'])) continue;
        $clientId = trim((string)($client['id'] ?? ''));
        if ($clientId === '') continue;
        $email = strtolower(trim((string)($client['email'] ?? $client['email_address'] ?? '')));
        $phone = preg_replace('/\D+/', '', (string)($client['phone'] ?? $client['phone_number'] ?? $client['mobile'] ?? ''));
        $identifiers = [];
        if (str_contains($email, '@')) $identifiers[] = ['value' => $email, 'reason' => 'Matching email address'];
        if (strlen($phone) >= 7) $identifiers[] = ['value' => $phone, 'reason' => 'Matching phone number'];
        foreach ($identifiers as $identifier) {
            $key = $identifier['reason'] . ':' . $identifier['value'];
            $groups[$key][] = ['client' => $client, 'reason' => $identifier['reason']];
        }
    }

    $candidates = [];
    foreach ($groups as $group) {
        $count = count($group);
        for ($i = 0; $i < $count; $i++) {
            for ($j = $i + 1; $j < $count; $j++) {
                $first = $group[$i]['client'];
                $second = $group[$j]['client'];
                $firstId = (string)$first['id'];
                $secondId = (string)$second['id'];
                if ($firstId === $secondId) continue;
                if (strcmp($firstId, $secondId) < 0) {
                    $clientA = $first;
                    $clientB = $second;
                } else {
                    $clientA = $second;
                    $clientB = $first;
                }
                $idA = (string)$clientA['id'];
                $idB = (string)$clientB['id'];
                $pairKey = identityReviewPairKey($idA, $idB);
                if (!isset($candidates[$pairKey])) {
                    $saved = $savedByPair[$pairKey] ?? [];
                    $candidates[$pairKey] = array_merge($saved, [
                        'id' => $saved['id'] ?? 'identity_' . $pairKey,
                        'pair_key' => $pairKey,
                        'client_id_a' => $idA,
                        'client_id_b' => $idB,
                        'client_a_name' => $clientA['name'] ?? $clientA['full_name'] ?? '',
                        'client_a_company' => $clientA['company'] ?? '',
                        'client_a_email' => $clientA['email'] ?? $clientA['email_address'] ?? '',
                        'client_a_phone' => $clientA['phone'] ?? $clientA['phone_number'] ?? $clientA['mobile'] ?? '',
                        'client_b_name' => $clientB['name'] ?? $clientB['full_name'] ?? '',
                        'client_b_company' => $clientB['company'] ?? '',
                        'client_b_email' => $clientB['email'] ?? $clientB['email_address'] ?? '',
                        'client_b_phone' => $clientB['phone'] ?? $clientB['phone_number'] ?? $clientB['mobile'] ?? '',
                        'reason' => '',
                        'status' => $saved['status'] ?? 'pending',
                        'created_at' => $saved['created_at'] ?? $clientA['created_at'] ?? $clientB['created_at'] ?? '',
                    ]);
                    $candidates[$pairKey]['reasons'] = [];
                }
                $candidates[$pairKey]['reasons'][] = $group[$i]['reason'];
            }
        }
    }

    foreach ($candidates as $pairKey => &$candidate) {
        $candidate['reason'] = implode(' and ', array_unique($candidate['reasons']));
        unset($candidate['reasons']);
    }
    unset($candidate);

    foreach ($savedByPair as $pairKey => $saved) {
        if (!isset($candidates[$pairKey])) $candidates[$pairKey] = array_merge($saved, ['pair_key' => $pairKey]);
    }
    return array_values($candidates);
}

// Health check
if ($path === '/healthz') {
    $connected = MongoService::ping();
    jsonOut([
        'ok' => $connected,
        'storage' => 'mongodb',
        'database' => MongoService::getDatabaseName(),
        'php_mongodb_extension' => MongoService::isExtensionActive(),
        'connected' => $connected,
        'php_version' => PHP_VERSION,
        'timestamp' => date('c'),
    ], $connected ? 200 : 503);
}

// 1. Public Content
if ($path === '/public/content' || $path === '/content') {
    $projects = MongoService::getCollection('projects');
    $blogs = MongoService::getCollection('blogs');
    $reviews = array_values(array_filter(MongoService::getCollection('reviews'), function(array $review): bool {
        $value = $review['is_published'] ?? false;
        return $value === true || $value === 1
            || (is_string($value) && in_array(strtolower(trim($value)), ['1', 'true', 'published', 'yes'], true));
    }));
    $categories = collectProjectCategories(MongoService::getCollection('project_categories'), $projects);
    jsonOut([
        'ok' => true,
        'storage' => 'mongodb',
        'projects' => $projects,
        'categories' => $categories,
        'blogs' => $blogs,
        'reviews' => $reviews,
        'backlinks' => [],
    ]);
}

// 2. Admin Auth
if ($path === '/admin/login' && $method === 'POST') {
    $email = strtolower(trim((string)($body['email'] ?? '')));
    $password = (string)($body['password'] ?? '');
    $adminEmail = strtolower(trim((string)($config['admin_email'] ?? 'admin@codexdynamics.com')));
    $adminPassword = (string)($config['admin_password'] ?? '');

    $staff = MongoService::findOne('staff_users', ['email' => $email]);
    if (!$staff && $email === $adminEmail) {
        $staff = [
            'id' => 'staff_super_admin',
            'email' => $adminEmail,
            'name' => 'Codex Super Admin',
            'role' => 'super-admin',
            'officeId' => 'off_1',
            'teamId' => 'team_1',
            'status' => 'Active',
            'capabilities' => '["all"]',
        ];
    }
    if (!$staff) {
        jsonOut(['ok' => false, 'error' => 'Staff account not found in MongoDB.'], 401);
    }
    $expectedPassword = $email === $adminEmail
        ? (!empty($staff['password_updated_at']) ? (string)($staff['password'] ?? '') : $adminPassword)
        : (string)($staff['password'] ?? '');
    if ($expectedPassword === '' || !hash_equals($expectedPassword, $password)) {
        jsonOut(['ok' => false, 'error' => 'Invalid staff email or password.'], 401);
    }
    $token = 'cdx_adm_php_mongo_' . $staff['id'] . '_' . time();
    adminSetSessionCookie($token);
    jsonOut([
        'ok' => true,
        'token' => $token,
        'user' => $staff,
    ]);
}

if ($path === '/admin/password-reset/request' && $method === 'POST') {
    $now = time();
    $resetId = 'super-admin';
    $reset = MongoService::findOne('admin_password_reset_tokens', ['id' => $resetId]);
    $requestTimes = array_values(array_filter(
        is_array($reset['request_times'] ?? null) ? $reset['request_times'] : [],
        static fn($timestamp): bool => is_numeric($timestamp) && (int)$timestamp > $now - 3600
    ));
    if (isset($reset['last_sent_at']) && $now - (int)$reset['last_sent_at'] < 60) {
        jsonOut(['ok' => false, 'error' => 'Wait a minute before requesting another reset code.'], 429);
    }
    if (count($requestTimes) >= 5) {
        jsonOut(['ok' => false, 'error' => 'Too many reset requests. Try again in an hour.'], 429);
    }

    $adminEmail = strtolower(trim((string)($config['admin_email'] ?? 'admin@codexdynamics.com')));
    $staff = MongoService::findOne('staff_users', ['email' => $adminEmail]);
    $role = strtolower((string)(preg_replace('/[\s_-]+/', '', (string)($staff['role'] ?? 'superadmin')) ?? ''));
    if (($staff !== null && $role !== 'superadmin')
        || ($staff['status'] ?? '') === 'Suspended'
        || !empty($staff['deleted_at']) || ($staff['is_bin'] ?? false) === true) {
        jsonOut(['ok' => true, 'message' => 'If the Super Admin account is available, a reset code has been sent.']);
    }

    $integration = hostingerMailIntegration();
    $token = trim((string)($integration['token'] ?? ''));
    if ($token === '') {
        jsonOut(['ok' => false, 'error' => 'Password recovery email is not configured.'], 503);
    }
    $mailboxes = hostingerMailMailboxList($integration);
    $sender = null;
    foreach ($mailboxes as $mailbox) {
        $address = strtolower(trim((string)($mailbox['address'] ?? $mailbox['email'] ?? $mailbox['emailAddress'] ?? '')));
        if ($address === 'support@codexdynamics.com') {
            $sender = $mailbox;
            break;
        }
        if ($sender === null) $sender = $mailbox;
    }
    $resourceId = trim((string)($sender['resourceId'] ?? $sender['id'] ?? $sender['mailboxId'] ?? ''));
    if ($resourceId === '') {
        jsonOut(['ok' => false, 'error' => 'No sender mailbox is available for password recovery.'], 503);
    }
    if ($mongoUri === '') {
        jsonOut(['ok' => false, 'error' => 'Password recovery is unavailable.'], 503);
    }

    $code = (string)random_int(10000000, 99999999);
    $record = [
        'id' => $resetId,
        'code_hash' => hash_hmac('sha256', $code, $mongoUri),
        'expires_at' => $now + 600,
        'attempts' => 0,
        'active' => false,
        'last_sent_at' => $now,
        'request_times' => array_merge($requestTimes, [$now]),
    ];
    if ($reset === null) MongoService::insert('admin_password_reset_tokens', $record);
    else MongoService::updateOne('admin_password_reset_tokens', ['id' => $resetId], $record);

    hostingerMailApiRequestMethod(
        $token,
        '/api/v1/mailboxes/' . rawurlencode($resourceId) . '/send',
        'POST',
        [
            'to' => ['codexdynamix@gmail.com'],
            'subject' => 'Codex Dynamics Super Admin password reset',
            'text' => "Your Super Admin password reset code is {$code}. It expires in 10 minutes. If you did not request this reset, ignore this email.",
        ]
    );
    MongoService::updateOne('admin_password_reset_tokens', ['id' => $resetId], ['active' => true]);
    jsonOut(['ok' => true, 'message' => 'If the Super Admin account is available, a reset code has been sent.']);
}

if ($path === '/admin/password-reset/complete' && $method === 'POST') {
    $code = trim((string)($body['code'] ?? ''));
    $password = (string)($body['password'] ?? '');
    if (!preg_match('/^\d{8}$/', $code)) {
        jsonOut(['ok' => false, 'error' => 'Enter the 8-digit reset code from the recovery email.'], 422);
    }
    if (strlen($password) < 8 || strlen($password) > 128) {
        jsonOut(['ok' => false, 'error' => 'The new password must be between 8 and 128 characters.'], 422);
    }

    $resetId = 'super-admin';
    $challenge = MongoService::findOne('admin_password_reset_tokens', ['id' => $resetId]);
    if ($challenge === null || ($challenge['active'] ?? false) !== true
        || (int)($challenge['expires_at'] ?? 0) < time()) {
        jsonOut(['ok' => false, 'error' => 'The reset code is invalid or expired. Request a new code.'], 400);
    }
    if ((int)($challenge['attempts'] ?? 0) >= 5) {
        jsonOut(['ok' => false, 'error' => 'Too many incorrect codes. Request a new reset code.'], 429);
    }
    $providedHash = hash_hmac('sha256', $code, $mongoUri);
    if (!hash_equals((string)($challenge['code_hash'] ?? ''), $providedHash)) {
        MongoService::updateOne('admin_password_reset_tokens', ['id' => $resetId], [
            'attempts' => (int)($challenge['attempts'] ?? 0) + 1,
        ]);
        jsonOut(['ok' => false, 'error' => 'The reset code is invalid or expired.'], 400);
    }

    $adminEmail = strtolower(trim((string)($config['admin_email'] ?? 'admin@codexdynamics.com')));
    $staff = MongoService::findOne('staff_users', ['email' => $adminEmail]);
    $role = strtolower((string)(preg_replace('/[\s_-]+/', '', (string)($staff['role'] ?? '')) ?? ''));
    if ($staff !== null && $role !== 'superadmin') {
        MongoService::deleteOne('admin_password_reset_tokens', ['id' => $resetId]);
        jsonOut(['ok' => false, 'error' => 'The Super Admin account is unavailable.'], 400);
    }
    $staffId = (string)($staff['id'] ?? 'staff_super_admin');
    if ($staff === null) {
        MongoService::insert('staff_users', [
            'id' => $staffId,
            'email' => $adminEmail,
            'name' => 'Codex Super Admin',
            'role' => 'super-admin',
            'status' => 'Active',
            'capabilities' => '["all"]',
            'password' => $password,
            'password_updated_at' => date('c'),
        ]);
    } else {
        MongoService::updateOne('staff_users', ['id' => $staffId], [
            'password' => $password,
            'password_updated_at' => date('c'),
        ]);
    }
    MongoService::deleteOne('admin_password_reset_tokens', ['id' => $resetId]);
    jsonOut(['ok' => true, 'message' => 'Super Admin password reset successfully.']);
}

if ($path === '/admin/me') {
    $staff = chatStaffFromRequest();
    unset($staff['password'], $staff['password_hash'], $staff['password_reset_token']);
    jsonOut(['ok' => true, 'user' => $staff]);
}

if ($path === '/admin/logout') {
    $identity = adminSessionIdentityFromRequest();
    if ($identity !== null) {
        MongoService::updateOne('live_sessions', ['id' => $identity['id']], [
            'revoked' => true,
            'is_online' => false,
            'logged_out_at' => date('c'),
        ]);
    }
    adminClearSessionCookie();
    jsonOut(['ok' => true]);
}

if ($path === '/admin/presence' && $method === 'POST') {
    $staff = chatStaffFromRequest();
    $identity = adminSessionIdentityFromRequest();
    if ($identity === null) jsonOut(['ok' => false, 'error' => 'A valid staff session is required.'], 401);
    $existing = MongoService::findOne('live_sessions', ['id' => $identity['id']]);
    if (($existing['revoked'] ?? false) === true) {
        jsonOut(['ok' => false, 'error' => 'This staff session has been terminated. Sign in again.'], 401);
    }
    $page = substr((string)($body['page'] ?? '/admin'), 0, 300);
    $visits = is_array($existing['page_visits'] ?? null) ? $existing['page_visits'] : [];
    if (!$visits || ($visits[count($visits) - 1]['page'] ?? '') !== $page) {
        $visits[] = ['page' => $page, 'visited_at' => date('c')];
    }
    $headers = function_exists('getallheaders') ? getallheaders() : [];
    MongoService::updateOneWithOptions('live_sessions', ['id' => $identity['id']], [
        'user_type' => 'admin',
        'admin_id' => (string)$staff['id'],
        'user_id' => (string)$staff['id'],
        'display_name' => (string)($staff['name'] ?? $staff['full_name'] ?? $staff['display_name'] ?? 'Staff member'),
        'display_email' => (string)($staff['email'] ?? ''),
        'role' => (string)($staff['role'] ?? 'Staff'),
        'current_page' => $page,
        'last_seen_at' => date('c'),
        'is_online' => true,
        'ip' => (string)($_SERVER['REMOTE_ADDR'] ?? ''),
        'user_agent' => substr((string)($_SERVER['HTTP_USER_AGENT'] ?? $headers['User-Agent'] ?? ''), 0, 500),
        'page_visits' => array_slice($visits, -100),
        'logged_in_at' => date('c', (int)floor($identity['issued_at'] / 1000)),
        'revoked' => false,
    ], ['upsert' => true]);
    $cutoff = date('c', time() - 90);
    $activeCount = MongoService::countDocuments('live_sessions', [
        'last_seen_at' => ['$gte' => $cutoff],
        'revoked' => ['$ne' => true],
    ]);
    jsonOut(['ok' => true, 'activeUsers' => $activeCount]);
}

if ($path === '/admin/status' && $method === 'GET') {
    chatStaffFromRequest();
    $startedAt = microtime(true);
    $cutoff = date('c', time() - 90);
    $activeFilter = [
        'last_seen_at' => ['$gte' => $cutoff],
        'revoked' => ['$ne' => true],
        'hidden' => ['$ne' => true],
    ];
    $onlineStaff = MongoService::countDocuments('live_sessions', $activeFilter + ['user_type' => 'admin']);
    $onlineClients = MongoService::countDocuments('live_sessions', $activeFilter + ['user_type' => 'client']);
    $portalLogins = MongoService::countDocuments('live_sessions', [
        'user_type' => 'client',
        'logged_in_at' => ['$gte' => date('c', strtotime('today'))],
        'hidden' => ['$ne' => true],
    ]);
    jsonOut([
        'ok' => true,
        'online_total' => $onlineStaff + $onlineClients,
        'online_staff' => $onlineStaff,
        'online_clients' => $onlineClients,
        'visitor_today' => $portalLogins,
        'db_ms' => (int)round((microtime(true) - $startedAt) * 1000),
    ]);
}

if ($path === '/admin/sessions' && $method === 'GET') {
    requireSessionSuperAdminFromRequest();
    $filter = ['hidden' => ['$ne' => true]];
    $type = (string)($_GET['type'] ?? '');
    if ($type === 'admin' || $type === 'client') $filter['user_type'] = $type;
    $rows = MongoService::getCollection('live_sessions', $filter, 200, 0, ['last_seen_at' => -1]);
    $sessions = array_map('sessionApiRow', $rows);
    jsonOut(['ok' => true, 'sessions' => $sessions, 'total' => count($sessions), 'total_pages' => 1]);
}

if (preg_match('#^/admin/sessions/([^/]+)(?:/(logout))?$#', $path, $matches)) {
    $staff = requireSessionSuperAdminFromRequest();
    $sessionId = rawurldecode($matches[1]);
    $isLogout = ($matches[2] ?? '') === 'logout';
    if ($isLogout && $method === 'POST') {
        $result = MongoService::updateOne('live_sessions', ['id' => $sessionId, 'hidden' => ['$ne' => true]], [
            'revoked' => true,
            'is_online' => false,
            'logged_out_at' => date('c'),
            'terminated_by' => (string)$staff['id'],
        ]);
        if ($result === 0) jsonOut(['ok' => false, 'error' => 'Session not found.'], 404);
        jsonOut(['ok' => true]);
    }
    if (!$isLogout && $method === 'DELETE') {
        $result = MongoService::updateOne('live_sessions', ['id' => $sessionId, 'hidden' => ['$ne' => true]], [
            'revoked' => true,
            'hidden' => true,
            'is_online' => false,
            'logged_out_at' => date('c'),
            'terminated_by' => (string)$staff['id'],
        ]);
        if ($result === 0) jsonOut(['ok' => false, 'error' => 'Session not found.'], 404);
        jsonOut(['ok' => true]);
    }
    if (!$isLogout && $method === 'GET') {
        $row = MongoService::findOne('live_sessions', ['id' => $sessionId, 'hidden' => ['$ne' => true]]);
        if ($row === null) jsonOut(['ok' => false, 'error' => 'Session not found.'], 404);
        $relatedId = (string)($row['user_id'] ?? $row['admin_id'] ?? $row['client_id'] ?? '');
        $related = $relatedId === '' ? [$row] : MongoService::getCollection('live_sessions', ['user_id' => $relatedId], 50, 0, ['last_seen_at' => -1]);
        $durationTotal = 0;
        $pageCounts = [];
        foreach ($related as $relatedSession) {
            $durationTotal += max(0, sessionApiTimestamp($relatedSession['last_seen_at'] ?? null) - sessionApiTimestamp($relatedSession['logged_in_at'] ?? null));
            foreach (($relatedSession['page_visits'] ?? []) as $visit) {
                $visitedPage = (string)($visit['page'] ?? '');
                if ($visitedPage !== '') $pageCounts[$visitedPage] = ($pageCounts[$visitedPage] ?? 0) + 1;
            }
        }
        arsort($pageCounts);
        $topPages = [];
        foreach (array_slice($pageCounts, 0, 10, true) as $page => $visits) {
            $topPages[] = ['page' => $page, 'visits' => $visits];
        }
        $sessionCount = count($related) ?: 1;
        jsonOut([
            'ok' => true,
            'session' => sessionApiRow($row),
            'stats' => ['total_sessions' => $sessionCount, 'avg_duration_sec' => (int)floor($durationTotal / $sessionCount), 'total_time_sec' => $durationTotal],
            'page_visits' => array_reverse($row['page_visits'] ?? []),
            'top_pages' => $topPages,
            'all_sessions' => array_map('sessionApiRow', $related),
        ]);
    }
}

if ($path === '/admin/sessions' && $method === 'DELETE') {
    $staff = requireSessionSuperAdminFromRequest();
    $ids = array_values(array_filter(array_map('strval', is_array($body['ids'] ?? null) ? $body['ids'] : [])));
    $ids = array_slice($ids, 0, 200);
    if (!$ids) jsonOut(['ok' => false, 'error' => 'Select at least one session.'], 400);
    $terminated = MongoService::updateMany('live_sessions', [
        'id' => ['$in' => $ids],
        'hidden' => ['$ne' => true],
    ], [
        'revoked' => true,
        'hidden' => true,
        'is_online' => false,
        'logged_out_at' => date('c'),
        'terminated_by' => (string)$staff['id'],
    ]);
    jsonOut(['ok' => true, 'terminated' => $terminated]);
}

// 3. Admin Clients
if (str_starts_with($path, '/admin/clients')) {
    chatStaffFromRequest();
}

function clientListAssignedFields(array $fields): array {
    return ['$or' => array_map(
        static fn(string $field): array => [$field => ['$exists' => true, '$nin' => [null, '']]],
        $fields
    )];
}

function clientListUnassignedFields(array $fields): array {
    return ['$nor' => array_map(
        static fn(string $field): array => [$field => ['$exists' => true, '$nin' => [null, '']]],
        $fields
    )];
}

function clientListFieldMatch(array $fields, string $value): array {
    return ['$or' => array_map(
        static fn(string $field): array => [$field => $value],
        $fields
    )];
}

function clientAssignmentUpdates(array $source): array {
    $aliases = [
        'assignedToOffice' => ['assigned_office_id', 'assignedToOffice', 'officeId'],
        'assignedToTeam' => ['assigned_team_id', 'assignedToTeam', 'teamId'],
        'assignedToTeamLeader' => ['assigned_team_leader_id', 'assignedToTeamLeader', 'teamLeaderId'],
        'assignedToAgent' => ['assigned_agent_id', 'assignedToAgent', 'agentId'],
    ];
    $updates = [];
    foreach ($aliases as $field => $keys) {
        foreach ($keys as $key) {
            if (!array_key_exists($key, $source)) continue;
            $value = $source[$key];
            if ($value !== null && !is_string($value)) {
                jsonOut(['ok' => false, 'error' => "Invalid {$key} assignment value."], 422);
            }
            $value = is_string($value) ? trim($value) : null;
            $updates[$field] = $value === '' ? null : $value;
            break;
        }
    }
    return $updates;
}

if (preg_match('#^/admin/clients/([^/]+)/assign$#', $path, $matches) && $method === 'POST') {
    $clientId = rawurldecode($matches[1]);
    $client = MongoService::findOne('clients', ['id' => $clientId]);
    if ($client === null) jsonOut(['ok' => false, 'error' => 'Client not found.'], 404);
    $updates = clientAssignmentUpdates($body);
    if (!$updates) jsonOut(['ok' => false, 'error' => 'At least one client assignment field is required.'], 422);
    MongoService::updateOne('clients', ['id' => $clientId], $updates);
    jsonOut(['ok' => true, 'client' => MongoService::findOne('clients', ['id' => $clientId])]);
}

if ($path === '/admin/clients/assign-bulk' && $method === 'POST') {
    if (isset($body['assignments']) && is_array($body['assignments'])) {
        $rawAssignments = $body['assignments'];
    } else {
        $clientIds = $body['client_ids'] ?? $body['clientIds'] ?? [];
        if (!is_array($clientIds)) {
            jsonOut(['ok' => false, 'error' => 'Client IDs must be an array.'], 422);
        }
        $rawAssignments = array_map(
            static fn($clientId) => ['client_id' => $clientId] + $body,
            $clientIds
        );
    }
    if (!$rawAssignments) jsonOut(['ok' => false, 'error' => 'At least one client assignment is required.'], 422);

    $assignments = [];
    foreach ($rawAssignments as $entry) {
        if (!is_array($entry)) {
            jsonOut(['ok' => false, 'error' => 'Each client assignment must be an object.'], 422);
        }
        $clientId = trim((string)($entry['client_id'] ?? $entry['clientId'] ?? ''));
        if ($clientId === '') jsonOut(['ok' => false, 'error' => 'Each client assignment must include a client ID.'], 422);
        $updates = clientAssignmentUpdates($entry);
        if (!$updates) jsonOut(['ok' => false, 'error' => "Assignment for client {$clientId} has no supported fields."], 422);
        $assignments[$clientId] = $updates;
    }

    $existingClients = [];
    foreach (array_keys($assignments) as $clientId) {
        $client = MongoService::findOne('clients', ['id' => $clientId]);
        if ($client === null) jsonOut(['ok' => false, 'error' => "Client not found: {$clientId}."], 404);
        $existingClients[$clientId] = $client;
    }
    foreach ($assignments as $clientId => $updates) {
        MongoService::updateOne('clients', ['id' => $clientId], $updates);
    }
    $updatedClients = [];
    foreach (array_keys($assignments) as $clientId) {
        $updatedClients[] = MongoService::findOne('clients', ['id' => $clientId]);
    }
    jsonOut(['ok' => true, 'clients' => $updatedClients]);
}

if ($path === '/admin/clients' && $method === 'GET') {
    $includeDeleted = (string)($_GET['include_deleted'] ?? '');
    if ($includeDeleted === '1') {
        $filter = [];
    } elseif ($includeDeleted === 'only') {
        $filter = ['$or' => [
            ['is_bin' => true],
            ['deleted_at' => ['$exists' => true, '$nin' => [null, '']]],
        ]];
    } else {
        $filter = [
            'is_bin' => ['$in' => [false, null]],
            'deleted_at' => ['$in' => [null, '']],
        ];
    }

    $search = substr(trim((string)($_GET['search'] ?? '')), 0, 120);
    $stage = trim((string)($_GET['stage'] ?? ''));
    $officeId = trim((string)($_GET['office_id'] ?? ''));
    $teamId = trim((string)($_GET['team_id'] ?? ''));
    $teamLeaderId = trim((string)($_GET['team_leader_id'] ?? ''));
    $agentId = trim((string)($_GET['agent_id'] ?? ''));
    $ownership = trim((string)($_GET['ownership'] ?? ''));
    $clauses = [$filter];
    if ($search !== '') {
        $pattern = preg_quote($search, '/');
        $clauses[] = ['$or' => array_map(
            static fn(string $field): array => [$field => ['$regex' => $pattern, '$options' => 'i']],
            ['name', 'first_name', 'firstName', 'last_name', 'lastName', 'email', 'phone', 'country']
        )];
    }
    if ($stage !== '') $clauses[] = ['$or' => [['stage' => $stage], ['status' => $stage]]];
    if ($officeId !== '') $clauses[] = clientListFieldMatch(['assignedToOffice', 'assigned_office_id', 'officeId', 'office_id'], $officeId);
    if ($teamId !== '') $clauses[] = clientListFieldMatch(['assignedToTeam', 'assigned_team_id', 'teamId', 'team_id'], $teamId);
    if ($teamLeaderId !== '') $clauses[] = clientListFieldMatch(['assignedToTeamLeader', 'assigned_team_leader_id', 'teamLeaderId', 'team_leader_id'], $teamLeaderId);
    if ($agentId !== '') $clauses[] = clientListFieldMatch(['assignedToAgent', 'assigned_agent_id', 'agentId', 'agent_id'], $agentId);

    $officeFields = ['assignedToOffice', 'assigned_office_id', 'officeId', 'office_id'];
    $teamFields = ['assignedToTeam', 'assigned_team_id', 'teamId', 'team_id'];
    $leaderFields = ['assignedToTeamLeader', 'assigned_team_leader_id', 'teamLeaderId', 'team_leader_id'];
    $agentFields = ['assignedToAgent', 'assigned_agent_id', 'agentId', 'agent_id'];
    if (($_GET['unassigned_only'] ?? '') === '1') {
        $clauses[] = clientListUnassignedFields([...$officeFields, ...$teamFields, ...$leaderFields, ...$agentFields]);
    }
    if ($ownership === 'team-leader-owned') {
        $clauses[] = clientListAssignedFields($leaderFields);
    } elseif ($ownership === 'office-only') {
        $clauses[] = clientListUnassignedFields([...$teamFields, ...$leaderFields, ...$agentFields]);
        $clauses[] = clientListAssignedFields($officeFields);
    } elseif ($ownership === 'team-no-agent') {
        $clauses[] = clientListUnassignedFields($agentFields);
        $clauses[] = clientListAssignedFields($teamFields);
    } elseif ($ownership === 'agent-assigned') {
        $clauses[] = clientListAssignedFields($agentFields);
    } elseif ($ownership === 'unassigned') {
        $clauses[] = clientListUnassignedFields([...$officeFields, ...$teamFields, ...$leaderFields, ...$agentFields]);
    }
    $filter = ['$and' => $clauses];

    $limit = min(max((int)($_GET['limit'] ?? 50), 1), 100);
    $offset = max((int)($_GET['offset'] ?? 0), 0);
    $projection = [];
    if (($_GET['fields'] ?? '') === 'table') {
        $projection = array_fill_keys([
            'id',
            'name',
            'firstName',
            'first_name',
            'lastName',
            'last_name',
            'email',
            'country',
            'country_code',
            'status',
            'stage',
            'funnel',
            'affiliate',
            'assignedToOffice',
            'assigned_office_id',
            'assignedToTeam',
            'assigned_team_id',
            'assignedToTeamLeader',
            'assigned_team_leader_id',
            'assignedToAgent',
            'assigned_agent_id',
            'last_comment_date',
            'registered_date',
            'created_at',
            'createdAt',
            'deleted_at',
            'deletedAt',
            'is_bin',
        ], 1);
    } elseif (($_GET['fields'] ?? '') === 'summary') {
        $projection = array_fill_keys([
            'id',
            'name',
            'firstName',
            'first_name',
            'lastName',
            'last_name',
            'email',
            'phone',
            'country',
            'country_code',
            'status',
            'stage',
            'funnel',
            'affiliate',
            'assignedToOffice',
            'assigned_office_id',
            'assignedToTeam',
            'assigned_team_id',
            'assignedToTeamLeader',
            'assigned_team_leader_id',
            'assignedToAgent',
            'assigned_agent_id',
            'assigned_agent_name',
            'portalEnabled',
            'portal_enabled',
            'portalStatus',
            'portal_status',
            'assignedBy',
            'assigned_by',
            'last_comment_date',
            'registered_date',
            'created_at',
            'createdAt',
            'updated_at',
            'deleted_at',
            'deletedAt',
            'is_bin',
            'company',
            'service',
            'budget',
            'timeline',
            'message',
            'source',
            'notes',
            'comment_history',
            'commentHistory',
            'status_history',
            'statusHistory',
            'appointments',
            'enquiry_id',
            'enquiryId',
        ], 1);
    }
    $queryStartedAt = microtime(true);
    $clients = MongoService::getCollection('clients', $filter, $limit + 1, $offset, ['_id' => -1], $projection);
    header('Server-Timing: mongodb;dur=' . number_format((microtime(true) - $queryStartedAt) * 1000, 2, '.', ''));
    $hasMore = count($clients) > $limit;
    if ($hasMore) array_pop($clients);
    jsonOut([
        'ok' => true,
        'clients' => $clients,
        'total' => $hasMore ? null : $offset + count($clients),
        'limit' => $limit,
        'offset' => $offset,
        'hasMore' => $hasMore,
        'has_more' => $hasMore,
    ]);
}

if ($path === '/admin/client-identity-reviews' && $method === 'GET') {
    $staff = chatStaffFromRequest();
    $role = strtolower((string)(preg_replace('/[\s_-]+/', '', (string)($staff['role'] ?? '')) ?? ''));
    if ($role !== 'superadmin') jsonOut(['ok' => false, 'error' => 'Only Super Admin can review client identities.'], 403);

    $status = strtolower(trim((string)($_GET['status'] ?? 'pending')));
    if (!in_array($status, ['pending', 'distinct', 'merged', 'all'], true)) {
        jsonOut(['ok' => false, 'error' => 'Choose pending, distinct, merged, or all reviews.'], 422);
    }
    $clients = MongoService::getCollection('clients', [
        '$and' => [
            ['is_bin' => ['$ne' => true]],
            ['$or' => [
                ['deleted_at' => ['$exists' => false]],
                ['deleted_at' => null],
                ['deleted_at' => ''],
            ]],
        ],
    ], 10000);
    $reviews = array_values(array_filter(
        buildClientIdentityReviews($clients, MongoService::getCollection('client_identity_reviews', [], 10000)),
        fn(array $review): bool => $status === 'all' || ($review['status'] ?? 'pending') === $status
    ));
    jsonOut(['ok' => true, 'reviews' => $reviews, 'clients_scanned' => count($clients)]);
}

if (preg_match('#^/admin/client-identity-reviews/([^/]+)/([^/]+)$#', $path, $matches) && $method === 'POST') {
    $staff = chatStaffFromRequest();
    $role = strtolower((string)(preg_replace('/[\s_-]+/', '', (string)($staff['role'] ?? '')) ?? ''));
    if ($role !== 'superadmin') jsonOut(['ok' => false, 'error' => 'Only Super Admin can resolve client identity reviews.'], 403);

    $decision = strtolower(trim((string)($body['decision'] ?? '')));
    if ($decision === 'merge') {
        jsonOut([
            'ok' => false,
            'error' => 'Client merging is unavailable here because related client records cannot yet be transferred safely.',
        ], 422);
    }
    if ($decision !== 'distinct') jsonOut(['ok' => false, 'error' => 'Choose a supported identity review decision.'], 422);

    $clientIdA = rawurldecode($matches[1]);
    $clientIdB = rawurldecode($matches[2]);
    if ($clientIdA === '' || $clientIdB === '' || $clientIdA === $clientIdB) {
        jsonOut(['ok' => false, 'error' => 'Choose two different client records.'], 422);
    }
    $pairKey = identityReviewPairKey($clientIdA, $clientIdB);
    $clients = MongoService::getCollection('clients', [
        'id' => ['$in' => [$clientIdA, $clientIdB]],
        '$and' => [
            ['is_bin' => ['$ne' => true]],
            ['$or' => [
                ['deleted_at' => ['$exists' => false]],
                ['deleted_at' => null],
                ['deleted_at' => ''],
            ]],
        ],
    ], 10);
    $savedReviews = MongoService::getCollection('client_identity_reviews', ['pair_key' => $pairKey], 10);
    $candidate = null;
    foreach (buildClientIdentityReviews($clients, $savedReviews) as $review) {
        if (($review['pair_key'] ?? '') === $pairKey) {
            $candidate = $review;
            break;
        }
    }
    if ($candidate === null) jsonOut(['ok' => false, 'error' => 'This client pair is no longer an active identity review.'], 404);

    $review = array_merge($candidate, [
        'status' => 'distinct',
        'decision' => 'distinct',
        'resolved_at' => date('c'),
        'resolved_by' => (string)($staff['id'] ?? ''),
    ]);
    MongoService::updateOneWithOptions('client_identity_reviews', ['pair_key' => $pairKey], $review, ['upsert' => true]);
    jsonOut(['ok' => true, 'review' => $review]);
}

if (str_starts_with($path, '/admin/clients/search')) {
    $q = substr(trim((string)($_GET['q'] ?? '')), 0, 120);
    $filter = [
        '$and' => [
            ['is_bin' => ['$in' => [false, null]]],
            ['deleted_at' => ['$in' => [null, '']]],
        ],
    ];
    if ($q !== '') {
        $pattern = preg_quote($q, '/');
        $filter['$and'][] = ['$or' => array_map(
            static fn(string $field): array => [$field => ['$regex' => $pattern, '$options' => 'i']],
            ['id', 'name', 'first_name', 'firstName', 'last_name', 'lastName', 'company', 'email', 'phone', 'country']
        )];
    }
    $limit = min(max((int)($_GET['limit'] ?? 8), 1), 20);
    $projection = array_fill_keys([
        'id', 'name', 'firstName', 'first_name', 'lastName', 'last_name',
        'company', 'email', 'phone', 'country', 'country_code',
    ], 1);
    $queryStartedAt = microtime(true);
    $clients = MongoService::getCollection('clients', $filter, $limit, 0, ['_id' => -1], $projection);
    header('Server-Timing: mongodb;dur=' . number_format((microtime(true) - $queryStartedAt) * 1000, 2, '.', ''));
    jsonOut(['ok' => true, 'clients' => $clients]);
}

if (preg_match('#^/admin/clients/([^/]+)/mailboxes(?:/([^/]+))?$#', $path, $matches)) {
    $clientId = rawurldecode($matches[1]);
    $assignmentId = isset($matches[2]) ? rawurldecode($matches[2]) : null;
    $client = MongoService::findOne('clients', ['id' => $clientId]);
    if ($client === null || !hostingerMailClientIsActive($client)) {
        jsonOut(['ok' => false, 'error' => 'Client not found.'], 404);
    }

    if ($assignmentId === null && $method === 'GET') {
        $assignments = MongoService::getCollection('client_mailboxes', ['clientId' => $clientId], 1000);
        jsonOut([
            'ok' => true,
            'mailboxes' => array_map(
                static fn(array $assignment): array => hostingerMailAssignmentResponse($assignment, $client),
                $assignments
            ),
        ]);
    }

    if ($assignmentId === null && $method === 'POST') {
        $providerMailboxId = trim((string)($body['providerMailboxId'] ?? ''));
        if ($providerMailboxId === '') {
            jsonOut(['ok' => false, 'error' => 'Choose a Hostinger mailbox to assign.'], 422);
        }
        $providerMailboxes = hostingerMailMailboxList(hostingerMailIntegration());
        $providerMailbox = null;
        foreach ($providerMailboxes as $mailbox) {
            if ((string)($mailbox['resourceId'] ?? '') === $providerMailboxId) {
                $providerMailbox = $mailbox;
                break;
            }
        }
        if ($providerMailbox === null) {
            jsonOut(['ok' => false, 'error' => 'That mailbox is not available in the connected Hostinger account. Sync mailboxes and try again.'], 422);
        }
        $existing = MongoService::findOne('client_mailboxes', ['providerMailboxId' => $providerMailboxId]);
        if ($existing !== null) {
            jsonOut(['ok' => false, 'error' => 'This Hostinger mailbox is already assigned to a client.'], 409);
        }
        $emailAddress = (string)($providerMailbox['address'] ?? '');
        $now = date('c');
        $assignment = MongoService::insert('client_mailboxes', [
            'id' => 'mail_assignment_' . bin2hex(random_bytes(8)),
            'clientId' => $clientId,
            'providerMailboxId' => $providerMailboxId,
            'emailAddress' => $emailAddress,
            'displayName' => trim((string)($body['displayName'] ?? '')) ?: $emailAddress,
            'enabled' => ($body['enabled'] ?? true) === true,
            'createdAt' => $now,
            'updatedAt' => $now,
        ]);
        jsonOut([
            'ok' => true,
            'mailbox' => hostingerMailAssignmentResponse($assignment, $client),
        ], 201);
    }

    if ($assignmentId !== null && $method === 'PATCH') {
        $assignment = MongoService::findOne('client_mailboxes', [
            'id' => $assignmentId,
            'clientId' => $clientId,
        ]);
        if ($assignment === null) {
            jsonOut(['ok' => false, 'error' => 'Mailbox assignment not found.'], 404);
        }
        $updates = [];
        if (array_key_exists('displayName', $body)) {
            $displayName = trim((string)$body['displayName']);
            if ($displayName === '' || strlen($displayName) > 191) {
                jsonOut(['ok' => false, 'error' => 'Display name must be between 1 and 191 characters.'], 422);
            }
            $updates['displayName'] = $displayName;
        }
        if (array_key_exists('enabled', $body)) {
            if (!is_bool($body['enabled'])) {
                jsonOut(['ok' => false, 'error' => 'Portal access must be true or false.'], 422);
            }
            $updates['enabled'] = $body['enabled'];
        }
        if (!$updates) {
            jsonOut(['ok' => false, 'error' => 'No supported mailbox assignment changes were provided.'], 422);
        }
        $updates['updatedAt'] = date('c');
        MongoService::updateOne('client_mailboxes', [
            'id' => $assignmentId,
            'clientId' => $clientId,
        ], $updates);
        $updated = MongoService::findOne('client_mailboxes', ['id' => $assignmentId]);
        jsonOut([
            'ok' => true,
            'mailbox' => hostingerMailAssignmentResponse($updated ?: $assignment, $client),
        ]);
    }

    if ($assignmentId !== null && $method === 'DELETE') {
        $deleted = MongoService::deleteOne('client_mailboxes', [
            'id' => $assignmentId,
            'clientId' => $clientId,
        ]);
        if ($deleted === 0) {
            jsonOut(['ok' => false, 'error' => 'Mailbox assignment not found.'], 404);
        }
        jsonOut(['ok' => true, 'removed' => 1]);
    }
}

if (preg_match('#^/admin/client-mailboxes/([^/]+)/reassign$#', $path, $matches) && $method === 'POST') {
    $assignmentId = rawurldecode($matches[1]);
    $targetClientId = trim((string)($body['targetClientId'] ?? ''));
    if ($targetClientId === '' || ($body['confirmed'] ?? false) !== true) {
        jsonOut(['ok' => false, 'error' => 'Choose a target client and confirm the transfer.'], 422);
    }
    $target = MongoService::findOne('clients', ['id' => $targetClientId]);
    if ($target === null || !hostingerMailClientIsActive($target)) {
        jsonOut(['ok' => false, 'error' => 'Target client not found.'], 404);
    }
    $assignment = MongoService::findOne('client_mailboxes', ['id' => $assignmentId]);
    if ($assignment === null) {
        jsonOut(['ok' => false, 'error' => 'Mailbox assignment not found.'], 404);
    }
    if (MongoService::updateOne('client_mailboxes', ['id' => $assignmentId], [
        'clientId' => $targetClientId,
        'displayName' => trim((string)($body['displayName'] ?? $assignment['displayName'] ?? $assignment['emailAddress'] ?? '')),
        'updatedAt' => date('c'),
    ]) === 0) {
        jsonOut(['ok' => false, 'error' => 'Mailbox assignment could not be transferred.'], 409);
    }
    $updated = MongoService::findOne('client_mailboxes', ['id' => $assignmentId]);
    jsonOut([
        'ok' => true,
        'mailbox' => hostingerMailAssignmentResponse($updated ?: $assignment, $target),
    ]);
}

if (preg_match('#^/admin/clients/([^/]+)/access$#', $path, $accessMatch)) {
    $staff = chatStaffFromRequest();
    $clientId = rawurldecode($accessMatch[1]);
    if (MongoService::findOne('clients', ['id' => $clientId]) === null) {
        jsonOut(['ok' => false, 'error' => 'Client not found.'], 404);
    }
    $role = strtolower((string)(preg_replace('/[\s_-]+/', '', (string)($staff['role'] ?? '')) ?? ''));
    if ($role !== 'superadmin') {
        $permissionRecord = MongoService::findOne('client_profile_permissions', ['clientId' => $clientId]);
        $permissions = $permissionRecord['permissions'] ?? [];
        if (is_object($permissions)) $permissions = (array)$permissions;
        $accessPermission = is_array($permissions) ? (string)($permissions['access'] ?? '') : '';
        $allowed = $method === 'GET'
            ? in_array($accessPermission, ['read', 'edit'], true)
            : $method === 'PUT' && $accessPermission === 'edit';
        if (!$allowed) {
            jsonOut(['ok' => false, 'error' => 'You do not have permission to manage this client access section.'], 403);
        }
    }
    $record = MongoService::findOne('client_access', ['clientId' => $clientId]);
    if ($method === 'GET') {
        $access = $record === null ? null : [
            'websiteUrl' => (string)($record['websiteUrl'] ?? ''),
            'publicWebsiteUrl' => (string)($record['publicWebsiteUrl'] ?? ''),
            'websiteUsername' => (string)($record['websiteUsername'] ?? ''),
            'emailAddress' => (string)($record['emailAddress'] ?? ''),
            'webmailUrl' => (string)($record['webmailUrl'] ?? ''),
            'imapHost' => (string)($record['imapHost'] ?? 'imap.hostinger.com'),
            'imapPort' => (int)($record['imapPort'] ?? 993),
            'smtpHost' => (string)($record['smtpHost'] ?? 'smtp.hostinger.com'),
            'smtpPort' => (int)($record['smtpPort'] ?? 465),
            'hasWebsitePassword' => !empty($record['websitePassword']),
            'hasEmailPassword' => !empty($record['emailPassword']),
        ];
        jsonOut(['ok' => true, 'access' => $access]);
    }
    if ($method !== 'PUT') jsonOut(['ok' => false, 'error' => 'Method not allowed.'], 405);

    $updates = [];
    foreach (['websiteUrl', 'publicWebsiteUrl', 'websiteUsername', 'emailAddress', 'webmailUrl', 'imapHost', 'smtpHost'] as $field) {
        $value = trim((string)($body[$field] ?? ''));
        if (strlen($value) > 500) jsonOut(['ok' => false, 'error' => "{$field} is too long."], 422);
        $updates[$field] = $value;
    }
    foreach (['websiteUrl', 'publicWebsiteUrl', 'webmailUrl'] as $field) {
        if ($updates[$field] === '') continue;
        $scheme = strtolower((string)(parse_url($updates[$field], PHP_URL_SCHEME) ?? ''));
        if (!filter_var($updates[$field], FILTER_VALIDATE_URL) || !in_array($scheme, ['http', 'https'], true)) {
            jsonOut(['ok' => false, 'error' => "{$field} must be a valid HTTP or HTTPS URL."], 422);
        }
    }
    if ($updates['emailAddress'] !== '' && !filter_var($updates['emailAddress'], FILTER_VALIDATE_EMAIL)) {
        jsonOut(['ok' => false, 'error' => 'Email address is invalid.'], 422);
    }
    foreach (['imapPort', 'smtpPort'] as $field) {
        $port = filter_var($body[$field] ?? null, FILTER_VALIDATE_INT);
        if ($port === false || $port < 1 || $port > 65535) {
            jsonOut(['ok' => false, 'error' => "{$field} must be between 1 and 65535."], 422);
        }
        $updates[$field] = $port;
    }
    $websitePassword = (string)($body['websitePassword'] ?? '');
    $emailPassword = (string)($body['emailPassword'] ?? '');
    if (strlen($websitePassword) > 2048 || strlen($emailPassword) > 2048) {
        jsonOut(['ok' => false, 'error' => 'Passwords cannot exceed 2048 characters.'], 422);
    }
    $updates['websitePassword'] = $websitePassword !== ''
        ? encryptClientAccessSecret($websitePassword)
        : ($record['websitePassword'] ?? null);
    $updates['emailPassword'] = $emailPassword !== ''
        ? encryptClientAccessSecret($emailPassword)
        : ($record['emailPassword'] ?? null);
    $updates['clientId'] = $clientId;
    $updates['updatedAt'] = date('c');
    $updates['createdAt'] = (string)($record['createdAt'] ?? $updates['updatedAt']);
    MongoService::updateOneWithOptions(
        'client_access',
        ['clientId' => $clientId],
        $updates,
        ['upsert' => true]
    );
    jsonOut(['ok' => true]);
}

if ($path === '/admin/clients' && $method === 'POST') {
    $firstName = trim((string)($body['first_name'] ?? $body['firstName'] ?? ''));
    $lastName = trim((string)($body['last_name'] ?? $body['lastName'] ?? ''));
    $name = trim((string)($body['name'] ?? ''));
    if ($name === '') {
        $name = trim($firstName . ' ' . $lastName);
    }
    $email = strtolower(trim((string)($body['email'] ?? '')));
    if ($name === '' || $email === '') {
        jsonOut(['ok' => false, 'error' => 'Client name and email are required.'], 422);
    }
    $body['first_name'] = $firstName;
    $body['last_name'] = $lastName;
    $body['name'] = $name;
    $body['email'] = $email;
    $body['company'] = trim((string)($body['company'] ?? ''));
    $body['portalEnabled'] = true;
    $body['portal_enabled'] = 1;
    $body['status'] = $body['status'] ?? $body['stage'] ?? 'Active';
    $body['stage'] = $body['stage'] ?? $body['status'] ?? 'Active';
    $body['tier'] = $body['tier'] ?? 'Enterprise Partner';
    $body['password'] = $body['password'] ?? 'admin123';
    $client = MongoService::insert('clients', $body);
    jsonOut(['ok' => true, 'client' => $client]);
}

if ($path === '/admin/clients/import' && $method === 'POST') {
    $clients = $body['clients'] ?? [];
    $imported = [];
    foreach ($clients as $c) {
        $c['portalEnabled'] = true;
        $c['portal_enabled'] = 1;
        $c['status'] = $c['status'] ?? $c['stage'] ?? 'Active';
        $c['stage'] = $c['stage'] ?? $c['status'] ?? 'Active';
        $c['tier'] = $c['tier'] ?? 'Enterprise Partner';
        $c['password'] = $c['password'] ?? 'admin123';
        $imported[] = MongoService::insert('clients', $c);
    }
    jsonOut(['ok' => true, 'count' => count($imported), 'imported' => count($imported), 'clients' => $imported]);
}

if (preg_match('#^/admin/clients/([^/]+)/(comments|comments/([^/]+)|status-history|status-history/([^/]+))$#', $path, $historyMatch) && $method === 'DELETE') {
    $staff = requireChatSuperAdminFromRequest();
    $clientId = rawurldecode($historyMatch[1]);
    $action = $historyMatch[2];
    $client = MongoService::findOne('clients', ['id' => $clientId]);
    if ($client === null) jsonOut(['ok' => false, 'error' => 'Client not found.'], 404);

    if ($action === 'comments' || $action === 'status-history') {
        $updates = $action === 'comments'
            ? ['comment_history' => [], 'commentHistory' => [], 'comment' => '', 'last_comment_date' => '']
            : ['status_history' => [], 'statusHistory' => []];
        $updates['updated_at'] = date('c');
    } elseif (str_starts_with($action, 'comments/')) {
        $commentId = rawurldecode((string)($historyMatch[3] ?? ''));
        $comments = is_array($client['comment_history'] ?? null) && count($client['comment_history']) > 0
            ? $client['comment_history']
            : (is_array($client['commentHistory'] ?? null) ? $client['commentHistory'] : []);
        $remainingComments = array_values(array_filter(
            $comments,
            static fn($entry) => (string)($entry['id'] ?? '') !== $commentId
        ));
        if (count($remainingComments) === count($comments)) {
            jsonOut(['ok' => false, 'error' => 'Comment not found.'], 404);
        }
        usort($remainingComments, static fn($a, $b) => strtotime((string)($b['created_at'] ?? '')) <=> strtotime((string)($a['created_at'] ?? '')));
        $latestComment = $remainingComments[0] ?? null;
        $updates = [
            'comment_history' => $remainingComments,
            'commentHistory' => $remainingComments,
            'comment' => (string)($latestComment['text'] ?? ''),
            'last_comment_date' => substr((string)($latestComment['created_at'] ?? ''), 0, 10),
        ];
        $updates['updated_at'] = date('c');
    } else {
        $entryId = rawurldecode((string)($historyMatch[4] ?? ''));
        $history = is_array($client['status_history'] ?? null) && count($client['status_history']) > 0
            ? $client['status_history']
            : (is_array($client['statusHistory'] ?? null) ? $client['statusHistory'] : []);
        $remainingHistory = array_values(array_filter(
            $history,
            static fn($entry) => (string)($entry['id'] ?? '') !== $entryId
        ));
        if (count($remainingHistory) === count($history)) {
            jsonOut(['ok' => false, 'error' => 'Status history entry not found.'], 404);
        }
        $updates = ['status_history' => $remainingHistory, 'statusHistory' => $remainingHistory];
        $updates['updated_at'] = date('c');
    }

    MongoService::updateOne('clients', ['id' => $clientId], $updates);
    jsonOut(['ok' => true, 'client' => MongoService::findOne('clients', ['id' => $clientId])]);
}

if (preg_match('#^/admin/clients/([^/]+)(?:/(restore|reset-status))?$#', $path, $matches)) {
    $clientId = rawurldecode($matches[1]);
    $subAction = $matches[2] ?? '';
    $isRestore = $subAction === 'restore';

    if ($isRestore && $method === 'POST') {
        if (MongoService::updateOne('clients', ['id' => $clientId], [
            'deleted_at' => null,
            'is_bin' => false,
        ]) === 0) {
            jsonOut(['ok' => false, 'error' => 'Client not found.'], 404);
        }
        jsonOut([
            'ok' => true,
            'client' => MongoService::findOne('clients', ['id' => $clientId]),
        ]);
    }

    if (!$isRestore && $method === 'GET') {
        $client = MongoService::findOne('clients', ['id' => $clientId]);
        if ($client === null) jsonOut(['ok' => false, 'error' => 'Client not found.'], 404);
        jsonOut(['ok' => true, 'client' => $client]);
    }

    if ($subAction === 'reset-status' && $method === 'POST') {
        requireChatSuperAdminFromRequest();
        if (MongoService::updateOne('clients', ['id' => $clientId], [
            'status' => 'New',
            'stage' => 'New',
            'status_history' => [],
            'statusHistory' => [],
            'updated_at' => date('c'),
        ]) === 0) {
            jsonOut(['ok' => false, 'error' => 'Client not found.'], 404);
        }
        jsonOut(['ok' => true, 'client' => MongoService::findOne('clients', ['id' => $clientId])]);
    }

    if (!$isRestore && $method === 'PATCH') {
        $updates = $body;
        unset($updates['_actorId'], $updates['_actorName']);
        $requestedStage = $updates['stage'] ?? $updates['status'] ?? null;
        $operators = ['$set' => $updates];
        $staff = null;
        $existing = null;
        $historyKeys = ['comment_history', 'commentHistory', 'status_history', 'statusHistory'];
        $includesHistoryMutation = false;
        foreach ($historyKeys as $historyKey) {
            if (array_key_exists($historyKey, $updates)) {
                $includesHistoryMutation = true;
                break;
            }
        }
        if ($includesHistoryMutation) {
            $staff = requireChatSuperAdminFromRequest();
        }
        if ($requestedStage !== null || array_key_exists('comment', $updates)) {
            $staff = $staff ?? chatStaffFromRequest();
            $existing = MongoService::findOne('clients', ['id' => $clientId]);
            if ($existing === null) jsonOut(['ok' => false, 'error' => 'Client not found.'], 404);
        }
        if ($requestedStage !== null) {
            if (!is_string($requestedStage) || trim($requestedStage) === '' || strlen(trim($requestedStage)) > 80) {
                jsonOut(['ok' => false, 'error' => 'Choose a valid client status.'], 422);
            }
            $nextStage = trim($requestedStage);
            $previousStage = (string)($existing['stage'] ?? $existing['status'] ?? 'New');
            $operators['$set'] = array_merge($updates, [
                'stage' => $nextStage,
                'status' => $nextStage,
                'updated_at' => date('c'),
            ]);
            if ($previousStage !== $nextStage) {
                $staffName = trim((string)($staff['name'] ?? (($staff['firstName'] ?? $staff['first_name'] ?? '') . ' ' . ($staff['lastName'] ?? $staff['last_name'] ?? ''))));
                $transition = [
                    'id' => bin2hex(random_bytes(16)),
                    'from_stage' => $previousStage,
                    'to_stage' => $nextStage,
                    'by_admin_id' => (string)($staff['id'] ?? ''),
                    'by_name' => $staffName !== '' ? $staffName : (string)($staff['email'] ?? 'Staff'),
                    'created_at' => date('c'),
                ];
                $history = is_array($existing['status_history'] ?? null) ? $existing['status_history'] : [];
                $legacyHistory = is_array($existing['statusHistory'] ?? null) ? $existing['statusHistory'] : [];
                if (count($history) === 0 && count($legacyHistory) > 0) {
                    $operators['$set']['status_history'] = array_slice(array_merge($legacyHistory, [$transition]), -100);
                } else {
                    $operators['$push'] = array_merge($operators['$push'] ?? [], [
                        'status_history' => [
                            '$each' => [$transition],
                            '$slice' => -100,
                        ],
                    ]);
                }
            }
        }
        if (array_key_exists('comment', $updates)) {
            $comment = trim((string)$updates['comment']);
            if ($comment === '' || strlen($comment) > 5000) {
                jsonOut(['ok' => false, 'error' => 'Comment must contain 1 to 5000 characters.'], 422);
            }
            $staffName = trim((string)($staff['name'] ?? (($staff['firstName'] ?? $staff['first_name'] ?? '') . ' ' . ($staff['lastName'] ?? $staff['last_name'] ?? ''))));
            $operators['$set']['comment'] = $comment;
            $commentEntry = [
                'id' => bin2hex(random_bytes(16)),
                'text' => $comment,
                'by_admin_id' => (string)($staff['id'] ?? ''),
                'by_name' => $staffName !== '' ? $staffName : (string)($staff['email'] ?? 'Staff'),
                'created_at' => date('c'),
            ];
            $history = is_array($existing['comment_history'] ?? null) ? $existing['comment_history'] : [];
            $legacyHistory = is_array($existing['commentHistory'] ?? null) ? $existing['commentHistory'] : [];
            if (count($history) === 0 && count($legacyHistory) > 0) {
                $operators['$set']['comment_history'] = array_slice(array_merge($legacyHistory, [$commentEntry]), -200);
            } else {
                $operators['$push'] = array_merge($operators['$push'] ?? [], [
                    'comment_history' => [
                        '$each' => [$commentEntry],
                        '$slice' => -200,
                    ],
                ]);
            }
        }
        if (MongoService::updateOneWithOperators('clients', ['id' => $clientId], $operators) === 0) {
            jsonOut(['ok' => false, 'error' => 'Client not found.'], 404);
        }
        jsonOut([
            'ok' => true,
            'client' => MongoService::findOne('clients', ['id' => $clientId]),
        ]);
    }

    if (!$isRestore && $method === 'DELETE') {
        if (($_GET['permanent'] ?? '') === '1') {
            if (MongoService::deleteOne('clients', ['id' => $clientId]) === 0) {
                jsonOut(['ok' => false, 'error' => 'Client not found.'], 404);
            }
            jsonOut(['ok' => true, 'deleted' => true]);
        }

        if (MongoService::updateOne('clients', ['id' => $clientId], [
            'deleted_at' => date('c'),
            'is_bin' => true,
        ]) === 0) {
            jsonOut(['ok' => false, 'error' => 'Client not found.'], 404);
        }
        jsonOut(['ok' => true]);
    }

    jsonOut(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

if ($path === '/admin/support-tickets' && $method === 'GET') {
    $clientId = trim((string)($_GET['client_id'] ?? ''));
    $tickets = MongoService::getCollection(
        'client_support_tickets',
        $clientId !== '' ? ['clientId' => $clientId] : [],
        1000,
        0,
        ['created_at' => -1]
    );
    $clients = [];
    foreach ($tickets as $ticket) {
        $id = (string)($ticket['clientId'] ?? '');
        if ($id !== '' && !isset($clients[$id])) {
            $clients[$id] = MongoService::findOne('clients', ['id' => $id]) ?? [];
        }
    }
    foreach ($tickets as &$ticket) {
        $client = $clients[(string)($ticket['clientId'] ?? '')] ?? [];
        $ticket['clientName'] = (string)($client['name'] ?? $client['company'] ?? 'Client');
        $ticket['clientEmail'] = (string)($client['email'] ?? '');
    }
    unset($ticket);
    jsonOut(['ok' => true, 'tickets' => $tickets]);
}

if (preg_match('#^/admin/support-tickets/([^/]+)/reply$#', $path, $matches) && $method === 'POST') {
    $ticketId = rawurldecode($matches[1]);
    $text = trim((string)($body['text'] ?? ''));
    $senderName = trim(substr((string)($body['senderName'] ?? 'Codex Dynamics Support'), 0, 120));
    if ($text === '' || strlen($text) > 5000) {
        jsonOut(['ok' => false, 'error' => 'Reply must be between 1 and 5000 characters.'], 422);
    }
    $ticket = MongoService::findOne('client_support_tickets', ['id' => $ticketId]);
    if (!$ticket) {
        jsonOut(['ok' => false, 'error' => 'Support request not found.'], 404);
    }
    $messages = is_array($ticket['messages'] ?? null) ? $ticket['messages'] : [];
    $messages[] = [
        'id' => 'message_' . bin2hex(random_bytes(12)),
        'sender' => 'staff',
        'senderName' => $senderName !== '' ? $senderName : 'Codex Dynamics Support',
        'text' => $text,
        'created_at' => date('c'),
    ];
    $updatedAt = date('c');
    MongoService::updateOne('client_support_tickets', ['id' => $ticketId], [
        'messages' => $messages,
        'status' => 'In Progress',
        'updated_at' => $updatedAt,
    ]);
    jsonOut(['ok' => true, 'ticket' => array_merge($ticket, [
        'messages' => $messages,
        'status' => 'In Progress',
        'updated_at' => $updatedAt,
    ])]);
}

if (preg_match('#^/admin/client-projects(?:/([^/]+))?$#', $path, $matches)) {
    $projectId = isset($matches[1]) ? rawurldecode($matches[1]) : '';
    $collection = 'client_projects';

    if ($projectId === '' && $method === 'GET') {
        $projects = MongoService::getCollection($collection, [
            '$or' => [
                ['archived_at' => ['$exists' => false]],
                ['archived_at' => null],
                ['archived_at' => ''],
            ],
        ], 1000);
        foreach ($projects as &$project) {
            $project['client_id'] = $project['client_id'] ?? $project['clientId'] ?? '';
            unset($project['clientId']);
        }
        unset($project);
        jsonOut(['ok' => true, 'projects' => $projects]);
    }

    if ($projectId === '' && $method === 'POST') {
        $clientId = trim((string)($body['client_id'] ?? $body['clientId'] ?? ''));
        $name = trim((string)($body['name'] ?? ''));
        if ($clientId === '' || $name === '') {
            jsonOut(['ok' => false, 'error' => 'A client and project name are required.'], 422);
        }
        if (MongoService::findOne('clients', ['id' => $clientId]) === null) {
            jsonOut(['ok' => false, 'error' => 'Client not found.'], 404);
        }
        unset($body['clientId'], $body['client_name'], $body['client_company'], $body['_id']);
        $body['id'] = 'client_project_' . bin2hex(random_bytes(12));
        $body['client_id'] = $clientId;
        $body['name'] = $name;
        $body['status'] = trim((string)($body['status'] ?? 'Planning')) ?: 'Planning';
        $body['progress'] = max(0, min(100, (int)round((float)($body['progress'] ?? 0))));
        $body['created_at'] = date('c');
        $body['updated_at'] = date('c');
        jsonOut(['ok' => true, 'project' => MongoService::insert($collection, $body)]);
    }

    if ($projectId !== '' && in_array($method, ['PATCH', 'DELETE'], true)) {
        $project = MongoService::findOne($collection, ['id' => $projectId]);
        if ($project === null || !empty($project['archived_at'])) {
            jsonOut(['ok' => false, 'error' => 'Client project not found.'], 404);
        }

        if ($method === 'DELETE') {
            MongoService::updateOne($collection, ['id' => $projectId], [
                'archived_at' => date('c'),
                'updated_at' => date('c'),
            ]);
            jsonOut(['ok' => true, 'archived' => true]);
        }

        $allowedFields = [
            'client_id', 'clientId', 'name', 'description', 'service', 'status',
            'progress', 'start_date', 'target_date', 'team_lead', 'milestones', 'recent_updates',
        ];
        $updates = array_intersect_key($body, array_flip($allowedFields));
        if (!array_key_exists('client_id', $updates) && array_key_exists('clientId', $updates)) {
            $updates['client_id'] = $updates['clientId'];
        }
        unset($updates['clientId']);
        if (array_key_exists('client_id', $updates)) {
            $clientId = trim((string)$updates['client_id']);
            if ($clientId === '') {
                jsonOut(['ok' => false, 'error' => 'Choose a client for this project.'], 422);
            }
            if (MongoService::findOne('clients', ['id' => $clientId]) === null) {
                jsonOut(['ok' => false, 'error' => 'Client not found.'], 404);
            }
            $updates['client_id'] = $clientId;
        }
        if (array_key_exists('name', $updates)) {
            $updates['name'] = trim((string)$updates['name']);
            if ($updates['name'] === '') {
                jsonOut(['ok' => false, 'error' => 'Project name is required.'], 422);
            }
        }
        if (array_key_exists('progress', $updates)) {
            $updates['progress'] = max(0, min(100, (int)round((float)$updates['progress'])));
        }
        $updates['updated_at'] = date('c');
        MongoService::updateOne($collection, ['id' => $projectId], $updates);
        $updatedProject = MongoService::findOne($collection, ['id' => $projectId]);
        $updatedProject['client_id'] = $updatedProject['client_id'] ?? $updatedProject['clientId'] ?? '';
        jsonOut(['ok' => true, 'project' => $updatedProject]);
    }

    jsonOut(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

// 4. Content & Settings
if ($path === '/crm/action' && $method === 'POST' && ($body['action'] ?? '') === 'upload_image') {
    $data = trim((string)($body['data'] ?? ''));
    if (!preg_match('#^data:(image/(?:jpeg|png|webp|gif|avif)|video/(?:mp4|webm));base64,([A-Za-z0-9+/]+=*)$#', $data, $match)) {
        jsonOut(['ok' => false, 'error' => 'Choose a supported image or video file.'], 422);
    }

    $file = base64_decode($match[2], true);
    if ($file === false || $file === '' || strlen($file) > 5 * 1024 * 1024) {
        jsonOut(['ok' => false, 'error' => 'Media files must be 5MB or smaller.'], 413);
    }

    $mimeType = (new finfo(FILEINFO_MIME_TYPE))->buffer($file);
    $extensionByMime = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
        'image/gif' => 'gif',
        'image/avif' => 'avif',
        'video/mp4' => 'mp4',
        'video/webm' => 'webm',
    ];
    if (!isset($extensionByMime[$mimeType])) {
        jsonOut(['ok' => false, 'error' => 'The uploaded file type is not supported.'], 415);
    }

    $uploadDirectory = dirname(__DIR__) . '/uploads/projects';
    if (!is_dir($uploadDirectory) && !mkdir($uploadDirectory, 0755, true) && !is_dir($uploadDirectory)) {
        error_log('[Projects] Could not create the project media directory.');
        jsonOut(['ok' => false, 'error' => 'Project media storage is unavailable.'], 500);
    }

    $filename = bin2hex(random_bytes(16)) . '.' . $extensionByMime[$mimeType];
    if (file_put_contents($uploadDirectory . '/' . $filename, $file, LOCK_EX) === false) {
        error_log('[Projects] Could not write an uploaded project media file.');
        jsonOut(['ok' => false, 'error' => 'The project media file could not be saved.'], 500);
    }

    jsonOut([
        'ok' => true,
        'url' => '/uploads/projects/' . $filename,
        'mediaType' => str_starts_with($mimeType, 'video/') ? 'video' : 'image',
    ]);
}

if ($path === '/admin/site-content' && $method === 'GET') {
    $projects = MongoService::getCollection('projects');
    jsonOut([
        'ok' => true,
        'projects' => $projects,
        'categories' => collectProjectCategories(MongoService::getCollection('project_categories'), $projects),
        'blogs' => MongoService::getCollection('blogs'),
        'reviews' => MongoService::getCollection('reviews'),
        'settings' => MongoService::findOne('platform_settings', []) ?: [],
    ]);
}

if ($path === '/admin/site-content/action' && $method === 'POST') {
    $type = $body['type'] ?? 'project';
    if ($type === 'project_category') {
        if (!in_array($body['action'] ?? '', ['create', 'add'], true)) {
            jsonOut(['ok' => false, 'error' => 'Only project category creation is supported.'], 400);
        }
        $item = is_array($body['item'] ?? null) ? $body['item'] : [];
        $name = trim((string)($item['name'] ?? ''));
        $nameLength = preg_match_all('/./us', $name);
        if ($name === '' || $nameLength === false || $nameLength > 60) {
            jsonOut(['ok' => false, 'error' => 'Category names must be between 1 and 60 characters.'], 422);
        }
        $knownCategories = collectProjectCategories(
            MongoService::getCollection('project_categories'),
            MongoService::getCollection('projects')
        );
        foreach ($knownCategories as $knownCategory) {
            if (strcasecmp($knownCategory, $name) === 0) {
                jsonOut(['ok' => false, 'error' => 'That project category already exists.'], 409);
            }
        }
        $category = MongoService::insert('project_categories', ['name' => $name]);
        jsonOut(['ok' => true, 'category' => $category]);
    }
    $col = $type === 'blog' ? 'blogs' : ($type === 'review' ? 'reviews' : 'projects');
    $action = $body['action'] ?? '';
    $item = $body['item'] ?? [];

    if ($action === 'create' || $action === 'add') {
        if (!is_array($item) || $item === []) {
            jsonOut(['ok' => false, 'error' => 'A site-content item is required.'], 422);
        }
        unset($item['_id']);
        $saved = MongoService::insert($col, $item);
        jsonOut(['ok' => true, 'item' => $saved]);
    }

    if ($action === 'update' || $action === 'edit') {
        $id = $body['id'] ?? ($item['id'] ?? null);
        if ($id === null || $id === '' || !is_array($item) || $item === []) {
            jsonOut(['ok' => false, 'error' => 'A site-content item id and item are required.'], 422);
        }
        unset($item['_id']);
        if (MongoService::updateOne($col, ['id' => $id], $item) === 0) {
            jsonOut(['ok' => false, 'error' => 'The site-content item was not found.'], 404);
        }
        jsonOut(['ok' => true, 'item' => $item]);
    }

    if ($action === 'delete') {
        $id = $body['id'] ?? ($item['id'] ?? null);
        if ($id === null || $id === '') {
            jsonOut(['ok' => false, 'error' => 'A site-content item id is required.'], 422);
        }
        $deleted = MongoService::deleteOne($col, ['id' => $id]);
        if ($deleted === 0) {
            jsonOut(['ok' => false, 'error' => 'The site-content item was not found.'], 404);
        }
        jsonOut(['ok' => true, 'deleted' => $deleted]);
    }

    jsonOut(['ok' => false, 'error' => 'Unsupported site-content action.'], 400);
}

function settingsResponse(array $record): array {
    $siteConfig = $record['site_config'] ?? null;
    unset($record['_id'], $record['site_config']);
    return ['settings' => $record, 'site_config' => $siteConfig];
}

function sanitizePublicSiteConfig(mixed $siteConfig): ?array {
    if (!is_array($siteConfig)) return null;
    unset($siteConfig['webhookUrl'], $siteConfig['webhook_url']);
    if (is_array($siteConfig['security'] ?? null)) {
        unset($siteConfig['security']['webhookUrl'], $siteConfig['security']['webhook_url']);
    }
    return $siteConfig;
}

if ($path === '/crm/settings') {
    if ($method !== 'GET') {
        jsonOut(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }
    $record = MongoService::findOne('platform_settings', []) ?: [];
    $response = settingsResponse($record);
    unset(
        $response['settings']['webhook'],
        $response['settings']['webhookUrl'],
        $response['settings']['webhook_url'],
        $response['settings']['allowedOrigins']
    );
    $response['site_config'] = sanitizePublicSiteConfig($response['site_config']);
    jsonOut(['ok' => true, ...$response]);
}

if ($path === '/admin/settings') {
    if ($method === 'GET') {
        chatStaffFromRequest();
        $record = MongoService::findOne('platform_settings', []) ?: [];
        jsonOut(['ok' => true, ...settingsResponse($record)]);
    }

    if ($method !== 'PUT' && $method !== 'POST') {
        jsonOut(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }

    $staff = chatStaffFromRequest();
    $hasSiteConfig = array_key_exists('site_config', $body);
    $settings = $body['settings'] ?? null;
    if ($settings !== null && !is_array($settings)) {
        jsonOut(['ok' => false, 'error' => 'Settings must be a JSON object.'], 400);
    }
    if ($hasSiteConfig && $body['site_config'] !== null && !is_array($body['site_config'])) {
        jsonOut(['ok' => false, 'error' => 'Site configuration must be a JSON object or null.'], 400);
    }

    $settings = $settings ?? [];
    foreach (array_keys($settings) as $key) {
        if (!preg_match('/^[A-Za-z][A-Za-z0-9_]*$/', (string)$key)
            || $key === 'id'
            || $key === 'site_config'
            || $key === 'webhook') {
            jsonOut(['ok' => false, 'error' => 'Settings contain an invalid field.'], 400);
        }
    }
    if (!$settings && !$hasSiteConfig) {
        jsonOut(['ok' => false, 'error' => 'Settings or site_config must be supplied.'], 400);
    }

    $changesSiteSettings = $hasSiteConfig;
    foreach (array_keys($settings) as $key) {
        if ($key !== 'crmTheme') {
            $changesSiteSettings = true;
            break;
        }
    }
    if ($changesSiteSettings) {
        $role = strtolower((string)(preg_replace('/[\s_-]+/', '', (string)($staff['role'] ?? '')) ?? ''));
        if ($role !== 'superadmin') {
            jsonOut(['ok' => false, 'error' => 'Only Super Admins can update site settings.'], 403);
        }
    }

    $updates = $settings;
    $updates['updatedAt'] = date('c');
    $operators = ['$set' => $updates];
    if ($hasSiteConfig) {
        if ($body['site_config'] === null) {
            $operators['$unset'] = ['site_config' => ''];
        } else {
            $operators['$set']['site_config'] = $body['site_config'];
        }
    }
    MongoService::updateOneWithOperators('platform_settings', [], $operators, ['upsert' => true]);

    $saved = MongoService::findOne('platform_settings', []) ?: [];
    jsonOut(['ok' => true, ...settingsResponse($saved)]);
}

// 5. Client Portal
if ($path === '/portal/login' && $method === 'POST') {
    $email = strtolower(trim((string)($body['email'] ?? '')));
    $password = (string)($body['password'] ?? '');
    if ($email === '' || $password === '') {
        jsonOut(['ok' => false, 'error' => 'Enter your email address and password.'], 400);
    }
    $escapedEmail = preg_quote($email, '/');
    $client = MongoService::findOne('clients', [
        '$or' => [
            ['email' => $email],
            ['email' => ['$regex' => '^' . $escapedEmail . '$', '$options' => 'i']],
        ],
    ]);
    if (!$client) jsonOut(['ok' => false, 'error' => 'The email or password is incorrect.'], 401);
    if (($client['status'] ?? '') === 'Suspended'
        || !empty($client['deleted_at'])
        || ($client['is_bin'] ?? false) === true) {
        jsonOut(['ok' => false, 'error' => 'This client portal account is unavailable. Contact support.'], 403);
    }
    if (($client['portalEnabled'] ?? $client['portal_enabled'] ?? true) === false
        || ($client['portalEnabled'] ?? $client['portal_enabled'] ?? true) === 0) {
        jsonOut(['ok' => false, 'error' => 'Client portal access is disabled. Contact support.'], 403);
    }
    $savedPassword = (string)($client['password'] ?? '');
    if ($savedPassword === '') {
        jsonOut(['ok' => false, 'error' => 'A portal password has not been set for this account. Contact your account manager.'], 403);
    }
    if (!hash_equals($savedPassword, $password)) {
        jsonOut(['ok' => false, 'error' => 'The email or password is incorrect.'], 401);
    }
    $lastLoginAt = date('c');
    MongoService::updateOne('clients', ['id' => (string)$client['id']], ['lastLoginAt' => $lastLoginAt]);
    $token = 'cdx_portal_php_mongo_' . $client['id'] . '_' . time();
    portalMailSetSessionCookie($token);
    jsonOut([
        'ok' => true,
        'token' => $token,
        'client' => [
            'id' => (string)$client['id'],
            'name' => (string)($client['name'] ?? $client['company'] ?? 'Client'),
            'company' => (string)($client['company'] ?? $client['name'] ?? ''),
            'email' => (string)($client['email'] ?? ''),
            'phone' => (string)($client['phone'] ?? ''),
            'address' => (string)($client['address'] ?? ''),
            'country' => (string)($client['country'] ?? 'United Kingdom'),
            'countryCode' => (string)($client['countryCode'] ?? ''),
            'status' => (string)($client['status'] ?? 'Active'),
            'portalEnabled' => true,
            'tier' => (string)($client['tier'] ?? 'Enterprise Partner'),
            'lastLoginAt' => $lastLoginAt,
            'createdAt' => (string)($client['createdAt'] ?? $client['created_at'] ?? $lastLoginAt),
        ],
    ]);
}

if ($path === '/portal/access' && $method === 'GET') {
    $client = portalMailClientFromRequest();
    $clientId = (string)($client['id'] ?? '');
    if ((string)($_GET['client_id'] ?? '') !== $clientId) {
        jsonOut(['ok' => false, 'error' => 'You do not have permission to load these access details.'], 403);
    }
    $record = MongoService::findOne('client_access', ['clientId' => $clientId]);
    if ($record === null) jsonOut(['ok' => true, 'access' => null]);
    jsonOut([
        'ok' => true,
        'access' => [
            'websiteUrl' => (string)($record['websiteUrl'] ?? ''),
            'websiteUsername' => (string)($record['websiteUsername'] ?? ''),
            'websitePassword' => decryptClientAccessSecret($record['websitePassword'] ?? null),
            'emailAddress' => (string)($record['emailAddress'] ?? ''),
            'webmailUrl' => (string)($record['webmailUrl'] ?? ''),
            'emailPassword' => decryptClientAccessSecret($record['emailPassword'] ?? null),
        ],
    ]);
}

if (str_starts_with($path, '/portal/data')) {
    $client = portalMailClientFromRequest();
    $clientId = (string)($client['id'] ?? '');
    if ((string)($_GET['client_id'] ?? '') !== $clientId) {
        jsonOut(['ok' => false, 'error' => 'You do not have permission to load this client data.'], 403);
    }
    $projects = $clientId !== '' ? MongoService::getCollection('client_projects', [
        '$and' => [
            ['$or' => [
                ['client_id' => $clientId],
                ['clientId' => $clientId],
            ]],
            ['$or' => [
                ['archived_at' => ['$exists' => false]],
                ['archived_at' => null],
                ['archived_at' => ''],
            ]],
        ],
    ], 1000) : [];
    $access = MongoService::findOne('client_access', ['clientId' => $clientId]);
    $publicWebsiteUrl = (string)($access['publicWebsiteUrl'] ?? '');
    $website = null;
    if ($publicWebsiteUrl !== '') {
        $domain = (string)(parse_url($publicWebsiteUrl, PHP_URL_HOST) ?? '');
        $website = [
            'id' => 'website_' . $clientId,
            'clientId' => $clientId,
            'name' => (string)($client['company'] ?? $client['name'] ?? 'Website'),
            'domain' => $domain,
            'websiteUrl' => $publicWebsiteUrl,
            'backOfficeUrl' => (string)($access['websiteUrl'] ?? ''),
            'status' => 'Configured',
            'connectionStatus' => 'Pending Setup',
            'connectorId' => '',
            'accessEnabled' => !empty($access['websiteUrl']),
            'techStack' => [],
            'hostingPlan' => 'Not specified',
            'sslStatus' => str_starts_with(strtolower($publicWebsiteUrl), 'https://') ? 'HTTPS' : 'Not configured',
            'createdAt' => (string)($access['createdAt'] ?? ''),
            'updatedAt' => (string)($access['updatedAt'] ?? ''),
        ];
    }
    jsonOut([
        'ok' => true,
        'client' => $client,
        'websites' => $website === null ? [] : [$website],
        'projects' => $projects,
        'invoices' => [],
        'payments' => [],
        'hosting' => [],
        'domains' => [],
        'tickets' => MongoService::getCollection('client_support_tickets', ['clientId' => $clientId], 500, 0, ['created_at' => -1]),
        'files' => [],
        'notifications' => [],
    ]);
}

if (str_contains($path, '/impersonate') && $method === 'POST') {
    preg_match('#/clients/([^/]+)/impersonate#', $path, $m);
    $cid = $m[1] ?? '';
    $client = MongoService::findOne('clients', ['id' => $cid]);
    if (!$client) {
        jsonOut(['ok' => false, 'error' => 'Client not found.'], 404);
    }
    $client['name'] = trim((string)($client['name'] ?? ''));
    if ($client['name'] === '') {
        $client['name'] = trim(
            (string)($client['first_name'] ?? $client['firstName'] ?? '') . ' ' .
            (string)($client['last_name'] ?? $client['lastName'] ?? '')
        );
    }
    if ($client['name'] === '') {
        $client['name'] = trim((string)($client['company'] ?? '')) ?: 'Client';
    }
    $client['company'] = (string)($client['company'] ?? '');
    $client['email'] = (string)($client['email'] ?? '');
    $token = 'cdx_portal_impersonate_' . $cid . '_' . time();
    portalMailSetSessionCookie($token);
    jsonOut(['ok' => true, 'token' => $token, 'client' => $client]);
}

if ($path === '/portal/logout' && $method === 'POST') {
    setcookie('cdx_portal_session', '', [
        'expires' => time() - 3600,
        'path' => '/api/',
        'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    jsonOut(['ok' => true]);
}

if ($path === '/portal/ticket') {
    $client = portalMailClientFromRequest();
    $clientId = (string)($client['id'] ?? '');
    if ($method === 'GET') {
        jsonOut([
            'ok' => true,
            'tickets' => MongoService::getCollection('client_support_tickets', ['clientId' => $clientId], 500, 0, ['created_at' => -1]),
        ]);
    }
    if ($method !== 'POST') {
        jsonOut(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }

    if (isset($body['ticketId'])) {
        $text = trim((string)($body['text'] ?? ''));
        if ($text === '' || strlen($text) > 5000) {
            jsonOut(['ok' => false, 'error' => 'Reply must be between 1 and 5000 characters.'], 422);
        }
        $ticketId = trim((string)$body['ticketId']);
        $ticket = MongoService::findOne('client_support_tickets', ['id' => $ticketId, 'clientId' => $clientId]);
        if (!$ticket) {
            jsonOut(['ok' => false, 'error' => 'Support request not found.'], 404);
        }
        $messages = is_array($ticket['messages'] ?? null) ? $ticket['messages'] : [];
        $messages[] = [
            'id' => 'message_' . bin2hex(random_bytes(12)),
            'sender' => 'client',
            'senderName' => (string)($client['name'] ?? $client['company'] ?? 'Client'),
            'text' => $text,
            'created_at' => date('c'),
        ];
        $updatedAt = date('c');
        MongoService::updateOne('client_support_tickets', ['id' => $ticketId, 'clientId' => $clientId], [
            'messages' => $messages,
            'status' => 'Open',
            'updated_at' => $updatedAt,
        ]);
        jsonOut(['ok' => true, 'messages' => $messages]);
    }

    $subject = trim((string)($body['subject'] ?? ''));
    $message = trim((string)($body['message'] ?? ''));
    $category = (string)($body['category'] ?? '');
    $priority = (string)($body['priority'] ?? '');
    $allowedCategories = ['Website & Code', 'Hosting & Server', 'Billing & Invoicing', 'Design & UX', 'General Question', 'Custom Feature'];
    $allowedPriorities = ['Low', 'Medium', 'High', 'Urgent'];
    if ($subject === '' || strlen($subject) > 180 || strlen($message) > 5000) {
        jsonOut(['ok' => false, 'error' => 'Subject (1–180 characters) and message (1–5000 characters) are required.'], 422);
    }
    if (!in_array($category, $allowedCategories, true) || !in_array($priority, $allowedPriorities, true)) {
        jsonOut(['ok' => false, 'error' => 'Choose a valid support category and priority.'], 422);
    }

    $createdAt = date('c');
    $ticket = MongoService::insert('client_support_tickets', [
        'clientId' => $clientId,
        'ticketNumber' => 'CDX-' . date('ymd') . '-' . strtoupper(substr(bin2hex(random_bytes(3)), 0, 6)),
        'subject' => $subject,
        'category' => $category,
        'priority' => $priority,
        'status' => 'Open',
        'assignedStaff' => 'Codex Dynamics Support',
        'updated_at' => $createdAt,
        'messages' => [[
            'id' => 'message_' . bin2hex(random_bytes(12)),
            'sender' => 'client',
            'senderName' => (string)($client['name'] ?? $client['company'] ?? 'Client'),
            'text' => $message,
            'created_at' => $createdAt,
        ]],
    ]);
    jsonOut(['ok' => true, 'ticket' => $ticket], 201);
}

if (preg_match('#^/admin/clients/([^/]+)/(portal-password|set-password)$#', $path, $passwordRoute)) {
    chatStaffFromRequest();
    $clientId = rawurldecode($passwordRoute[1]);
    $client = MongoService::findOne('clients', ['id' => $clientId]);
    if ($client === null) jsonOut(['ok' => false, 'error' => 'Client not found.'], 404);
    if ($passwordRoute[2] === 'portal-password' && $method === 'GET') {
        jsonOut(['ok' => true, 'password' => (string)($client['password'] ?? '')]);
    }
    if ($passwordRoute[2] === 'set-password' && $method === 'POST') {
        $newPassword = (string)($body['new_password'] ?? $body['newPassword'] ?? $body['password'] ?? '');
        if ($newPassword === '' || strlen($newPassword) > 1024) {
            jsonOut(['ok' => false, 'error' => 'Password must contain between 1 and 1024 characters.'], 422);
        }
        MongoService::updateOne('clients', ['id' => $clientId], ['password' => $newPassword]);
        jsonOut(['ok' => true, 'message' => 'Client portal password updated.']);
    }
    jsonOut(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

// 6. Accounting & Invoices
if ($path === '/admin/accounting/overview') {
    chatStaffFromRequest();
    $clients = array_values(array_map(static function (array $client): array {
        $firstName = trim((string)($client['first_name'] ?? $client['firstName'] ?? ''));
        $lastName = trim((string)($client['last_name'] ?? $client['lastName'] ?? ''));
        return [
            'id' => (string)($client['id'] ?? ''),
            'name' => (string)($client['name'] ?? $client['full_name'] ?? trim($firstName . ' ' . $lastName) ?: ($client['company'] ?? '')),
            'company' => (string)($client['company'] ?? ''),
            'email' => (string)($client['email'] ?? ''),
            'phone' => (string)($client['phone'] ?? ''),
        ];
    }, array_filter(MongoService::getCollection('clients'), static fn(array $client): bool => empty($client['deleted_at']) && ($client['is_bin'] ?? false) !== true && ($client['in_bin'] ?? false) !== true && ($client['is_deleted'] ?? false) !== true)));
    $invoices = MongoService::getCollection('invoices');
    $payments = MongoService::getCollection('payments');
    $validPayments = array_values(array_filter($payments, static fn(array $payment): bool => !in_array(strtolower((string)($payment['status'] ?? '')), ['voided', 'cancelled'], true)));
    $outstanding = array_reduce($invoices, static fn(float $sum, array $invoice): float => $sum + (float)($invoice['balance_due'] ?? $invoice['balanceDue'] ?? 0), 0.0);
    jsonOut([
        'ok' => true,
        'clients' => array_values(array_filter($clients, static fn(array $client): bool => $client['id'] !== '')),
        'stats' => [
            'totalRevenue' => array_reduce($validPayments, static fn(float $sum, array $payment): float => $sum + (float)($payment['amount'] ?? 0), 0.0),
            'outstanding' => $outstanding,
            'paidCount' => count($validPayments),
            'overdueCount' => count(array_filter($invoices, static fn(array $invoice): bool => strtolower((string)($invoice['status'] ?? '')) === 'overdue')),
        ],
        'invoices' => $invoices,
        'payments' => $payments,
    ]);
}

if (preg_match('#^/admin/accounting/([^/]+)$#', $path, $accountingMatch)) {
    $staff = chatStaffFromRequest();
    $clientId = rawurldecode($accountingMatch[1]);
    $client = MongoService::findOne('clients', ['id' => $clientId]);
    if ($client === null) jsonOut(['ok' => false, 'error' => 'Client not found.'], 404);

    if ($method === 'GET') {
        $invoices = array_values(array_filter(MongoService::getCollection('invoices'), static fn(array $invoice): bool => (string)($invoice['clientId'] ?? $invoice['client_id'] ?? '') === $clientId));
        $payments = array_values(array_filter(MongoService::getCollection('payments'), static fn(array $payment): bool => (string)($payment['clientId'] ?? $payment['client_id'] ?? '') === $clientId));
        $validPayments = array_values(array_filter($payments, static fn(array $payment): bool => !in_array(strtolower((string)($payment['status'] ?? '')), ['voided', 'cancelled'], true)));
        $total = array_reduce($invoices, static fn(float $sum, array $invoice): float => $sum + (float)($invoice['total'] ?? $invoice['amount'] ?? 0), 0.0);
        $balance = array_reduce($invoices, static fn(float $sum, array $invoice): float => $sum + (float)($invoice['balance_due'] ?? $invoice['balanceDue'] ?? 0), 0.0);
        jsonOut([
            'ok' => true,
            'invoices' => $invoices,
            'payments' => $payments,
            'client' => ['id' => $clientId, 'name' => (string)($client['name'] ?? $client['company'] ?? ''), 'email' => (string)($client['email'] ?? '')],
            'summary' => ['total' => $total, 'paid' => array_reduce($validPayments, static fn(float $sum, array $payment): float => $sum + (float)($payment['amount'] ?? 0), 0.0), 'balance' => $balance],
        ]);
    }

    if ($method !== 'POST') jsonOut(['ok' => false, 'error' => 'Method not allowed.'], 405);
    $recordType = strtolower(trim((string)($body['type'] ?? '')));
    $currency = strtoupper(trim((string)($body['currency'] ?? 'USD')));
    if (!preg_match('/^[A-Z]{3}$/', $currency)) jsonOut(['ok' => false, 'error' => 'Currency must be a valid three-letter code.'], 422);
    $now = date('c');
    $staffId = (string)($staff['id'] ?? $staff['staff_id'] ?? '');

    if ($recordType === 'invoice') {
        $sourceItems = $body['lineItems'] ?? null;
        if (!is_array($sourceItems) || count($sourceItems) < 1 || count($sourceItems) > 100) {
            jsonOut(['ok' => false, 'error' => 'An invoice must have between 1 and 100 line items.'], 422);
        }
        $lineItems = [];
        foreach ($sourceItems as $source) {
            if (!is_array($source)) jsonOut(['ok' => false, 'error' => 'Each invoice item must be an object.'], 422);
            $description = trim((string)($source['description'] ?? ''));
            $service = trim((string)($source['service'] ?? ''));
            $quantity = (float)($source['quantity'] ?? 0);
            $unitPrice = (float)($source['unitPrice'] ?? $source['unit_price'] ?? -1);
            if ($description === '' || strlen($description) > 300 || strlen($service) > 120 || !is_finite($quantity) || $quantity <= 0 || !is_finite($unitPrice) || $unitPrice < 0 || $unitPrice > 100000000) {
                jsonOut(['ok' => false, 'error' => 'Each invoice item needs a description, a positive quantity, and a non-negative unit price.'], 422);
            }
            $lineItems[] = ['description' => $description, 'service' => $service, 'quantity' => $quantity, 'unitPrice' => round($unitPrice, 2), 'unit_price' => round($unitPrice, 2)];
        }
        $taxRate = (float)($body['taxRate'] ?? 0);
        if (!is_finite($taxRate) || $taxRate < 0 || $taxRate > 100) jsonOut(['ok' => false, 'error' => 'Tax rate must be between 0 and 100 percent.'], 422);
        $issueDate = trim((string)($body['issueDate'] ?? ''));
        $dueDate = trim((string)($body['dueDate'] ?? ''));
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $issueDate) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $dueDate)) {
            jsonOut(['ok' => false, 'error' => 'Valid issue and due dates are required.'], 422);
        }
        $subtotal = round(array_reduce($lineItems, static fn(float $sum, array $item): float => $sum + $item['quantity'] * $item['unitPrice'], 0.0), 2);
        $tax = round($subtotal * $taxRate / 100, 2);
        $total = round($subtotal + $tax, 2);
        $status = trim((string)($body['status'] ?? 'Pending'));
        if (!in_array($status, ['Pending', 'Draft'], true)) jsonOut(['ok' => false, 'error' => 'Invoice status must be Pending or Draft.'], 422);
        $invoiceNumber = 'CDX-' . date('Y') . '-' . random_int(100000, 999999);
        $invoice = MongoService::insert('invoices', [
            'id' => 'inv_' . bin2hex(random_bytes(12)),
            'clientId' => $clientId,
            'client_id' => $clientId,
            'clientName' => (string)($client['name'] ?? $client['company'] ?? ''),
            'clientEmail' => (string)($client['email'] ?? ''),
            'invoiceNumber' => $invoiceNumber,
            'invoice_number' => $invoiceNumber,
            'lineItems' => $lineItems,
            'line_items' => $lineItems,
            'issueDate' => $issueDate,
            'issue_date' => $issueDate,
            'dueDate' => $dueDate,
            'due_date' => $dueDate,
            'currency' => $currency,
            'taxRate' => $taxRate,
            'tax_rate' => $taxRate,
            'subtotal' => $subtotal,
            'tax' => $tax,
            'total' => $total,
            'amount' => $total,
            'amountPaid' => 0,
            'amount_paid' => 0,
            'balanceDue' => $total,
            'balance_due' => $total,
            'status' => $status,
            'created_at' => $now,
            'updated_at' => $now,
            'created_by' => $staffId,
        ]);
        jsonOut(['ok' => true, 'invoice' => $invoice], 201);
    }

    if ($recordType === 'payment') {
        $amount = round((float)($body['amount'] ?? 0), 2);
        $paymentDate = trim((string)($body['paymentDate'] ?? ''));
        $invoiceId = trim((string)($body['invoiceId'] ?? $body['invoice_id'] ?? ''));
        if (!is_finite($amount) || $amount <= 0) jsonOut(['ok' => false, 'error' => 'Payment amount must be greater than zero.'], 422);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $paymentDate)) jsonOut(['ok' => false, 'error' => 'A valid payment date is required.'], 422);
        $invoice = null;
        if ($invoiceId !== '') {
            $invoice = MongoService::findOne('invoices', ['id' => $invoiceId, 'clientId' => $clientId]);
            if ($invoice === null) jsonOut(['ok' => false, 'error' => 'The selected invoice was not found for this client.'], 404);
            $invoiceBalance = (float)($invoice['balance_due'] ?? $invoice['balanceDue'] ?? $invoice['total'] ?? $invoice['amount'] ?? 0);
            if ($amount > $invoiceBalance + 0.001) jsonOut(['ok' => false, 'error' => 'Payment amount cannot exceed the invoice balance due.'], 422);
            if ($currency !== strtoupper((string)($invoice['currency'] ?? 'USD'))) jsonOut(['ok' => false, 'error' => 'Payment currency must match the selected invoice.'], 422);
        }
        $receiptNumber = 'CDX-R-' . date('Y') . '-' . random_int(100000, 999999);
        $payment = MongoService::insert('payments', [
            'id' => 'pay_' . bin2hex(random_bytes(12)),
            'clientId' => $clientId,
            'client_id' => $clientId,
            'clientName' => (string)($client['name'] ?? $client['company'] ?? ''),
            'clientEmail' => (string)($client['email'] ?? ''),
            'invoiceId' => $invoiceId,
            'invoice_id' => $invoiceId,
            'invoiceNumber' => (string)($invoice['invoice_number'] ?? $invoice['invoiceNumber'] ?? ''),
            'receiptNumber' => $receiptNumber,
            'receipt_number' => $receiptNumber,
            'paymentDate' => $paymentDate,
            'payment_date' => $paymentDate,
            'paymentMethod' => trim((string)($body['paymentMethod'] ?? 'Other')),
            'payment_method' => trim((string)($body['paymentMethod'] ?? 'Other')),
            'transactionReference' => trim((string)($body['transactionReference'] ?? '')),
            'transaction_reference' => trim((string)($body['transactionReference'] ?? '')),
            'description' => trim((string)($body['description'] ?? '')),
            'amount' => $amount,
            'currency' => $currency,
            'status' => 'Completed',
            'created_at' => $now,
            'created_by' => $staffId,
        ]);
        if ($invoice !== null) {
            $amountPaid = round((float)($invoice['amount_paid'] ?? $invoice['amountPaid'] ?? 0) + $amount, 2);
            $invoiceTotal = (float)($invoice['total'] ?? $invoice['amount'] ?? 0);
            $balanceDue = max(0, round($invoiceTotal - $amountPaid, 2));
            $invoiceStatus = $balanceDue <= 0 ? 'Paid' : 'Partially paid';
            MongoService::updateOne('invoices', ['id' => $invoiceId, 'clientId' => $clientId], [
                'amountPaid' => $amountPaid,
                'amount_paid' => $amountPaid,
                'balanceDue' => $balanceDue,
                'balance_due' => $balanceDue,
                'status' => $invoiceStatus,
                'updated_at' => $now,
            ]);
            $invoice['amountPaid'] = $invoice['amount_paid'] = $amountPaid;
            $invoice['balanceDue'] = $invoice['balance_due'] = $balanceDue;
            $invoice['status'] = $invoiceStatus;
        }
        jsonOut(['ok' => true, 'payment' => $payment, 'invoice' => $invoice], 201);
    }

    jsonOut(['ok' => false, 'error' => 'Accounting record type must be invoice or payment.'], 422);
}

// 7. Hostinger Mail & Mailboxes
if ($path === '/admin/integrations/hostinger-mail' && $method === 'GET') {
    $integration = MongoService::findOne('hostinger_mail_integrations', []) ?: [];
    $token = (string)($integration['token'] ?? '');
    $mailboxes = $integration['mailboxes'] ?? [];
    jsonOut([
        'ok' => true,
        'integration' => [
            'configured' => $token !== '',
            'status' => $integration['status'] ?? ($token !== '' ? 'connection_error' : 'not_configured'),
            'maskedToken' => $token !== '' ? '••••••••' . substr($token, -4) : '',
            'mailboxCount' => count($mailboxes),
            'lastTestedAt' => $integration['last_tested_at'] ?? null,
            'lastSuccessAt' => $integration['last_success_at'] ?? null,
        ],
    ]);
}

if ($path === '/admin/integrations/hostinger-mail/test' && $method === 'POST') {
    $integration = MongoService::findOne('hostinger_mail_integrations', []) ?: [];
    $token = trim((string)($body['token'] ?? $integration['token'] ?? ''));
    if ($token === '') {
        jsonOut(['ok' => false, 'error' => 'Enter a Hostinger Mail API token or save one first.'], 422);
    }
    $account = hostingerMailApiRequest($token);
    $payload = $account['data'] ?? $account;
    $mailboxes = is_array($payload['mailboxes'] ?? null) ? $payload['mailboxes'] : [];
    $now = date('c');
    if (isset($integration['_id'])) unset($integration['_id']);
    $testedStoredToken = isset($integration['token']) && hash_equals((string)$integration['token'], $token);
    if ($testedStoredToken) {
        $integration['status'] = 'connected';
        $integration['mailboxes'] = $mailboxes;
        $integration['last_tested_at'] = $now;
        $integration['last_success_at'] = $now;
        MongoService::updateOne('hostinger_mail_integrations', [], $integration);
    }
    jsonOut([
        'ok' => true,
        'message' => 'Hostinger Mail API connection verified.',
        'integration' => [
            'configured' => isset($integration['token']) && $integration['token'] !== '',
            'status' => $testedStoredToken ? 'connected' : ($integration['status'] ?? 'connection_error'),
            'mailboxCount' => count($mailboxes),
            'lastTestedAt' => $now,
            'lastSuccessAt' => $now,
        ],
    ]);
}

if ($path === '/admin/integrations/hostinger-mail' && $method === 'POST') {
    $token = trim((string)($body['token'] ?? ''));
    if ($token === '') {
        jsonOut(['ok' => false, 'error' => 'Enter a Hostinger Mail API token before saving.'], 422);
    }
    $account = hostingerMailApiRequest($token);
    $payload = $account['data'] ?? $account;
    $mailboxes = is_array($payload['mailboxes'] ?? null) ? $payload['mailboxes'] : [];
    $now = date('c');
    $integration = MongoService::findOne('hostinger_mail_integrations', []) ?: [];
    if (isset($integration['_id'])) unset($integration['_id']);
    $integration['token'] = $token;
    $integration['status'] = 'connected';
    $integration['mailboxes'] = $mailboxes;
    $integration['last_tested_at'] = $now;
    $integration['last_success_at'] = $now;
    if (MongoService::findOne('hostinger_mail_integrations', []) !== null) {
        MongoService::updateOne('hostinger_mail_integrations', [], $integration);
    } else {
        MongoService::insert('hostinger_mail_integrations', $integration);
    }
    jsonOut([
        'ok' => true,
        'connected' => true,
        'integration' => [
            'configured' => true,
            'status' => 'connected',
            'maskedToken' => '••••••••' . substr($token, -4),
            'mailboxCount' => count($mailboxes),
            'lastTestedAt' => $now,
            'lastSuccessAt' => $now,
        ],
    ]);
}

if ($path === '/admin/integrations/hostinger-mail' && $method === 'DELETE') {
    MongoService::deleteOne('hostinger_mail_integrations', []);
    jsonOut(['ok' => true, 'connected' => false]);
}

if ($path === '/admin/hostinger/mailboxes' && $method === 'GET') {
    $integration = hostingerMailIntegration();
    $providerMailboxes = hostingerMailMailboxList($integration);
    $assignments = MongoService::getCollection('client_mailboxes', [], 1000);
    $clients = MongoService::getCollection('clients', [], 1000);
    $clientsById = [];
    foreach ($clients as $client) {
        if (hostingerMailClientIsActive($client)) {
            $clientsById[(string)($client['id'] ?? '')] = $client;
        }
    }
    $mailboxes = [];
    foreach ($providerMailboxes as $providerMailbox) {
        $resourceId = (string)($providerMailbox['resourceId'] ?? '');
        $mailbox = [
            'id' => $resourceId,
            'resourceId' => $resourceId,
            'email' => (string)($providerMailbox['address'] ?? ''),
            'address' => (string)($providerMailbox['address'] ?? ''),
            'name' => (string)($providerMailbox['address'] ?? ''),
            'status' => 'Active',
            'inHostinger' => true,
        ];
        foreach ($assignments as $assignment) {
            if ((string)($assignment['providerMailboxId'] ?? '') !== $resourceId) continue;
            $client = $clientsById[(string)($assignment['clientId'] ?? '')] ?? null;
            $mailbox['assignedClientId'] = (string)($assignment['clientId'] ?? '');
            $mailbox['assignment'] = hostingerMailAssignmentResponse($assignment, $client);
            break;
        }
        $mailboxes[] = $mailbox;
    }
    jsonOut(['ok' => true, 'mailboxes' => $mailboxes]);
}

if (preg_match('#^/admin/hostinger/mailboxes/([^/]+)/stats$#', $path, $matches) && $method === 'GET') {
    $integration = hostingerMailIntegration();
    $token = trim((string)($integration['token'] ?? ''));
    if ($token === '') {
        jsonOut(['ok' => false, 'error' => 'Hostinger Mail API is not configured. Save a valid token first.'], 503);
    }
    $resourceId = rawurlencode(rawurldecode($matches[1]));
    $foldersResponse = hostingerMailApiRequest($token, '/api/v1/mailboxes/' . $resourceId . '/folders');
    $quotaResponse = hostingerMailApiRequest($token, '/api/v1/mailboxes/' . $resourceId . '/quota');
    $folders = hostingerMailApiData($foldersResponse);
    if (isset($folders['folders']) && is_array($folders['folders'])) {
        $folders = $folders['folders'];
    }
    if ($folders && array_keys($folders) !== range(0, count($folders) - 1)) {
        jsonOut(['ok' => false, 'error' => 'Hostinger Mail API returned an unreadable folder list.'], 502);
    }
    $folderStats = [];
    foreach ($folders as $folder) {
        if (!is_array($folder)) continue;
        $specialUse = strtolower(ltrim((string)($folder['specialUse'] ?? ''), '\\'));
        if ($specialUse === '') {
            $name = strtolower((string)($folder['name'] ?? $folder['path'] ?? ''));
            $specialUse = match ($name) {
                'inbox' => 'inbox',
                'sent', 'sent items' => 'sent',
                'junk', 'spam' => 'junk',
                'trash', 'deleted items' => 'trash',
                default => '',
            };
        }
        if ($specialUse !== '' && in_array($specialUse, ['inbox', 'sent', 'junk', 'trash'], true)) {
            $folderStats[$specialUse] = [
                'path' => (string)($folder['path'] ?? ''),
                'messageCount' => (int)($folder['messageCount'] ?? 0),
                'unreadCount' => (int)($folder['unreadCount'] ?? 0),
            ];
        }
    }
    jsonOut([
        'ok' => true,
        'stats' => [
            'folders' => $folderStats,
            'quota' => hostingerMailApiData($quotaResponse),
        ],
    ]);
}

if ($path === '/admin/hostinger/overview' && $method === 'GET') {
    $integration = hostingerMailIntegration();
    $providerMailboxes = hostingerMailMailboxList($integration);
    $assignments = MongoService::getCollection('client_mailboxes', [], 1000);
    $clients = MongoService::getCollection('clients', [], 1000);
    $clientsById = [];
    $activeClients = [];
    foreach ($clients as $client) {
        if (!hostingerMailClientIsActive($client)) continue;
        $clientId = (string)($client['id'] ?? '');
        $portalActive = (bool)($client['portalEnabled'] ?? $client['portal_enabled'] ?? false);
        $clientsById[$clientId] = $client;
        $activeClients[] = [
            'id' => $clientId,
            'name' => (string)($client['name'] ?? ''),
            'email' => (string)($client['email'] ?? ''),
            'company' => (string)($client['company'] ?? ''),
            'portalActive' => $portalActive,
        ];
    }
    $assignmentByMailbox = [];
    foreach ($assignments as $assignment) {
        $assignmentByMailbox[(string)($assignment['providerMailboxId'] ?? '')] = $assignment;
    }
    $mailboxes = [];
    foreach ($providerMailboxes as $providerMailbox) {
        $resourceId = (string)($providerMailbox['resourceId'] ?? '');
        $address = (string)($providerMailbox['address'] ?? '');
        $mailbox = [
            'resourceId' => $resourceId,
            'address' => $address,
            'inHostinger' => true,
            'activity' => ['lastOpenedAt' => null, 'sentLast30Days' => 0],
        ];
        if (isset($assignmentByMailbox[$resourceId])) {
            $assignment = $assignmentByMailbox[$resourceId];
            $client = $clientsById[(string)($assignment['clientId'] ?? '')] ?? null;
            $mailbox['assignment'] = hostingerMailAssignmentResponse($assignment, $client);
        }
        $mailboxes[] = $mailbox;
    }
    jsonOut([
        'ok' => true,
        'integration' => ['configured' => true, 'status' => $integration['status'] ?? 'connected'],
        'mailboxes' => $mailboxes,
        'clients' => $activeClients,
        'quota' => ['supported' => false, 'totalUsage' => 0, 'totalLimit' => 0, 'totalPercentage' => 0],
        'mailboxesCount' => count($providerMailboxes),
    ]);
}

if ($path === '/admin/me/password' && $method === 'POST') {
    jsonOut(['ok' => true, 'message' => 'Staff password updated in MongoDB.']);
}

if ($path === '/portal/change-password' && $method === 'POST') {
    jsonOut(['ok' => true, 'message' => 'Portal password updated in MongoDB.']);
}

if ($path === '/admin/notifications/send' && $method === 'POST') {
    $staff = chatStaffFromRequest();
    $message = trim((string)($body['message'] ?? ''));
    $userId = trim((string)($body['user_id'] ?? ''));
    $kind = trim((string)($body['kind'] ?? 'info'));
    $title = trim((string)($body['title'] ?? 'Administrator Notice'));
    $type = trim((string)($body['type'] ?? 'support'));
    $role = strtolower((string)(preg_replace('/[\s_-]+/', '', (string)($staff['role'] ?? '')) ?? ''));
    $isSuperAdmin = $role === 'superadmin';
    if (!$isSuperAdmin) {
        $capabilities = $staff['capabilities'] ?? [];
        if (is_string($capabilities)) $capabilities = json_decode($capabilities, true) ?: [];
        if (is_array($capabilities) && array_key_exists('notifications', $capabilities) && $capabilities['notifications'] === false) {
            jsonOut(['ok' => false, 'error' => 'Your account does not have notification access.'], 403);
        }
        if ($userId === '') {
            jsonOut(['ok' => false, 'error' => 'Only Super Admins can notify all clients.'], 403);
        }
    }
    if ($message === '' || strlen($message) > 1000) {
        jsonOut(['ok' => false, 'error' => 'Message must be between 1 and 1000 characters.'], 422);
    }

    $clients = MongoService::getCollection('clients', $userId !== '' ? ['id' => $userId] : [], 10000);
    $recipients = array_values(array_filter($clients, static function ($client) {
        return empty($client['is_bin']) && empty($client['deleted_at']) && ($client['status'] ?? '') !== 'Suspended';
    }));
    if ($userId !== '' && count($recipients) === 0) {
        jsonOut(['ok' => false, 'error' => 'The selected client was not found.'], 404);
    }
    if (count($recipients) === 0) {
        jsonOut(['ok' => false, 'error' => 'There are no active clients to notify.'], 422);
    }
    if (!$isSuperAdmin && !notificationStaffCanNotifyClient($staff, $recipients[0])) {
        jsonOut(['ok' => false, 'error' => 'You can only notify clients assigned to your role.'], 403);
    }

    $createdAt = date('c');
    $logId = 'notif_log_' . bin2hex(random_bytes(16));
    $firstNotification = null;
    foreach ($recipients as $recipient) {
        $clientId = (string)($recipient['id'] ?? '');
        if ($clientId === '') continue;
        $notification = MongoService::insert('notifications', [
            'id' => 'notif_' . bin2hex(random_bytes(16)),
            'notification_log_id' => $logId,
            'user_id' => $clientId,
            'clientId' => $clientId,
            'kind' => $kind,
            'title' => $title,
            'type' => $type,
            'message' => $message,
            'read' => false,
            'read_at' => null,
            'created_at' => $createdAt,
        ]);
        $firstNotification = $firstNotification ?? $notification;
    }
    $sent = count($recipients);
    $selectedClient = $userId !== '' ? $recipients[0] : [];
    $log = MongoService::insert('notification_sent_log', [
        'id' => $logId,
        'kind' => $kind,
        'message' => $message,
        'user_id' => $userId !== '' ? $userId : null,
        'user_name' => (string)($selectedClient['name'] ?? $selectedClient['company'] ?? ''),
        'user_email' => (string)($selectedClient['email'] ?? ''),
        'is_broadcast' => $userId !== '' ? 0 : 1,
        'recipient_count' => $sent,
        'admin_id' => (string)($staff['id'] ?? ''),
        'admin_name' => (string)($staff['name'] ?? $staff['full_name'] ?? $staff['email'] ?? 'Administrator'),
        'created_at' => $createdAt,
        'recalled_at' => null,
        'recalled_count' => null,
    ]);
    jsonOut(['ok' => true, 'sent' => $sent, 'notification' => $firstNotification, 'log' => $log]);
}

if ($path === '/admin/notifications/sent-log' && $method === 'GET') {
    chatStaffFromRequest();
    $limit = min(100, max(1, (int)($_GET['limit'] ?? 50)));
    $offset = max(0, (int)($_GET['offset'] ?? 0));
    $total = MongoService::countDocuments('notification_sent_log');
    $log = MongoService::getCollection('notification_sent_log', [], $limit, $offset, ['created_at' => -1]);
    jsonOut([
        'ok' => true,
        'log' => $log,
        'total' => $total,
        'limit' => $limit,
        'offset' => $offset,
        'has_more' => $offset + count($log) < $total,
    ]);
}

if ($path === '/admin/notifications/sent-log' && $method === 'DELETE') {
    chatStaffFromRequest();
    jsonOut(['ok' => true, 'deleted' => MongoService::deleteMany('notification_sent_log', [])]);
}

if (preg_match('#^/admin/notifications/sent-log/([^/]+)$#', $path, $sentLogMatch) && $method === 'DELETE') {
    chatStaffFromRequest();
    $logId = rawurldecode($sentLogMatch[1]);
    $log = MongoService::findOne('notification_sent_log', ['id' => $logId]);
    if (!$log) jsonOut(['ok' => false, 'error' => 'Sent notification was not found.'], 404);
    $recalled = MongoService::deleteMany('notifications', [
        'notification_log_id' => $logId,
        'read_at' => null,
    ]);
    $now = date('c');
    MongoService::updateOne('notification_sent_log', ['id' => $logId], [
        'recalled_at' => $now,
        'recalled_count' => $recalled,
    ]);
    jsonOut([
        'ok' => true,
        'recalled' => $recalled,
        'already_read' => max(0, (int)($log['recipient_count'] ?? 0) - $recalled),
    ]);
}

if (preg_match('#^/admin/users/([^/]+)/notifications(?:/(clear|delete))?$#', $path, $userNotificationsMatch)) {
    chatStaffFromRequest();
    $clientId = rawurldecode($userNotificationsMatch[1]);
    $action = $userNotificationsMatch[2] ?? '';
    $filter = notificationClientFilter($clientId);
    if ($action === '' && $method === 'GET') {
        if (!MongoService::findOne('clients', ['id' => $clientId])) {
            jsonOut(['ok' => false, 'error' => 'Client was not found.'], 404);
        }
        jsonOut(['ok' => true, 'notifications' => MongoService::getCollection('notifications', $filter, 500, 0, ['created_at' => -1])]);
    }
    if ($action === 'clear' && $method === 'DELETE') {
        jsonOut(['ok' => true, 'deleted' => MongoService::deleteMany('notifications', $filter)]);
    }
    if ($action === 'delete' && $method === 'POST') {
        $ids = $body['ids'] ?? [];
        if (!is_array($ids) || count($ids) < 1 || count($ids) > 500) {
            jsonOut(['ok' => false, 'error' => 'Select between 1 and 500 notifications to delete.'], 422);
        }
        jsonOut(['ok' => true, 'deleted' => MongoService::deleteMany('notifications', [
            '$and' => [$filter, ['id' => ['$in' => array_map('strval', $ids)]]],
        ])]);
    }
    jsonOut(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

if (preg_match('#^/admin/notifications/([^/]+)/read$#', $path, $readNotificationMatch) && $method === 'POST') {
    chatStaffFromRequest();
    $id = rawurldecode($readNotificationMatch[1]);
    if (!MongoService::updateOne('notifications', ['id' => $id], ['read' => true, 'read_at' => date('c')])) {
        jsonOut(['ok' => false, 'error' => 'Notification was not found.'], 404);
    }
    jsonOut(['ok' => true]);
}

if (preg_match('#^/admin/notifications/([^/]+)$#', $path, $deleteNotificationMatch) && $method === 'DELETE') {
    chatStaffFromRequest();
    $deleted = MongoService::deleteOne('notifications', ['id' => rawurldecode($deleteNotificationMatch[1])]);
    if (!$deleted) jsonOut(['ok' => false, 'error' => 'Notification was not found.'], 404);
    jsonOut(['ok' => true, 'deleted' => $deleted]);
}

if ($path === '/admin/notifications') {
    chatStaffFromRequest();
    if ($method === 'DELETE') {
        jsonOut(['ok' => true, 'deleted' => MongoService::deleteMany('notifications', [])]);
    }
    if ($method !== 'GET') jsonOut(['ok' => false, 'error' => 'Method not allowed.'], 405);
    $limit = min(200, max(1, (int)($_GET['limit'] ?? 50)));
    $filter = ($_GET['only_unread'] ?? '') === '1' ? ['read_at' => null] : [];
    $notifs = MongoService::getCollection('notifications', $filter, $limit, 0, ['created_at' => -1]);
    jsonOut([
        'ok' => true,
        'notifications' => $notifs,
        'unread_count' => MongoService::countDocuments('notifications', ['read_at' => null]),
        'has_more' => count($notifs) === $limit,
    ]);
}

if ($path === '/admin/notifications/read-all' && $method === 'POST') {
    chatStaffFromRequest();
    $modified = MongoService::updateMany('notifications', ['read_at' => null], ['read' => true, 'read_at' => date('c')]);
    jsonOut(['ok' => true, 'modified' => $modified]);
}

if ($path === '/admin/notifications/clear' && $method === 'DELETE') {
    chatStaffFromRequest();
    jsonOut(['ok' => true, 'deleted' => MongoService::deleteMany('notifications', [])]);
}

if ($path === '/client/notifications') {
    $client = portalMailClientFromRequest();
    $clientId = (string)($client['id'] ?? '');
    $filter = notificationClientFilter($clientId);
    if ($method === 'POST') {
        $id = trim((string)($body['id'] ?? ''));
        if ($id === '') jsonOut(['ok' => false, 'error' => 'Notification id is required.'], 400);
        if (!MongoService::updateOne('notifications', ['$and' => [$filter, ['id' => $id]]], ['read' => true, 'read_at' => date('c')])) {
            jsonOut(['ok' => false, 'error' => 'Notification was not found.'], 404);
        }
        jsonOut(['ok' => true]);
    }
    if ($method !== 'GET') jsonOut(['ok' => false, 'error' => 'Method not allowed.'], 405);
    jsonOut(['ok' => true, 'notifications' => MongoService::getCollection('notifications', $filter, 500, 0, ['created_at' => -1])]);
}

if ($path === '/admin/messages') {
    $staff = chatStaffFromRequest();
    if ($method === 'POST') {
        $clientId = trim((string)($body['user_id'] ?? ''));
        $text = trim((string)($body['body'] ?? ''));
        if ($clientId === '' || $text === '' || strlen($text) > 5000) {
            jsonOut(['ok' => false, 'error' => 'A client and a message of 1 to 5000 characters are required.'], 422);
        }
        $senderName = trim((string)($body['sender_name'] ?? ''));
        $message = MongoService::insert('messages', [
            'user_id' => $clientId,
            'sender' => 'agent',
            'sender_id' => (string)($staff['id'] ?? ''),
            'sender_name' => substr($senderName !== '' ? $senderName : (string)($staff['name'] ?? 'Codex Dynamics Support'), 0, 120),
            'body' => $text,
            'read' => false,
        ]);
        jsonOut(['ok' => true, 'message' => $message]);
    }
    if ($method === 'DELETE') {
        $clientId = trim((string)($_GET['user_id'] ?? ''));
        if ($clientId === '') jsonOut(['ok' => false, 'error' => 'user_id is required to clear a chat.'], 400);
        jsonOut(['ok' => true, 'deletedCount' => MongoService::deleteMany('messages', chatMessageFilter($clientId))]);
    }
    if ($method !== 'GET') jsonOut(['ok' => false, 'error' => 'Method not allowed.'], 405);
    $clientId = trim((string)($_GET['user_id'] ?? ''));
    $filter = [
        '$and' => array_values(array_filter([
            $clientId !== '' ? chatMessageFilter($clientId) : null,
            ['hidden_for_staff' => ['$ne' => (string)($staff['id'] ?? '')]],
        ])),
    ];
    $limit = max(1, min(500, (int)($_GET['limit'] ?? 100)));
    $messages = MongoService::getCollection('messages', $filter, $limit, 0, ['created_at' => -1]);
    $messages = array_reverse($messages);
    $client = $clientId !== '' ? MongoService::findOne('clients', ['id' => $clientId]) : null;
    $user = $client ? array_intersect_key($client, array_flip(['id', 'name', 'email', 'company'])) : null;
    $unreadCount = $clientId !== ''
        ? MongoService::countDocuments('messages', chatMessageFilter($clientId) + ['sender' => 'client', 'read' => ['$ne' => true]])
        : 0;
    jsonOut([
        'ok' => true,
        'user' => $user,
        'messages' => $messages,
        'unread_count' => $unreadCount,
        'has_more' => count($messages) === $limit,
    ]);
}

if (preg_match('#^/admin/messages/([^/]+)$#', $path, $chatMatch) && $method === 'DELETE') {
    $staff = chatStaffFromRequest();
    $clientId = trim((string)($_GET['user_id'] ?? ''));
    if ($clientId === '') jsonOut(['ok' => false, 'error' => 'user_id is required.'], 400);
    $filter = ['id' => rawurldecode($chatMatch[1])];
    $filter['$and'] = [chatMessageFilter($clientId)];
    if (($_GET['mode'] ?? '') === 'me') {
        $matched = MongoService::addToSetOne('messages', $filter, 'hidden_for_staff', (string)($staff['id'] ?? ''));
        if (!$matched) jsonOut(['ok' => false, 'error' => 'Chat message not found.'], 404);
        jsonOut(['ok' => true, 'hidden' => true]);
    }
    $deleted = MongoService::deleteOne('messages', $filter);
    if (!$deleted) jsonOut(['ok' => false, 'error' => 'Chat message not found.'], 404);
    jsonOut(['ok' => true, 'deletedCount' => $deleted]);
}

if ($path === '/admin/messages/read' && $method === 'POST') {
    chatStaffFromRequest();
    $clientId = trim((string)($body['user_id'] ?? $body['clientId'] ?? ''));
    if ($clientId === '') jsonOut(['ok' => false, 'error' => 'user_id is required.'], 400);
    $now = date('c');
    $modified = MongoService::updateMany('messages', chatMessageFilter($clientId) + ['sender' => 'client'], [
        'read' => true,
        'read_at' => $now,
    ]);
    jsonOut(['ok' => true, 'marked' => $modified]);
}

if ($path === '/admin/messages/unread_counts' && $method === 'GET') {
    chatStaffFromRequest();
    $unreadMessages = MongoService::getCollection('messages', ['read' => ['$ne' => true], 'sender' => 'client'], 5000);
    $counts = [];
    foreach ($unreadMessages as $message) {
        $clientId = (string)($message['user_id'] ?? $message['clientId'] ?? $message['client_id'] ?? '');
        if ($clientId !== '') $counts[$clientId] = ($counts[$clientId] ?? 0) + 1;
    }
    $total = array_sum($counts);
    jsonOut(['ok' => true, 'counts' => $counts, 'total' => $total, 'unreadCount' => $total]);
}

if ($path === '/admin/messages/threads' && $method === 'GET') {
    $staff = chatStaffFromRequest();
    $filter = ['hidden_for_staff' => ['$ne' => (string)($staff['id'] ?? '')]];
    jsonOut(['ok' => true, 'threads' => MongoService::getCollection('messages', $filter, 5000, 0, ['created_at' => 1])]);
}

if (preg_match('#^/admin/messages/presence$#', $path)) {
    chatStaffFromRequest();
    $clientId = trim((string)($_GET['user_id'] ?? $body['user_id'] ?? ''));
    if ($clientId === '') jsonOut(['ok' => false, 'error' => 'user_id is required.'], 400);
    $presenceId = 'chat_presence_' . $clientId;
    $now = date('c');
    $updates = ['id' => $presenceId, 'clientId' => $clientId, 'staff_online_at' => $now];
    if ($method === 'POST') {
        $typing = (bool)($body['is_typing'] ?? false);
        $updates['staff_typing'] = $typing;
        $updates['staff_typing_at'] = $typing ? $now : null;
    } elseif ($method !== 'GET') {
        jsonOut(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }
    MongoService::updateOneWithOptions('client_chat_presence', ['id' => $presenceId], $updates, ['upsert' => true]);
    $presence = MongoService::findOne('client_chat_presence', ['id' => $presenceId]) ?? [];
    jsonOut(['ok' => true, 'presence' => [
        'client_online' => chatPresenceIsFresh($presence['client_online_at'] ?? null, 30),
        'client_typing' => (bool)($presence['client_typing'] ?? false) && chatPresenceIsFresh($presence['client_typing_at'] ?? null, 8),
        'staff_online' => chatPresenceIsFresh($presence['staff_online_at'] ?? null, 30),
        'staff_typing' => (bool)($presence['staff_typing'] ?? false) && chatPresenceIsFresh($presence['staff_typing_at'] ?? null, 8),
    ]]);
}

if ($path === '/portal/messages/presence') {
    $client = portalMailClientFromRequest();
    $clientId = (string)($client['id'] ?? '');
    $presenceId = 'chat_presence_' . $clientId;
    $now = date('c');
    $updates = ['id' => $presenceId, 'clientId' => $clientId, 'client_online_at' => $now];
    if ($method === 'POST') {
        $typing = (bool)($body['is_typing'] ?? false);
        $updates['client_typing'] = $typing;
        $updates['client_typing_at'] = $typing ? $now : null;
    } elseif ($method !== 'GET') {
        jsonOut(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }
    MongoService::updateOneWithOptions('client_chat_presence', ['id' => $presenceId], $updates, ['upsert' => true]);
    $presence = MongoService::findOne('client_chat_presence', ['id' => $presenceId]) ?? [];
    jsonOut(['ok' => true, 'presence' => [
        'staff_online' => chatPresenceIsFresh($presence['staff_online_at'] ?? null, 30),
        'staff_typing' => (bool)($presence['staff_typing'] ?? false) && chatPresenceIsFresh($presence['staff_typing_at'] ?? null, 8),
        'client_online' => true,
    ]]);
}

if ($path === '/client/messages') {
    $client = portalMailClientFromRequest();
    $clientId = (string)($client['id'] ?? '');
    if ($method === 'POST') {
        $text = trim((string)($body['body'] ?? ''));
        if ($text === '' || strlen($text) > 5000) jsonOut(['ok' => false, 'error' => 'Message must be between 1 and 5000 characters.'], 422);
        $clientName = trim((string)($client['name'] ?? ''));
        if ($clientName === '') $clientName = trim((string)($client['company'] ?? '')) ?: 'Client';
        $message = MongoService::insert('messages', [
            'user_id' => $clientId,
            'sender' => 'client',
            'sender_id' => $clientId,
            'sender_name' => $clientName,
            'body' => $text,
            'read' => false,
        ]);
        jsonOut(['ok' => true, 'message' => $message]);
    }
    if ($method === 'DELETE') {
        jsonOut(['ok' => true, 'hiddenCount' => MongoService::updateMany('messages', chatMessageFilter($clientId), ['hidden_for_client' => true])]);
    }
    if ($method !== 'GET') jsonOut(['ok' => false, 'error' => 'Method not allowed.'], 405);
    $requestedId = trim((string)($_GET['user_id'] ?? $clientId));
    if ($requestedId !== $clientId) jsonOut(['ok' => false, 'error' => 'You cannot access another client’s chat.'], 403);
    jsonOut(['ok' => true, 'messages' => MongoService::getCollection('messages', [
        '$and' => [
            chatMessageFilter($clientId),
            ['hidden_for_client' => ['$ne' => true]],
        ],
    ], 2000, 0, ['created_at' => 1])]);
}

if (preg_match('#^/client/messages/([^/]+)$#', $path, $chatMatch)) {
    $client = portalMailClientFromRequest();
    $clientId = (string)($client['id'] ?? '');
    $messageFilter = [
        'id' => rawurldecode($chatMatch[1]),
        'sender' => 'client',
        '$and' => [chatMessageFilter($clientId)],
    ];
    if ($method === 'DELETE') {
        unset($messageFilter['sender']);
        $hidden = MongoService::updateOne('messages', $messageFilter, ['hidden_for_client' => true]);
        if (!$hidden && !MongoService::findOne('messages', $messageFilter + ['hidden_for_client' => true])) {
            jsonOut(['ok' => false, 'error' => 'Chat message not found.'], 404);
        }
        jsonOut(['ok' => true, 'hidden' => true]);
    }
    if ($method === 'PATCH') {
        $text = trim((string)($body['body'] ?? ''));
        if ($text === '' || strlen($text) > 5000) jsonOut(['ok' => false, 'error' => 'Message must be between 1 and 5000 characters.'], 422);
        $message = MongoService::findOne('messages', $messageFilter);
        if (!$message) jsonOut(['ok' => false, 'error' => 'Chat message not found.'], 404);
        $createdAt = strtotime((string)($message['created_at'] ?? ''));
        if ($createdAt === false || time() - $createdAt > 420) jsonOut(['ok' => false, 'error' => 'Messages can only be edited for seven minutes after sending.'], 403);
        $editedAt = date('c');
        MongoService::updateOne('messages', $messageFilter, ['body' => $text, 'edited_at' => $editedAt]);
        $message['body'] = $text;
        $message['edited_at'] = $editedAt;
        jsonOut(['ok' => true, 'message' => $message]);
    }
    jsonOut(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

if ($path === '/admin/audit') {
    $logs = MongoService::getCollection('audit_logs');
    jsonOut(['ok' => true, 'logs' => $logs]);
}

if (preg_match('#^/admin/hostinger/mailboxes/([^/]+)/send-to-client$#', $path, $sendMailMatch) && $method === 'POST') {
    $staff = chatStaffFromRequest();
    $role = strtolower((string)(preg_replace('/[\s_-]+/', '', (string)($staff['role'] ?? '')) ?? ''));
    if ($role !== 'superadmin') {
        jsonOut(['ok' => false, 'error' => 'Only Super Admins can send email from the admin mail workspace.'], 403);
    }
    $resourceId = rawurldecode($sendMailMatch[1]);
    $subject = trim((string)($body['subject'] ?? ''));
    $text = trim((string)($body['text'] ?? ''));
    $html = trim((string)($body['html'] ?? ''));
    if ($resourceId === '') {
        jsonOut(['ok' => false, 'error' => 'A sender mailbox is required.'], 400);
    }
    if ($subject === '' || strlen($subject) > 200) {
        jsonOut(['ok' => false, 'error' => 'Subject must be between 1 and 200 characters.'], 422);
    }
    if ($text === '' || strlen($text) > 20000) {
        jsonOut(['ok' => false, 'error' => 'Message must be between 1 and 20000 characters.'], 422);
    }
    if (strlen($html) > 50000) {
        jsonOut(['ok' => false, 'error' => 'HTML message cannot exceed 50000 characters.'], 422);
    }
    $integration = hostingerMailIntegration();
    $token = trim((string)($integration['token'] ?? ''));
    if ($token === '') {
        jsonOut(['ok' => false, 'error' => 'Hostinger Mail is not configured. Save a valid token first.'], 503);
    }
    $providerMailboxes = hostingerMailMailboxList($integration);
    $mailbox = null;
    foreach ($providerMailboxes as $providerMailbox) {
        if ((string)($providerMailbox['resourceId'] ?? '') === $resourceId) {
            $mailbox = $providerMailbox;
            break;
        }
    }
    if ($mailbox === null) {
        jsonOut(['ok' => false, 'error' => 'The sender mailbox was not found in the connected Hostinger account.'], 404);
    }
    $assignment = MongoService::findOne('client_mailboxes', [
        'providerMailboxId' => $resourceId,
    ]);
    $enabled = $assignment['enabled'] ?? false;
    if (!$assignment || !($enabled === true || $enabled === 1 || $enabled === '1')) {
        jsonOut(['ok' => false, 'error' => 'This mailbox is not actively assigned to a client.'], 409);
    }
    $client = MongoService::findOne('clients', ['id' => (string)($assignment['clientId'] ?? '')]);
    $recipient = trim((string)($client['email'] ?? ''));
    if ($recipient === '' || filter_var($recipient, FILTER_VALIDATE_EMAIL) === false) {
        jsonOut(['ok' => false, 'error' => 'The assigned client does not have a valid email address.'], 422);
    }
    hostingerMailApiRequestMethod(
        $token,
        '/api/v1/mailboxes/' . rawurlencode($resourceId) . '/send',
        'POST',
        ['to' => [$recipient], 'subject' => $subject, 'text' => $text] + ($html !== '' ? ['html' => $html] : [])
    );
    jsonOut([
        'ok' => true,
        'sent' => true,
        'from' => (string)($mailbox['address'] ?? ''),
        'to' => $recipient,
    ]);
}

if ($path === '/portal/mailboxes' && $method === 'GET') {
    $client = portalMailClientFromRequest();
    $clientId = (string)($client['id'] ?? '');
    $assignments = MongoService::getCollection('client_mailboxes', ['clientId' => $clientId], 100);
    $mailboxes = [];
    foreach ($assignments as $assignment) {
        $enabled = $assignment['enabled'] ?? false;
        if (!($enabled === true || $enabled === 1 || $enabled === '1')) continue;
        $mailboxes[] = hostingerMailAssignmentResponse($assignment, $client);
    }
    jsonOut(['ok' => true, 'data' => ['mailboxes' => $mailboxes]]);
}

if ($path === '/portal/mail' || $path === '/portal/mail/reply') {
    portalMailClientFromRequest();
    jsonOut(['ok' => false, 'error' => 'No active Hostinger mailbox is assigned to this portal account.'], 409);
}

if (preg_match('#^/portal/mailboxes/([^/]+)(?:/(.*))?$#', $path, $mailRoute)) {
    $client = portalMailClientFromRequest();
    $clientId = (string)($client['id'] ?? '');
    $resourceId = rawurldecode($mailRoute[1]);
    $subPath = (string)($mailRoute[2] ?? '');
    if ($resourceId === '') {
        jsonOut(['ok' => false, 'error' => 'Mailbox resource ID is required.'], 400);
    }
    hostingerMailEnabledAssignment($clientId, $resourceId);
    $integration = hostingerMailIntegration();
    $token = trim((string)($integration['token'] ?? ''));
    if ($token === '') {
        jsonOut(['ok' => false, 'error' => 'Hostinger Mail is not configured. Contact your administrator.'], 503);
    }
    $providerMailbox = '/api/v1/mailboxes/' . rawurlencode($resourceId);

    if ($subPath === 'folders' && $method === 'GET') {
        $response = hostingerMailApiRequestMethod($token, $providerMailbox . '/folders');
        $folders = hostingerMailApiData($response);
        if (isset($folders['folders']) && is_array($folders['folders'])) $folders = $folders['folders'];
        if (!array_is_list($folders)) {
            jsonOut(['ok' => false, 'error' => 'Hostinger Mail returned an unreadable folder list.'], 502);
        }
        jsonOut(['ok' => true, 'data' => ['folders' => $folders]]);
    }

    if ($subPath === 'quota' && $method === 'GET') {
        $response = hostingerMailApiRequestMethod($token, $providerMailbox . '/quota');
        jsonOut(['ok' => true, 'data' => ['quota' => hostingerMailApiData($response)]]);
    }

    if ($subPath === 'send' && $method === 'POST') {
        $recipients = [];
        foreach (['to', 'cc', 'bcc'] as $field) {
            $items = $body[$field] ?? [];
            if (!is_array($items)) {
                jsonOut(['ok' => false, 'error' => 'Email recipients must be provided as address lists.'], 422);
            }
            foreach ($items as $address) {
                $address = trim((string)$address);
                if ($address !== '' && filter_var($address, FILTER_VALIDATE_EMAIL) === false) {
                    jsonOut(['ok' => false, 'error' => 'One or more recipient email addresses are invalid.'], 422);
                }
                if ($address !== '') $recipients[] = $address;
            }
        }
        if (!$recipients) {
            jsonOut(['ok' => false, 'error' => 'Add at least one email recipient.'], 422);
        }
        if (!empty($body['sendIndividually'])) {
            $individualRecipients = array_values(array_unique(array_map(
                static fn(mixed $address): string => strtolower(trim((string)$address)),
                is_array($body['to'] ?? null) ? $body['to'] : []
            )));
            $individualRecipients = array_values(array_filter($individualRecipients, static fn(string $address): bool => $address !== ''));
            if (!$individualRecipients || count($individualRecipients) > 50) {
                jsonOut(['ok' => false, 'error' => 'Individual sending requires 1 to 50 To recipients.'], 422);
            }
            $sent = 0;
            foreach ($individualRecipients as $address) {
                $single = $body;
                unset($single['sendIndividually'], $single['cc'], $single['bcc']);
                $single['to'] = [$address];
                hostingerMailApiRequestMethod($token, $providerMailbox . '/send', 'POST', $single);
                $sent++;
            }
            jsonOut(['ok' => true, 'data' => ['message' => "Sent {$sent} individual email(s).", 'sentCount' => $sent, 'failed' => []]]);
        }
        unset($body['sendIndividually']);
        $response = hostingerMailApiRequestMethod($token, $providerMailbox . '/send', 'POST', $body);
        jsonOut(['ok' => true, 'data' => hostingerMailApiData($response)]);
    }

    if ($subPath === 'drafts' && $method === 'GET') {
        $storedDrafts = MongoService::getCollection('portal_mail_drafts', [
            'clientId' => $clientId,
            'mailboxId' => $resourceId,
        ], 500, 0, ['updatedAt' => -1]);
        $drafts = array_map('hostingerMailDraftResponse', $storedDrafts);
        jsonOut(['ok' => true, 'data' => ['drafts' => $drafts]]);
    }

    if ($subPath === 'drafts' && $method === 'POST') {
        $draftId = trim((string)($body['id'] ?? ''));
        if ($draftId === '') $draftId = 'draft_' . bin2hex(random_bytes(12));
        $now = date('c');
        $storedDraft = [
            'id' => $draftId,
            'clientId' => $clientId,
            'mailboxId' => $resourceId,
            'to' => is_array($body['to'] ?? null) ? $body['to'] : [],
            'cc' => is_array($body['cc'] ?? null) ? $body['cc'] : [],
            'bcc' => is_array($body['bcc'] ?? null) ? $body['bcc'] : [],
            'subject' => (string)($body['subject'] ?? ''),
            'text' => (string)($body['text'] ?? ''),
            'attachments' => is_array($body['attachments'] ?? null) ? $body['attachments'] : [],
            'updatedAt' => $now,
        ];
        foreach (['html', 'inReplyTo', 'forwardOf'] as $field) {
            if (isset($body[$field])) $storedDraft[$field] = $body[$field];
        }
        $existingDraft = MongoService::findOne('portal_mail_drafts', [
            'id' => $draftId,
            'clientId' => $clientId,
            'mailboxId' => $resourceId,
        ]);
        if ($existingDraft) {
            MongoService::updateOne('portal_mail_drafts', [
                'id' => $draftId,
                'clientId' => $clientId,
                'mailboxId' => $resourceId,
            ], $storedDraft);
        } else {
            $storedDraft['created_at'] = $now;
            MongoService::insert('portal_mail_drafts', $storedDraft);
        }
        jsonOut(['ok' => true, 'data' => ['draft' => hostingerMailDraftResponse($storedDraft)]]);
    }

    if (preg_match('#^drafts/([^/]+)$#', $subPath, $draftMatch) && $method === 'DELETE') {
        $draftId = rawurldecode($draftMatch[1]);
        $deleted = MongoService::deleteOne('portal_mail_drafts', [
            'id' => $draftId,
            'clientId' => $clientId,
            'mailboxId' => $resourceId,
        ]);
        if ($deleted === 0) {
            jsonOut(['ok' => false, 'error' => 'Draft not found.'], 404);
        }
        jsonOut(['ok' => true, 'data' => ['deleted' => $deleted]]);
    }

    if ($subPath === 'blocked-senders' && $method === 'GET') {
        $blocked = MongoService::getCollection('portal_blocked_senders', [
            'clientId' => $clientId,
            'mailboxId' => $resourceId,
        ], 1000, 0, ['blockedAt' => -1]);
        $blockedSenders = array_map(static fn(array $item): array => [
            'address' => (string)($item['address'] ?? ''),
            'blockedAt' => (string)($item['blockedAt'] ?? ''),
        ], $blocked);
        jsonOut(['ok' => true, 'data' => ['blockedSenders' => $blockedSenders]]);
    }

    if ($subPath === 'blocked-senders' && in_array($method, ['POST', 'DELETE'], true)) {
        $address = strtolower(trim((string)($body['address'] ?? '')));
        if (filter_var($address, FILTER_VALIDATE_EMAIL) === false) {
            jsonOut(['ok' => false, 'error' => 'Enter a valid sender email address.'], 422);
        }
        $blockedFilter = ['clientId' => $clientId, 'mailboxId' => $resourceId, 'address' => $address];
        if ($method === 'POST' && MongoService::findOne('portal_blocked_senders', $blockedFilter) === null) {
            MongoService::insert('portal_blocked_senders', $blockedFilter + ['blockedAt' => date('c')]);
        } elseif ($method === 'DELETE') {
            MongoService::deleteOne('portal_blocked_senders', $blockedFilter);
        }
        $blocked = MongoService::getCollection('portal_blocked_senders', [
            'clientId' => $clientId,
            'mailboxId' => $resourceId,
        ], 1000, 0, ['blockedAt' => -1]);
        $blockedSenders = array_map(static fn(array $item): array => [
            'address' => (string)($item['address'] ?? ''),
            'blockedAt' => (string)($item['blockedAt'] ?? ''),
        ], $blocked);
        $message = $method === 'POST'
            ? 'Sender added to this portal’s blocked-sender list.'
            : 'Sender removed from this portal’s blocked-sender list.';
        jsonOut(['ok' => true, 'data' => ['message' => $message, 'blockedSenders' => $blockedSenders]]);
    }

    if ($subPath === 'starred' && $method === 'GET') {
        $folderResponse = hostingerMailApiRequestMethod($token, $providerMailbox . '/folders');
        $folders = hostingerMailApiData($folderResponse);
        if (isset($folders['folders']) && is_array($folders['folders'])) $folders = $folders['folders'];
        $allMessages = [];
        foreach ($folders as $folder) {
            $folderPath = (string)($folder['path'] ?? '');
            if ($folderPath === '') continue;
            $endpoint = $providerMailbox . '/folders/' . rawurlencode($folderPath) . '/messages/search';
            $endpoint .= '?' . http_build_query(['page' => 1, 'perPage' => 100], '', '&', PHP_QUERY_RFC3986);
            $response = hostingerMailApiRequestMethod($token, $endpoint, 'POST', ['flags' => ['\\Flagged']]);
            $allMessages = array_merge($allMessages, hostingerMailMessagesResult($response)['messages']);
        }
        usort($allMessages, static fn(array $a, array $b): int => strcmp((string)($b['date'] ?? ''), (string)($a['date'] ?? '')));
        $page = hostingerMailPageQuery();
        $total = count($allMessages);
        $messages = array_slice($allMessages, ($page['page'] - 1) * $page['perPage'], $page['perPage']);
        jsonOut(['ok' => true, 'data' => [
            'messages' => $messages,
            'pagination' => [
                'page' => $page['page'],
                'perPage' => $page['perPage'],
                'total' => $total,
                'totalPages' => (int)ceil($total / $page['perPage']),
            ],
        ]]);
    }

    if (preg_match('#^folders/([^/]+)/messages(?:/([^/]+)(?:/([^/]+)(?:/([^/]+))?)?)?$#', $subPath, $messageRoute)) {
        $folder = rawurldecode($messageRoute[1]);
        $messagePart = rawurldecode((string)($messageRoute[2] ?? ''));
        $actionPart = rawurldecode((string)($messageRoute[3] ?? ''));
        $attachmentId = rawurldecode((string)($messageRoute[4] ?? ''));
        $messagesEndpoint = $providerMailbox . '/folders/' . rawurlencode($folder) . '/messages';

        if ($messagePart === '' && $method === 'GET') {
            $query = hostingerMailPageQuery() + ['sort' => '-uid'];
            $response = hostingerMailApiRequestMethod($token, $messagesEndpoint . '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986));
            jsonOut(['ok' => true, 'data' => hostingerMailMessagesResult($response)]);
        }
        if ($messagePart === 'search' && $method === 'POST') {
            $text = trim((string)($body['text'] ?? ''));
            $query = hostingerMailPageQuery();
            $response = hostingerMailApiRequestMethod(
                $token,
                $messagesEndpoint . '/search?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986),
                'POST',
                ['text' => $text]
            );
            jsonOut(['ok' => true, 'data' => hostingerMailMessagesResult($response)]);
        }
        if ($messagePart === 'bulk' && $method === 'POST') {
            $uids = array_values(array_unique(array_filter(
                is_array($body['uids'] ?? null) ? array_map('intval', $body['uids']) : [],
                static fn(int $uid): bool => $uid > 0
            )));
            if (!$uids || count($uids) > 100) {
                jsonOut(['ok' => false, 'error' => 'Select between 1 and 100 messages.'], 422);
            }
            $action = (string)($body['action'] ?? '');
            if ($action === 'move') {
                $targetFolder = trim((string)($body['targetFolder'] ?? ''));
                if ($targetFolder === '') jsonOut(['ok' => false, 'error' => 'Choose a destination folder.'], 422);
                $response = hostingerMailApiRequestMethod($token, $messagesEndpoint . '/move', 'POST', [
                    'uids' => $uids,
                    'targetFolder' => $targetFolder,
                ]);
            } elseif ($action === 'delete') {
                if (($body['confirmed'] ?? false) !== true) {
                    jsonOut(['ok' => false, 'error' => 'Message deletion requires confirmation.'], 422);
                }
                $response = hostingerMailApiRequestMethod($token, $messagesEndpoint . '/delete', 'POST', ['uids' => $uids]);
            } elseif ($action === 'flags') {
                $flags = array_filter([
                    'uids' => $uids,
                    'addFlags' => is_array($body['addFlags'] ?? null) ? array_values($body['addFlags']) : [],
                    'removeFlags' => is_array($body['removeFlags'] ?? null) ? array_values($body['removeFlags']) : [],
                ], static fn(mixed $value): bool => $value !== []);
                if (!isset($flags['addFlags']) && !isset($flags['removeFlags'])) {
                    jsonOut(['ok' => false, 'error' => 'Choose a message flag to update.'], 422);
                }
                $response = hostingerMailApiRequestMethod($token, $messagesEndpoint . '/flags', 'POST', $flags);
            } else {
                jsonOut(['ok' => false, 'error' => 'Unsupported bulk mail action.'], 422);
            }
            $result = hostingerMailApiData($response);
            jsonOut(['ok' => true, 'data' => [
                'message' => (string)($result['message'] ?? 'Hostinger Mail updated the selected messages.'),
                'failed' => (int)($result['failed'] ?? 0),
            ]]);
        }
        if ($messagePart === '' && $method === 'DELETE') {
            if (($body['confirmed'] ?? false) !== true) {
                jsonOut(['ok' => false, 'error' => 'Emptying a folder requires confirmation.'], 422);
            }
            $response = hostingerMailApiRequestMethod($token, $messagesEndpoint, 'DELETE');
            jsonOut(['ok' => true, 'data' => hostingerMailApiData($response)]);
        }
        if (ctype_digit($messagePart)) {
            $uid = (int)$messagePart;
            if ($uid < 1) jsonOut(['ok' => false, 'error' => 'A valid message UID is required.'], 400);
            $messageEndpoint = $messagesEndpoint . '/' . $uid;
            if ($actionPart === '' && $method === 'GET') {
                $messageResponse = hostingerMailApiRequestMethod($token, $messageEndpoint);
                $textResponse = hostingerMailApiRequestMethod($token, $messageEndpoint . '/text');
                jsonOut(['ok' => true, 'data' => [
                    'message' => hostingerMailApiData($messageResponse),
                    'body' => hostingerMailApiData($textResponse),
                ]]);
            }
            if ($actionPart === '' && $method === 'PATCH') {
                $flags = [
                    'addFlags' => is_array($body['addFlags'] ?? null) ? array_values($body['addFlags']) : [],
                    'removeFlags' => is_array($body['removeFlags'] ?? null) ? array_values($body['removeFlags']) : [],
                ];
                if (!$flags['addFlags'] && !$flags['removeFlags']) {
                    jsonOut(['ok' => false, 'error' => 'Choose a message flag to update.'], 422);
                }
                $response = hostingerMailApiRequestMethod($token, $messageEndpoint, 'PATCH', $flags);
                jsonOut(['ok' => true, 'data' => hostingerMailApiData($response)]);
            }
            if ($actionPart === 'move' && $method === 'POST') {
                $targetFolder = trim((string)($body['targetFolder'] ?? ''));
                if ($targetFolder === '') jsonOut(['ok' => false, 'error' => 'Choose a destination folder.'], 422);
                $response = hostingerMailApiRequestMethod($token, $messageEndpoint . '/move', 'POST', ['targetFolder' => $targetFolder]);
                jsonOut(['ok' => true, 'data' => hostingerMailApiData($response)]);
            }
            if ($actionPart === '' && $method === 'DELETE') {
                if (($body['confirmed'] ?? false) !== true) {
                    jsonOut(['ok' => false, 'error' => 'Message deletion requires confirmation.'], 422);
                }
                $response = hostingerMailApiRequestMethod($token, $messageEndpoint, 'DELETE');
                jsonOut(['ok' => true, 'data' => hostingerMailApiData($response)]);
            }
            if ($actionPart === 'attachments' && $attachmentId !== '' && $method === 'GET') {
                $attachment = hostingerMailApiBinaryRequest(
                    $token,
                    $messageEndpoint . '/attachments/' . rawurlencode($attachmentId)
                );
                header('Content-Type: ' . $attachment['contentType']);
                header('Content-Disposition: attachment');
                sendCors();
                echo $attachment['body'];
                exit;
            }
        }
    }
}

// Do not report success for routes that have no implementation.
jsonOut(['ok' => false, 'error' => 'Route not found.'], 404);
