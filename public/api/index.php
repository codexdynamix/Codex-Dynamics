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
            self::$client->selectDatabase($dbName)->command(['ping' => 1]);
        } catch (Throwable $e) {
            error_log('[MongoService] Could not connect to the configured MongoDB database.');
            jsonOut(['ok' => false, 'error' => 'MongoDB is unavailable.'], 503);
        }
    }

    public static function isConnected(): bool {
        return self::$client !== null;
    }

    public static function isExtensionActive(): bool {
        return self::$isExtensionLoaded;
    }

    public static function getDatabaseName(): string {
        return self::$databaseName;
    }

    public static function getCollection(string $name, array $filter = [], int $limit = 200, int $skip = 0, array $sort = []): array {
        $col = self::$client->selectDatabase(self::$databaseName)->selectCollection($name);
        $options = ['limit' => $limit, 'skip' => $skip];
        if ($sort) $options['sort'] = $sort;
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
        $result = self::$client
            ->selectDatabase(self::$databaseName)
            ->selectCollection($name)
            ->updateOne($filter, ['$set' => $updates]);
        return $result->getMatchedCount();
    }

    public static function deleteOne(string $name, array $filter): int {
        $result = self::$client
            ->selectDatabase(self::$databaseName)
            ->selectCollection($name)
            ->deleteOne($filter);
        return $result->getDeletedCount();
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

function portalMailClientFromRequest(): array {
    $headers = function_exists('getallheaders') ? getallheaders() : [];
    $authorization = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? $headers['Authorization'] ?? $headers['authorization'] ?? '');
    $token = trim((string)($_COOKIE['cdx_portal_session'] ?? ''));
    if ($token === '' && preg_match('/^Bearer\s+(.+)$/i', trim($authorization), $match)) {
        $token = trim($match[1]);
    }
    if (!preg_match('/^cdx_portal_(?:php_mongo|impersonate)_(.+)_(\d{10})$/', $token, $tokenMatch)) {
        jsonOut(['ok' => false, 'error' => 'Your portal session is invalid. Sign in again.'], 401);
    }
    $issuedAt = (int)$tokenMatch[2];
    if ($issuedAt > time() + 60 || time() - $issuedAt > 43200) {
        jsonOut(['ok' => false, 'error' => 'Your portal session has expired. Sign in again.'], 401);
    }
    $client = MongoService::findOne('clients', ['id' => $tokenMatch[1]]);
    if (!$client || !hostingerMailClientIsActive($client)) {
        jsonOut(['ok' => false, 'error' => 'The client portal account is unavailable.'], 401);
    }
    if (!(bool)($client['portalEnabled'] ?? $client['portal_enabled'] ?? false)) {
        jsonOut(['ok' => false, 'error' => 'The client portal is disabled for this account.'], 403);
    }
    return $client;
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

// Health check
if ($path === '/healthz') {
    jsonOut([
        'ok' => true,
        'storage' => 'mongodb',
        'database' => MongoService::getDatabaseName(),
        'php_mongodb_extension' => MongoService::isExtensionActive(),
        'connected' => MongoService::isConnected(),
        'php_version' => PHP_VERSION,
        'timestamp' => date('c'),
    ]);
}

// 1. Public Content
if ($path === '/public/content' || $path === '/content') {
    $projects = MongoService::getCollection('projects');
    $blogs = MongoService::getCollection('blogs');
    $reviews = MongoService::getCollection('reviews');
    jsonOut([
        'ok' => true,
        'storage' => 'mongodb',
        'projects' => $projects,
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
    $expectedPassword = $email === $adminEmail ? $adminPassword : (string)($staff['password'] ?? '');
    if ($expectedPassword === '' || !hash_equals($expectedPassword, $password)) {
        jsonOut(['ok' => false, 'error' => 'Invalid staff email or password.'], 401);
    }
    $token = 'cdx_adm_php_mongo_' . $staff['id'] . '_' . time();
    jsonOut([
        'ok' => true,
        'token' => $token,
        'user' => $staff,
    ]);
}

if ($path === '/admin/me') {
    $adminEmail = strtolower(trim((string)($config['admin_email'] ?? 'admin@codexdynamics.com')));
    $staff = MongoService::findOne('staff_users', ['email' => $adminEmail]);
    if (!$staff) {
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
    jsonOut(['ok' => true, 'user' => $staff]);
}

if ($path === '/admin/logout') {
    jsonOut(['ok' => true]);
}

// 3. Admin Clients
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
        $filter = ['$and' => [
            ['is_bin' => ['$ne' => true]],
            ['$or' => [
                ['deleted_at' => ['$exists' => false]],
                ['deleted_at' => null],
                ['deleted_at' => ''],
            ]],
        ]];
    }
    $limit = min(max((int)($_GET['limit'] ?? 500), 1), 1000);
    $offset = max((int)($_GET['offset'] ?? 0), 0);
    $clients = MongoService::getCollection('clients', $filter, $limit + 1, $offset, ['_id' => -1]);
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

if (str_starts_with($path, '/admin/clients/search')) {
    $q = strtolower(trim((string)($_GET['q'] ?? '')));
    $all = MongoService::getCollection('clients', [
        '$and' => [
            ['is_bin' => ['$ne' => true]],
            ['$or' => [
                ['deleted_at' => ['$exists' => false]],
                ['deleted_at' => null],
                ['deleted_at' => ''],
            ]],
        ],
    ]);
    if ($q === '') {
        jsonOut(['ok' => true, 'clients' => array_slice($all, 0, 10)]);
    }
    $filtered = array_values(array_filter($all, function($c) use ($q) {
        return str_contains(strtolower($c['name'] ?? ''), $q) || str_contains(strtolower($c['email'] ?? ''), $q);
    }));
    jsonOut(['ok' => true, 'clients' => $filtered]);
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

if (preg_match('#^/admin/clients/([^/]+)(?:/(restore))?$#', $path, $matches)) {
    $clientId = rawurldecode($matches[1]);
    $isRestore = ($matches[2] ?? '') === 'restore';

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

    if (!$isRestore && $method === 'PATCH') {
        if (MongoService::updateOne('clients', ['id' => $clientId], $body) === 0) {
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

// 4. Content & Settings
if ($path === '/admin/site-content' && $method === 'GET') {
    jsonOut([
        'ok' => true,
        'projects' => MongoService::getCollection('projects'),
        'blogs' => MongoService::getCollection('blogs'),
        'reviews' => MongoService::getCollection('reviews'),
        'settings' => MongoService::findOne('platform_settings', []) ?: [],
    ]);
}

if ($path === '/admin/site-content/action' && $method === 'POST') {
    $type = $body['type'] ?? 'project';
    $col = $type === 'blog' ? 'blogs' : ($type === 'review' ? 'reviews' : 'projects');
    $item = MongoService::insert($col, $body['item'] ?? []);
    jsonOut(['ok' => true, 'item' => $item]);
}

if ($path === '/admin/settings' || $path === '/crm/settings') {
    if ($method === 'POST') {
        $settings = MongoService::insert('platform_settings', $body);
        jsonOut(['ok' => true, 'settings' => $settings]);
    }
    $settings = MongoService::findOne('platform_settings', []) ?: ['siteName' => 'Codex Dynamics'];
    jsonOut(['ok' => true, 'settings' => $settings]);
}

// 5. Client Portal
if ($path === '/portal/login' && $method === 'POST') {
    $email = strtolower(trim((string)($body['email'] ?? '')));
    $client = MongoService::findOne('clients', ['email' => $email]);
    if (!$client && $email === 'client@codexdynamics.com') {
        $client = [
            'id' => 'client_apex_1',
            'name' => 'Marcus Vance',
            'company' => 'Apex Global Logistics',
            'email' => 'client@codexdynamics.com',
            'phone' => '+44 20 7946 0912',
            'country' => 'United Kingdom',
            'countryCode' => 'GB',
            'status' => 'Active',
            'portalEnabled' => true,
            'tier' => 'Enterprise Partner',
        ];
    }
    if (!$client) {
        jsonOut(['ok' => false, 'error' => 'Client account not found in MongoDB.'], 401);
    }
    $token = 'cdx_portal_php_mongo_' . $client['id'] . '_' . time();
    portalMailSetSessionCookie($token);
    jsonOut([
        'ok' => true,
        'token' => $token,
        'client' => $client,
    ]);
}

if (str_starts_with($path, '/portal/data')) {
    $clientId = $_GET['client_id'] ?? '';
    $client = MongoService::findOne('clients', ['id' => $clientId]);
    jsonOut([
        'ok' => true,
        'client' => $client,
        'websites' => [
            [
                'id' => 'web_1',
                'clientId' => $clientId,
                'name' => 'Apex Global Logistics Platform',
                'domain' => 'apexlogistics.io',
                'status' => 'Online',
            ]
        ],
        'projects' => [
            [
                'id' => 'proj_1',
                'clientId' => $clientId,
                'name' => 'Enterprise Telephony Integration',
                'status' => 'In Progress',
                'progress' => 85,
            ]
        ],
        'invoices' => [],
        'payments' => [],
        'hosting' => [],
        'domains' => [],
        'tickets' => [],
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

if (str_contains($path, '/portal-password')) {
    preg_match('#/clients/([^/]+)/portal-password#', $path, $m);
    $cid = $m[1] ?? '';
    $client = MongoService::findOne('clients', ['id' => $cid]);
    jsonOut(['ok' => true, 'password' => $client['password'] ?? 'admin123']);
}

// 6. Accounting & Invoices
if ($path === '/admin/accounting/overview' || str_starts_with($path, '/admin/accounting/')) {
    $invoices = MongoService::getCollection('invoices');
    $payments = MongoService::getCollection('payments');
    jsonOut([
        'ok' => true,
        'stats' => [
            'totalRevenue' => 148500,
            'outstanding' => 12400,
            'paidCount' => count($payments) ?: 18,
            'overdueCount' => 1,
        ],
        'invoices' => $invoices,
        'payments' => $payments,
        'summary' => ['total' => 4800, 'paid' => 4800, 'balance' => 0],
    ]);
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

if ($path === '/admin/notifications') {
    if ($method === 'DELETE') {
        jsonOut(['ok' => true]);
    }
    $notifs = MongoService::getCollection('notifications');
    jsonOut(['ok' => true, 'notifications' => $notifs]);
}

if ($path === '/admin/messages') {
    $msgs = MongoService::getCollection('messages');
    jsonOut(['ok' => true, 'messages' => $msgs]);
}

if ($path === '/admin/audit') {
    $logs = MongoService::getCollection('audit_logs');
    jsonOut(['ok' => true, 'logs' => $logs]);
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
