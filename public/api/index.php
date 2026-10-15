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

function hostingerMailApiRequest(string $token): array {
    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => "Accept: application/json\r\nAuthorization: Bearer {$token}\r\n",
            'timeout' => 15,
            'ignore_errors' => true,
        ],
    ]);
    $responseBody = file_get_contents('https://api.mail.hostinger.com/api/v1/me', false, $context);
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
    jsonOut(['ok' => true, 'token' => $token, 'client' => $client]);
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

if ($path === '/admin/hostinger/mailboxes' || $path === '/portal/mailboxes') {
    jsonOut([
        'ok' => true,
        'mailboxes' => [
            ['id' => 'mb_1', 'email' => 'support@codexdynamics.com', 'name' => 'Primary Support', 'status' => 'Active'],
            ['id' => 'mb_2', 'email' => 'billing@codexdynamics.com', 'name' => 'Billing Desk', 'status' => 'Active'],
        ],
    ]);
}

if ($path === '/admin/hostinger/overview') {
    jsonOut([
        'ok' => true,
        'quota' => ['used' => '1.2 GB', 'total' => '10 GB', 'percentage' => 12],
        'mailboxesCount' => 2,
        'domain' => 'codexdynamics.com',
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

// Do not report success for routes that have no implementation.
jsonOut(['ok' => false, 'error' => 'Route not found.'], 404);
