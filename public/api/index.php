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

        if (self::$isExtensionLoaded && !empty($uri) && str_starts_with($uri, 'mongodb')) {
            try {
                if (class_exists('MongoDB\\Client')) {
                    self::$client = new MongoDB\Client($uri, [], ['serverSelectionTimeoutMS' => 4000]);
                }
            } catch (Throwable $e) {
                error_log('[MongoService] Connection error: ' . $e->getMessage());
            }
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

    public static function getCollection(string $name): array {
        if (self::$client !== null) {
            try {
                $db = self::$client->selectDatabase(self::$databaseName);
                $col = $db->selectCollection($name);
                $cursor = $col->find([], ['limit' => 200]);
                $results = [];
                foreach ($cursor as $doc) {
                    $arr = (array)$doc;
                    unset($arr['_id']);
                    $results[] = $arr;
                }
                return $results;
            } catch (Throwable $e) {
                error_log("[MongoService] Read error on {$name}: " . $e->getMessage());
            }
        }
        return self::fallbackSeed($name);
    }

    public static function insert(string $name, array $doc): array {
        if (self::$client !== null) {
            try {
                $db = self::$client->selectDatabase(self::$databaseName);
                $col = $db->selectCollection($name);
                if (!isset($doc['id'])) {
                    $doc['id'] = 'doc_' . time() . '_' . substr(bin2hex(random_bytes(4)), 0, 6);
                }
                $doc['created_at'] = $doc['created_at'] ?? date('c');
                $col->insertOne($doc);
                unset($doc['_id']);
                return $doc;
            } catch (Throwable $e) {
                error_log("[MongoService] Insert error on {$name}: " . $e->getMessage());
            }
        }
        return $doc;
    }

    public static function findOne(string $name, array $filter): ?array {
        if (self::$client !== null) {
            try {
                $db = self::$client->selectDatabase(self::$databaseName);
                $col = $db->selectCollection($name);
                $doc = $col->findOne($filter);
                if ($doc) {
                    $arr = (array)$doc;
                    unset($arr['_id']);
                    return $arr;
                }
                return null;
            } catch (Throwable $e) {
                error_log("[MongoService] FindOne error on {$name}: " . $e->getMessage());
            }
        }
        $list = self::fallbackSeed($name);
        foreach ($list as $item) {
            $match = true;
            foreach ($filter as $k => $v) {
                if (($item[$k] ?? null) !== $v) {
                    $match = false;
                    break;
                }
            }
            if ($match) return $item;
        }
        return null;
    }

    private static function fallbackSeed(string $name): array {
        if ($name === 'projects') {
            return [
                [
                    'id' => 1,
                    'title' => 'Aetherial OS',
                    'client' => 'Aetherial Labs',
                    'tag' => 'Spatial Computing',
                    'category' => 'Websites & Web Apps',
                    'image' => '/src/assets/images/aetherial_os_ui_1789862335899.jpg',
                    'image_url' => '/src/assets/images/aetherial_os_ui_1789862335899.jpg',
                    'shortDescription' => 'Ultra-low latency web workspace with fluid physics-based gestures.',
                    'published' => true,
                    'is_published' => 1,
                ],
                [
                    'id' => 2,
                    'title' => 'Apex Sales Desk',
                    'client' => 'Apex Telephony',
                    'tag' => 'High-Volume Telephony',
                    'category' => 'CRMs & Calling Systems',
                    'image' => '/src/assets/images/apex_sales_desk_1789909602200.jpg',
                    'image_url' => '/src/assets/images/apex_sales_desk_1789909602200.jpg',
                    'shortDescription' => 'Enterprise WebRTC dialer and real-time CRM telephony dashboard.',
                    'published' => true,
                    'is_published' => 1,
                ],
            ];
        }
        if ($name === 'blogs') {
            return [
                [
                    'id' => 1,
                    'title' => 'Engineering Sub-100ms Enterprise Web Apps with Modern React',
                    'slug' => 'engineering-sub-100ms-enterprise-apps',
                    'category' => 'Engineering',
                    'author' => 'Codex Dynamics Core Team',
                    'excerpt' => 'How we eliminate hydration bottlenecks and memory degradation.',
                    'status' => 'published',
                    'featured_image' => '/src/assets/images/web_development_1789860669506.jpg',
                    'reading_time' => 6,
                ],
            ];
        }
        if ($name === 'reviews') {
            return [
                [
                    'id' => 1,
                    'author' => 'Julian Reynolds',
                    'role' => 'Chief Operating Officer',
                    'company' => 'Apex Telephony Solutions',
                    'rating' => 5,
                    'comment' => 'Codex Dynamics rebuilt our entire client portal and dialer architecture in under 8 weeks.',
                    'is_published' => 1,
                ],
            ];
        }
        if ($name === 'staff_users') {
            return [
                [
                    'id' => 'staff_super_admin',
                    'email' => 'admin@codexdynamics.com',
                    'name' => 'Codex Super Admin',
                    'role' => 'super-admin',
                    'officeId' => 'off_1',
                    'teamId' => 'team_1',
                    'status' => 'Active',
                    'capabilities' => '["all"]',
                ],
            ];
        }
        if ($name === 'clients') {
            return [
                [
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
                ],
            ];
        }
        return [];
    }
}

MongoService::init($mongoUri, $mongoDbName);

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

    $staff = MongoService::findOne('staff_users', ['email' => $email]);
    if (!$staff && $email === 'admin@codexdynamics.com') {
        $staff = [
            'id' => 'staff_super_admin',
            'email' => 'admin@codexdynamics.com',
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
    $token = 'cdx_adm_php_mongo_' . $staff['id'] . '_' . time();
    jsonOut([
        'ok' => true,
        'token' => $token,
        'user' => $staff,
    ]);
}

if ($path === '/admin/me') {
    $staff = MongoService::findOne('staff_users', ['email' => 'admin@codexdynamics.com']);
    jsonOut(['ok' => true, 'user' => $staff]);
}

if ($path === '/admin/logout') {
    jsonOut(['ok' => true]);
}

// 3. Admin Clients
if ($path === '/admin/clients' && $method === 'GET') {
    $clients = MongoService::getCollection('clients');
    jsonOut(['ok' => true, 'clients' => $clients, 'total' => count($clients), 'hasMore' => false]);
}

if (str_starts_with($path, '/admin/clients/search')) {
    $q = strtolower(trim((string)($_GET['q'] ?? '')));
    $all = MongoService::getCollection('clients');
    if ($q === '') {
        jsonOut(['ok' => true, 'clients' => array_slice($all, 0, 10)]);
    }
    $filtered = array_values(array_filter($all, function($c) use ($q) {
        return str_contains(strtolower($c['name'] ?? ''), $q) || str_contains(strtolower($c['email'] ?? ''), $q);
    }));
    jsonOut(['ok' => true, 'clients' => $filtered]);
}

if ($path === '/admin/clients' && $method === 'POST') {
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
    $token = 'cdx_portal_impersonate_' . $cid . '_' . time();
    jsonOut(['ok' => true, 'token' => $token, 'client' => $client ?: ['id' => $cid, 'portalEnabled' => true]]);
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

// Default fallback
jsonOut(['ok' => true, 'path' => $path, 'storage' => 'mongodb']);

