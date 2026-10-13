<?php
/**
 * Codex Dynamics - Unified REST API Router for Hostinger Apache/PHP
 */

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/mongodb.php';
require_once __DIR__ . '/lib/client-access.php';
require_once __DIR__ . '/lib/hostinger-mail.php';
require_once __DIR__ . '/lib/core.php';
require_once __DIR__ . '/lib/route-helpers.php';
require_once __DIR__ . '/lib/feature-routes.php';

$method = $_SERVER['REQUEST_METHOD'];
$uri = $_SERVER['REQUEST_URI'];
$path = parse_url($uri, PHP_URL_PATH);

// Normalize path relative to /api/
$apiPath = preg_replace('#^.*?/api/?#', '/', $path);
$apiPath = '/' . ltrim($apiPath, '/');
$apiPath = preg_replace('#\.php$#', '', $apiPath);

$input = json_decode(file_get_contents('php://input') ?: '[]', true) ?: [];

if (isMongoStorageEnabled() && $apiPath === '/healthz') {
    try {
        verifyMongoConnection();
        jsonResponse([
            'status' => 'ok',
            'database' => 'mongodb',
            'storage_persistent' => true,
        ]);
    } catch (Throwable $error) {
        error_log('MongoDB health check failed: ' . $error->getMessage());
        jsonResponse(['status' => 'error', 'database' => 'mongodb'], 503);
    }
}

// Public content is the first read-only route migrated to MongoDB.
if (isMongoStorageEnabled()
    && in_array($apiPath, ['/public/content', '/content'], true)) {
    try {
        require __DIR__ . '/routes/01-public-website-content.php';
    } catch (Throwable $error) {
        error_log('MongoDB public-content request failed: ' . $error->getMessage());
        jsonResponse(['ok' => false, 'error' => 'MongoDB content storage is unavailable.'], 503);
    }
}

// Authentication is being moved one vertical slice at a time. Keep the
// migrated login/session endpoints independent of PDO, and explicitly stop
// authenticated features that still require SQL from consuming Mongo sessions.
if (isMongoStorageEnabled()) {
    $mongoAdminAuthRoutes = [
        '/admin/login' => 'POST',
        '/admin/me' => 'GET',
        '/admin/logout' => 'POST',
    ];
    $mongoPortalAuthRoutes = [
        '/portal/login' => 'POST',
        '/portal/logout' => 'POST',
    ];
    $isMongoImpersonationRoute = preg_match(
        '#^/admin/clients/[^/]+/impersonate$#',
        $apiPath,
    ) === 1;

    if (isset($mongoAdminAuthRoutes[$apiPath]) || isset($mongoPortalAuthRoutes[$apiPath])) {
        $expectedMethod = $mongoAdminAuthRoutes[$apiPath] ?? $mongoPortalAuthRoutes[$apiPath];
        if ($method !== $expectedMethod) {
            jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
        }

        try {
            $pdo = null;
            $adminSession = null;
            $portalSession = null;
            if (in_array($apiPath, ['/admin/me', '/admin/logout'], true)) {
                $adminSession = findMongoSession('admin_sessions', 'user_id');
                if (!$adminSession) {
                    jsonResponse(['ok' => false, 'error' => 'Authentication required.'], 401);
                }
            }
            if ($apiPath === '/portal/logout') {
                $portalSession = findMongoSession('portal_sessions', 'client_id');
                if (!$portalSession) {
                    jsonResponse(['ok' => false, 'error' => 'Client sign-in required.'], 401);
                }
            }

            if (isset($mongoAdminAuthRoutes[$apiPath])) {
                require __DIR__ . '/routes/13-authentication-staff-login.php';
            } else {
                require __DIR__ . '/routes/14-authentication-client-portal-login.php';
            }
            jsonResponse(['ok' => false, 'error' => 'API route not found.'], 404);
        } catch (Throwable $error) {
            error_log('MongoDB authentication request failed: ' . $error->getMessage());
            jsonResponse(['ok' => false, 'error' => 'MongoDB authentication storage is unavailable.'], 503);
        }
    }

    if ($isMongoImpersonationRoute) {
        jsonResponse(['ok' => false, 'error' => 'Client impersonation is not yet available in MongoDB mode.'], 501);
    }

    $mongoAdminRoutePatterns = [
        '#^/admin/notifications(?:/[^/]+(?:/read)?)?$#',
        '#^/admin/notifications/sent-log(?:/[^/]+)?$#',
        '#^/admin/users/[^/]+/notifications(?:/(?:clear|delete))?$#',
        '#^/admin/audit(?:/[^/]+)?$#',
        '#^/admin/users/[^/]+/profile-history(?:/[^/]+)?$#',
        '#^/admin/users$#',
        '#^/admin/users/[^/]+/appointments$#',
        '#^/admin/clients/[^/]+/portal-password$#',
        '#^/admin/users/[^/]+/set-password$#',
        '#^/admin/clients/[^/]+/set-password$#',
        '#^/admin/offices(?:/[^/]+)?$#',
        '#^/admin/teams$#',
        '#^/admin/staff$#',
        '#^/admin/staff/[^/]+/capabilities$#',
        '#^/admin/staff/[^/]+/notes(?:/import)?$#',
        '#^/admin/blog/categories(?:/[^/]+)?$#',
        '#^/admin/client-projects(?:/[^/]+)?$#',
        '#^/admin/client-identity-reviews(?:/[^/]+/[^/]+)?$#',
        '#^/admin/settings/webhook(?:-test)?$#',
        '#^/admin/me/password$#',
        '#^/admin/integrations/hostinger-mail(?:/test)?$#',
        '#^/admin/hostinger/(?:overview|mailboxes)(?:/[^/]+/stats)?$#',
        '#^/admin/clients/[^/]+/mailboxes(?:/[^/]+)?$#',
        '#^/admin/staff/[^/]+/mailboxes(?:/[^/]+)?$#',
        '#^/admin/(?:staff|client)-mailboxes/[^/]+/reassign$#',
    ];
    $mongoPortalRoutePatterns = [
        '#^/portal/(?:access|mail|mail/reply|data|profile|change-password|ticket)$#',
        '#^/portal/mailboxes(?:/[^/]+){0,8}$#',
        '#^/portal/projects/[^/]+/milestones/[^/]+/approve$#',
        '#^/portal/notifications$#',
        '#^/client/notifications$#',
    ];
    $mongoPublicRoutePatterns = [
        '#^/newsletter/subscribers$#',
        '#^/crm/clients$#',
        '#^/crm/action$#',
        '#^/crm/chat/(?:messages|import)$#',
    ];
    $matchesMongoPattern = static function (string $path, array $patterns): bool {
        foreach ($patterns as $pattern) {
            if (preg_match($pattern, $path) === 1) return true;
        }
        return false;
    };
    $isMongoAdminRoute = in_array($apiPath, ['/admin/settings'], true)
        || $matchesMongoPattern($apiPath, $mongoAdminRoutePatterns);
    $isMongoPortalRoute = $matchesMongoPattern($apiPath, $mongoPortalRoutePatterns);
    $isMongoPublicRoute = in_array($apiPath, ['/public/content', '/content'], true)
        || $matchesMongoPattern($apiPath, $mongoPublicRoutePatterns);

    if ($isMongoAdminRoute || $isMongoPortalRoute || $isMongoPublicRoute) {
        try {
            $pdo = null;
            $adminSession = null;
            $portalSession = null;
            if ($isMongoAdminRoute) {
                $adminSession = findMongoSession('admin_sessions', 'user_id');
                if (!$adminSession) {
                    jsonResponse(['ok' => false, 'error' => 'Authentication required.'], 401);
                }
            }
            if ($isMongoPortalRoute) {
                $portalSession = findMongoSession('portal_sessions', 'client_id');
                if (!$portalSession) {
                    jsonResponse(['ok' => false, 'error' => 'Client sign-in required.'], 401);
                }
                $portalAccess = mongoFindOne('client_portal_access', ['client_id' => $portalSession['id']]);
                if (!$portalAccess || ($portalAccess['status'] ?? null) !== 'Active'
                    || empty($portalAccess['portal_enabled'])) {
                    jsonResponse(['ok' => false, 'error' => 'This client portal account is unavailable.'], 401);
                }
                if (!empty($portalSession['impersonating'])
                    && in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)
                    && !in_array($apiPath, ['/portal/logout'], true)) {
                    jsonResponse(['ok' => false, 'error' => 'Client impersonation is read-only.'], 403);
                }
            }

            if (hostingerMailDispatch($pdo, $apiPath, $method, $input, $adminSession, $portalSession)) {
                exit;
            }

            if ($isMongoPublicRoute && in_array($apiPath, ['/public/content', '/content'], true)) {
                require __DIR__ . '/routes/01-public-website-content.php';
            }
            require __DIR__ . '/routes/02-client-intake.php';
            require __DIR__ . '/routes/03-crm-actions.php';
            require __DIR__ . '/routes/04-admin-client-search.php';
            require __DIR__ . '/routes/05-admin-set-client-password-view-password.php';
            require __DIR__ . '/routes/06-admin-notifications.php';
            require __DIR__ . '/routes/08-client-activity-audit-log.php';
            require __DIR__ . '/routes/09-admin-offices-management.php';
            require __DIR__ . '/routes/10-admin-teams-management.php';
            require __DIR__ . '/routes/11-admin-staff.php';
            require __DIR__ . '/routes/13-authentication-staff-login.php';
            require __DIR__ . '/routes/14-authentication-client-portal-login.php';
            require __DIR__ . '/routes/15-client-portal-complete-dashboard-data.php';
            require __DIR__ . '/routes/16-client-portal-support-tickets.php';
            handleCodexDynamicsFeatureRoutes($pdo, $apiPath, $method, $input, $adminSession, $portalSession);
            jsonResponse(['ok' => false, 'error' => 'API route not found.'], 404);
        } catch (Throwable $error) {
            error_log('MongoDB API request failed: ' . $error->getMessage());
            jsonResponse(['ok' => false, 'error' => 'MongoDB storage is unavailable.'], 503);
        }
    }

    if ($apiPath === '/admin' || str_starts_with($apiPath, '/admin/')
        || $apiPath === '/portal' || str_starts_with($apiPath, '/portal/')
        || $apiPath === '/client' || str_starts_with($apiPath, '/client/')) {
        jsonResponse(['ok' => false, 'error' => 'This authenticated endpoint has not yet been migrated to MongoDB.'], 501);
    }

    jsonResponse([
        'ok' => false,
        'error' => 'This endpoint has not yet been migrated to MongoDB; no SQL fallback was attempted.',
    ], 501);
}

$pdo = getDb();

class AccountingActionException extends RuntimeException {}

$adminSession = null;
$portalSession = null;
$isAdminLogin = $apiPath === '/admin/login';
$isPortalLogin = $apiPath === '/portal/login';
if (str_starts_with($apiPath, '/admin/') && !$isAdminLogin) {
    $adminSession = findSession($pdo, 'admin_sessions', 'user_id');
    if (!$adminSession) jsonResponse(['ok' => false, 'error' => 'Authentication required.'], 401);
}
if (($apiPath === '/portal/data'
    || $apiPath === '/portal/profile'
    || $apiPath === '/portal/change-password'
    || $apiPath === '/portal/ticket'
    || $apiPath === '/portal/notifications'
    || $apiPath === '/portal/access'
    || $apiPath === '/portal/mail'
    || $apiPath === '/portal/mail/reply'
    || $apiPath === '/portal/mailboxes'
    || str_starts_with($apiPath, '/portal/mailboxes/')
    || str_starts_with($apiPath, '/portal/projects/')
    || $apiPath === '/portal/messages/presence'
    || $apiPath === '/client/messages'
    || preg_match('#^/client/messages/[^/]+$#', $apiPath) === 1
    || $apiPath === '/portal/logout'
    || str_starts_with($apiPath, '/client/')) && !$isPortalLogin) {
    $portalSession = findSession($pdo, 'portal_sessions', 'client_id');
    if (!$portalSession) jsonResponse(['ok' => false, 'error' => 'Client sign-in required.'], 401);
    if ($apiPath !== '/portal/logout') {
        $portalAccountStmt = $pdo->prepare('SELECT status, portal_enabled FROM client_portal_access WHERE client_id = ?');
        $portalAccountStmt->execute([$portalSession['id']]);
        $portalAccount = $portalAccountStmt->fetch();
        if (!$portalAccount || $portalAccount['status'] !== 'Active' || empty($portalAccount['portal_enabled'])) {
            jsonResponse(['ok' => false, 'error' => 'This client portal account is unavailable.'], 401);
        }
    }
    if ($portalSession['impersonating']
        && in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)
        && $apiPath !== '/portal/logout') {
        jsonResponse(['ok' => false, 'error' => 'Client impersonation is read-only.'], 403);
    }
}

if (hostingerMailDispatch($pdo, $apiPath, $method, $input, $adminSession, $portalSession)) {
    exit;
}

if ($apiPath === '/healthz') {
    jsonResponse([
        'status' => 'ok',
        'database' => $pdo->getAttribute(PDO::ATTR_DRIVER_NAME),
        'storage_persistent' => $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) !== 'sqlite',
    ]);
}

if ($apiPath === '/portal/logout' && $method === 'POST') {
    $token = bearerToken(PORTAL_SESSION_COOKIE);
    clearSessionCookie(PORTAL_SESSION_COOKIE);
    $pdo->prepare('DELETE FROM portal_sessions WHERE token_hash = ?')
        ->execute([hash('sha256', $token)]);
    if (!empty($portalSession['impersonating'])) {
        $pdo->prepare('INSERT INTO audit_logs (id, user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)')
            ->execute([
                'aud_' . bin2hex(random_bytes(8)),
                $portalSession['id'],
                'ADMIN_CLIENT_IMPERSONATION_END',
                'Staff session ' . (string)($portalSession['admin_user_id'] ?? 'unknown') . ' ended client portal impersonation.',
                date('c'),
            ]);
    }
    jsonResponse(['ok' => true]);
}

// Route groups run in order; each exits via jsonResponse() when it matches.
require __DIR__ . '/routes/01-public-website-content.php';
require __DIR__ . '/routes/02-client-intake.php';
require __DIR__ . '/routes/03-crm-actions.php';
require __DIR__ . '/routes/04-admin-client-search.php';
require __DIR__ . '/routes/05-admin-set-client-password-view-password.php';
require __DIR__ . '/routes/06-admin-notifications.php';
require __DIR__ . '/routes/07-admin-client-support-chat.php';
require __DIR__ . '/routes/08-client-activity-audit-log.php';
require __DIR__ . '/routes/09-admin-offices-management.php';
require __DIR__ . '/routes/10-admin-teams-management.php';
require __DIR__ . '/routes/11-admin-staff.php';
require __DIR__ . '/routes/12-admin-client-assignment.php';
require __DIR__ . '/routes/13-authentication-staff-login.php';
require __DIR__ . '/routes/14-authentication-client-portal-login.php';
require __DIR__ . '/routes/15-client-portal-complete-dashboard-data.php';
require __DIR__ . '/routes/16-client-portal-support-tickets.php';

// Unknown routes must fail explicitly instead of looking like successful API calls.
handleCodexDynamicsFeatureRoutes($pdo, $apiPath, $method, $input, $adminSession ?? null, $portalSession ?? null);
jsonResponse(['ok' => false, 'error' => 'API route not found'], 404);
