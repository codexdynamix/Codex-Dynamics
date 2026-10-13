<?php
/**
 * Server-side Hostinger Mail API integration.
 *
 * The provider token is stored only as an authenticated-encrypted value in
 * hostinger_mail_integrations. Portal requests are authorized against the
 * authenticated client session and an enabled mailbox assignment before any
 * provider request is made.
 */

declare(strict_types=1);

final class HostingerMailApiException extends RuntimeException {
    public function __construct(
        public readonly int $providerStatus,
        public readonly string $providerCode = ''
    ) {
        parent::__construct('Hostinger Mail API request failed.');
    }
}

function hostingerMailNow(): string {
    return date('c');
}

function hostingerMailIntegration(?PDO $pdo): ?array {
    if ($pdo === null && isMongoStorageEnabled()) {
        return mongoFindOne('hostinger_mail_integrations', ['id' => 'primary']);
    }
    $stmt = $pdo->prepare("SELECT * FROM hostinger_mail_integrations WHERE id = 'primary' LIMIT 1");
    $stmt->execute();
    $row = $stmt->fetch();
    return $row ?: null;
}

function hostingerMailRecordStatus(?PDO $pdo, string $status, ?string $errorCode = null, bool $tested = false, ?array $account = null): void {
    $row = hostingerMailIntegration($pdo);
    if (!$row) return;

    $now = hostingerMailNow();
    if ($pdo === null && isMongoStorageEnabled()) {
        $updates = ['status' => $status, 'last_error_code' => $errorCode, 'updated_at' => $now];
        if ($tested) $updates['last_tested_at'] = $now;
        if ($status === 'connected') {
            $updates['last_success_at'] = $now;
            if ($account !== null) {
                $updates['mailbox_count'] = count($account['mailboxes'] ?? []);
                $updates['order_resource_id'] = (string)($account['orderResourceId'] ?? '');
            }
        }
        getMongoCollection(mongoCollectionName('hostinger_mail_integrations'))->updateOne(
            ['id' => 'primary'],
            ['$set' => $updates],
        );
        return;
    }
    $set = ['status = ?', 'last_error_code = ?', 'updated_at = ?'];
    $values = [$status, $errorCode, $now];
    if ($tested) {
        $set[] = 'last_tested_at = ?';
        $values[] = $now;
    }
    if ($status === 'connected') {
        $set[] = 'last_success_at = ?';
        $values[] = $now;
        if ($account !== null) {
            $set[] = 'mailbox_count = ?';
            $values[] = count($account['mailboxes'] ?? []);
            $set[] = 'order_resource_id = ?';
            $values[] = (string)($account['orderResourceId'] ?? '');
        }
    }
    $values[] = 'primary';
    $pdo->prepare('UPDATE hostinger_mail_integrations SET ' . implode(', ', $set) . ' WHERE id = ?')->execute($values);
}

function hostingerMailToken(?PDO $pdo): string {
    $row = hostingerMailIntegration($pdo);
    if (!$row || empty($row['encrypted_token'])) {
        throw new RuntimeException('Hostinger Mail API is not configured.');
    }
    $token = decryptClientSecret((string)$row['encrypted_token']);
    if ($token === '') throw new RuntimeException('Hostinger Mail API is not configured.');
    return $token;
}

function hostingerMailApiBaseUrl(): string {
    $testUrl = trim((string)(getenv('HOSTINGER_MAIL_TEST_BASE_URL') ?: ''));
    if (getenv('NODE_ENV') === 'test' && $testUrl !== '') {
        $parts = parse_url($testUrl);
        $allowedHosts = ['127.0.0.1', 'localhost', '::1'];
        if (
            !is_array($parts)
            || ($parts['scheme'] ?? '') !== 'http'
            || !in_array($parts['host'] ?? '', $allowedHosts, true)
            || !isset($parts['port'])
            || $parts['port'] < 1
            || $parts['port'] > 65535
            || isset($parts['user'])
            || isset($parts['pass'])
            || isset($parts['query'])
            || isset($parts['fragment'])
            || !in_array($parts['path'] ?? '', ['', '/'], true)
        ) {
            throw new InvalidArgumentException('The Hostinger test endpoint must be a local HTTP URL.');
        }
        return rtrim($testUrl, '/');
    }
    return 'https://api.mail.hostinger.com';
}

function hostingerMailRequestWithToken(string $token, string $method, string $path, ?array $payload = null): array {
    if (!function_exists('curl_init')) {
        throw new HostingerMailApiException(0, 'curl_unavailable');
    }
    if (!preg_match('#^/api/v1/[A-Za-z0-9._~/%?=&-]+$#', $path)) {
        throw new InvalidArgumentException('Invalid Hostinger Mail API path.');
    }

    $baseUrl = hostingerMailApiBaseUrl();
    $protocol = parse_url($baseUrl, PHP_URL_SCHEME) === 'https' ? CURLPROTO_HTTPS : CURLPROTO_HTTP;
    $headers = [
        'Accept: application/json',
        'Authorization: Bearer ' . $token,
    ];
    $options = [
        CURLOPT_URL => $baseUrl . $path,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => strtoupper($method),
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_CONNECTTIMEOUT => 7,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROTOCOLS => $protocol,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ];
    if ($payload !== null) {
        $encoded = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($encoded === false) throw new RuntimeException('Could not encode the email request.');
        $options[CURLOPT_POSTFIELDS] = $encoded;
        $headers[] = 'Content-Type: application/json';
        $options[CURLOPT_HTTPHEADER] = $headers;
    }

    $handle = curl_init();
    if ($handle === false) throw new HostingerMailApiException(0, 'curl_unavailable');
    curl_setopt_array($handle, $options);
    $body = curl_exec($handle);
    $curlError = curl_errno($handle);
    $status = (int)curl_getinfo($handle, CURLINFO_HTTP_CODE);
    curl_close($handle);

    if ($body === false || $curlError !== 0) {
        throw new HostingerMailApiException(0, 'network_error');
    }
    $decoded = $body === '' ? [] : json_decode((string)$body, true);
    if ($status < 200 || $status >= 300) {
        $providerCode = is_array($decoded) ? (string)($decoded['code'] ?? '') : '';
        throw new HostingerMailApiException($status, preg_replace('/[^A-Za-z0-9_.-]/', '', $providerCode) ?: '');
    }
    if ($status !== 204 && !is_array($decoded)) {
        throw new HostingerMailApiException($status, 'invalid_response');
    }
    return ['status' => $status, 'json' => is_array($decoded) ? $decoded : []];
}

function hostingerMailStoredRequest(?PDO $pdo, string $method, string $path, ?array $payload = null): array {
    $token = hostingerMailToken($pdo);
    try {
        $response = hostingerMailRequestWithToken($token, $method, $path, $payload);
        hostingerMailRecordStatus($pdo, 'connected');
        return $response;
    } catch (HostingerMailApiException $error) {
        if (in_array($error->providerStatus, [0, 401, 403], true) || $error->providerStatus >= 500) {
            hostingerMailRecordStatus($pdo, 'connection_error', $error->providerCode ?: 'connection_error');
        }
        throw $error;
    }
}

function hostingerMailResponseData(array $response): array {
    $data = $response['json']['data'] ?? [];
    return is_array($data) ? $data : [];
}

function hostingerMailResponseCollection(array $response): array {
    $body = $response['json'] ?? [];
    return is_array($body) ? $body : [];
}

function hostingerMailQuery(array $values): string {
    return http_build_query($values, '', '&', PHP_QUERY_RFC3986);
}

function hostingerMailSegment(string $value): string {
    return rawurlencode($value);
}

function hostingerMailRecordAudit(?PDO $pdo, string $staffId, string $action, string $details, ?string $clientName = null): void {
    if ($pdo === null && isMongoStorageEnabled()) {
        mongoInsert('audit_logs', [
            'id' => 'aud_' . bin2hex(random_bytes(8)),
            'user_id' => $staffId,
            'client_name' => $clientName,
            'action' => $action,
            'details' => $details,
            'ip_address' => $_SERVER['REMOTE_ADDR'] ?? null,
            'created_at' => hostingerMailNow(),
        ]);
        return;
    }
    $pdo->prepare('INSERT INTO audit_logs (id, user_id, client_name, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        ->execute([
            'aud_' . bin2hex(random_bytes(8)),
            $staffId,
            $clientName,
            $action,
            $details,
            $_SERVER['REMOTE_ADDR'] ?? null,
            hostingerMailNow(),
        ]);
}

function hostingerMailAccountWithToken(string $token): array {
    $response = hostingerMailRequestWithToken($token, 'GET', '/api/v1/me');
    $account = hostingerMailResponseData($response);
    if (!isset($account['mailboxes']) || !is_array($account['mailboxes'])) {
        throw new HostingerMailApiException(502, 'invalid_account_response');
    }
    return $account;
}

function hostingerMailAccount(?PDO $pdo): array {
    $response = hostingerMailStoredRequest($pdo, 'GET', '/api/v1/me');
    $account = hostingerMailResponseData($response);
    if (!isset($account['mailboxes']) || !is_array($account['mailboxes'])) {
        throw new HostingerMailApiException(502, 'invalid_account_response');
    }
    hostingerMailRecordStatus($pdo, 'connected', null, false, $account);
    return $account;
}

function hostingerMailNormalizeProviderMailboxes(array $account, ?PDO $pdo): array {
    if ($pdo === null && isMongoStorageEnabled()) {
        $assignments = [];
        foreach (mongoFindMany('client_mailboxes', ['provider' => 'hostinger']) as $row) {
            $client = mongoFindOne('clients', ['id' => (string)($row['client_id'] ?? '')]) ?? [];
            $assignments[(string)$row['provider_mailbox_id']] = [
                'client_id' => $row['client_id'] ?? null,
                'staff_id' => null,
                'client_name' => $client['name'] ?? '',
                'client_company' => $client['company'] ?? '',
            ];
        }
        foreach (mongoFindMany('staff_mailboxes', ['provider' => 'hostinger']) as $row) {
            $assignments[(string)$row['provider_mailbox_id']] = [
                'client_id' => null,
                'staff_id' => $row['staff_id'] ?? null,
                'client_name' => '',
                'client_company' => '',
            ];
        }
        $mailboxes = [];
        foreach ($account['mailboxes'] as $mailbox) {
            if (!is_array($mailbox)) continue;
            $resourceId = (string)($mailbox['resourceId'] ?? '');
            $address = (string)($mailbox['address'] ?? '');
            if ($resourceId === '' || $address === '') continue;
            $assigned = $assignments[$resourceId] ?? null;
            $mailboxes[] = [
                'resourceId' => $resourceId,
                'address' => $address,
                'assignedStaffId' => $assigned['staff_id'] ?? null,
                'assignedClientId' => $assigned['client_id'] ?? null,
                'assignedClientName' => $assigned
                    ? (string)(($assigned['client_company'] ?? '') ?: ($assigned['client_name'] ?? ''))
                    : null,
            ];
        }
        return $mailboxes;
    }
    $assignmentStmt = $pdo->prepare(
        'SELECT m.provider_mailbox_id, m.client_id, m.staff_id, m.email_address,
                c.name AS client_name, c.company AS client_company,
                st.name AS staff_name
         FROM (
             SELECT provider_mailbox_id, client_id, NULL AS staff_id, email_address, provider FROM client_mailboxes
             UNION ALL
             SELECT provider_mailbox_id, NULL AS client_id, staff_id, email_address, provider FROM staff_mailboxes
         ) m
         LEFT JOIN clients c ON c.id = m.client_id
         LEFT JOIN staff_users st ON st.id = m.staff_id
         WHERE m.provider = ?'
    );
    $assignmentStmt->execute(['hostinger']);
    $assignments = [];
    foreach ($assignmentStmt->fetchAll() as $assignment) {
        $assignments[(string)$assignment['provider_mailbox_id']] = $assignment;
    }

    $mailboxes = [];
    foreach ($account['mailboxes'] as $mailbox) {
        if (!is_array($mailbox)) continue;
        $resourceId = (string)($mailbox['resourceId'] ?? '');
        $address = (string)($mailbox['address'] ?? '');
        if ($resourceId === '' || $address === '') continue;
        $assigned = $assignments[$resourceId] ?? null;
        $mailboxes[] = [
            'resourceId' => $resourceId,
            'address' => $address,
            'assignedStaffId' => $assigned['staff_id'] ?? null,
            'assignedClientId' => $assigned['client_id'] ?? null,
            'assignedClientName' => $assigned ? ((string)($assigned['client_company'] ?: $assigned['client_name'])) : null,
        ];
    }
    return $mailboxes;
}

function hostingerMailRequireClientMailbox(?PDO $pdo, string $clientId, string $resourceId): array {
    if (!preg_match('/^AC[A-Za-z0-9]+$/', $resourceId)) {
        jsonResponse(['ok' => false, 'error' => 'This email account is currently unavailable.'], 403);
    }
    if ($pdo === null && isMongoStorageEnabled()) {
        $assignment = mongoFindOne('client_mailboxes', [
            'client_id' => $clientId,
            'provider' => 'hostinger',
            'provider_mailbox_id' => $resourceId,
        ]);
        if (!$assignment || ($assignment['status'] ?? null) !== 'enabled') {
            jsonResponse(['ok' => false, 'error' => 'This email account is currently unavailable.'], 403);
        }
        return $assignment;
    }
    $stmt = $pdo->prepare(
        "SELECT id, client_id, provider_mailbox_id, email_address, display_name, status
         FROM client_mailboxes
         WHERE client_id = ? AND provider = 'hostinger' AND provider_mailbox_id = ?
         LIMIT 1"
    );
    $stmt->execute([$clientId, $resourceId]);
    $assignment = $stmt->fetch();
    if (!$assignment) {
        jsonResponse(['ok' => false, 'error' => 'This email account is currently unavailable.'], 403);
    }
    if ($assignment['status'] !== 'enabled') {
        jsonResponse(['ok' => false, 'error' => 'This email account is currently unavailable.'], 403);
    }
    return $assignment;
}

function hostingerMailSafeProviderError(HostingerMailApiException $error, bool $adminRequest): array {
    if ($error->providerStatus === 429) {
        return ['Too many requests. Please try again shortly.', 429];
    }
    if ($error->providerStatus === 404) {
        return ['This email account is currently unavailable.', 404];
    }
    if (in_array($error->providerStatus, [401, 403], true)) {
        return [
            $adminRequest
                ? 'Hostinger rejected the credential or it does not have Mail API access.'
                : 'Email service is temporarily unavailable. Please contact your administrator.',
            $adminRequest ? 422 : 503,
        ];
    }
    if (in_array($error->providerStatus, [400, 422], true)) {
        return [
            $adminRequest
                ? 'Hostinger could not validate the request. Check the token and mailbox scope.'
                : 'The email request could not be completed. Review the message details and try again.',
            $adminRequest ? 422 : 422,
        ];
    }
    return [
        $adminRequest
            ? 'Unable to connect to the Hostinger Mail API. Please try again.'
            : 'Unable to connect to the email service. Please try again.',
        502,
    ];
}

function hostingerMailPageParam(string $key, int $default, int $maximum): int {
    $value = filter_var($_GET[$key] ?? $default, FILTER_VALIDATE_INT);
    if ($value === false || $value < 1 || $value > $maximum) {
        jsonResponse(['ok' => false, 'error' => 'The requested page size is invalid.'], 422);
    }
    return (int)$value;
}

function hostingerMailFolderPath(string $resourceId, string $folder, string $suffix = ''): string {
    return '/api/v1/mailboxes/' . hostingerMailSegment($resourceId)
        . '/folders/' . hostingerMailSegment($folder) . $suffix;
}

function hostingerMailListFolders(?PDO $pdo, string $resourceId): array {
    $response = hostingerMailStoredRequest(
        $pdo,
        'GET',
        '/api/v1/mailboxes/' . hostingerMailSegment($resourceId) . '/folders?' . hostingerMailQuery(['page' => 1, 'perPage' => 100])
    );
    return hostingerMailResponseCollection($response);
}

function hostingerMailNormalizeAddresses(mixed $value, string $field): array {
    if ($value === null || $value === '') return [];
    if (!is_array($value)) {
        jsonResponse(['ok' => false, 'error' => 'Recipients must be supplied as a list of email addresses.'], 422);
    }
    if (count($value) > 100) jsonResponse(['ok' => false, 'error' => 'Too many recipients were provided.'], 422);
    $addresses = [];
    foreach ($value as $address) {
        if (!is_string($address)) jsonResponse(['ok' => false, 'error' => 'A recipient address is invalid.'], 422);
        $address = trim($address);
        if ($address === '') continue;
        if (strlen($address) > 254 || filter_var($address, FILTER_VALIDATE_EMAIL) === false) {
            jsonResponse(['ok' => false, 'error' => 'A recipient address is invalid.'], 422);
        }
        $addresses[] = $address;
    }
    return $addresses;
}

function hostingerMailNormalizeAttachments(mixed $value): array {
    if ($value === null || $value === '') return [];
    if (!is_array($value) || count($value) > 20) {
        jsonResponse(['ok' => false, 'error' => 'Attachments could not be validated.'], 422);
    }

    $totalBytes = 0;
    $attachments = [];
    $blockedExtensions = ['php', 'phtml', 'phar', 'exe', 'dll', 'bat', 'cmd', 'com', 'msi', 'sh', 'ps1', 'js', 'cjs', 'mjs', 'vbs', 'vbe', 'jse', 'wsf', 'wsh', 'hta', 'scr', 'jar', 'html', 'htm', 'mhtml', 'xhtml', 'svg', 'lnk', 'url', 'reg'];
    foreach ($value as $attachment) {
        if (!is_array($attachment)) jsonResponse(['ok' => false, 'error' => 'Attachments could not be validated.'], 422);
        $filename = trim((string)($attachment['filename'] ?? ''));
        $content = (string)($attachment['content'] ?? '');
        $contentType = trim((string)($attachment['contentType'] ?? 'application/octet-stream'));
        if ($filename === '' || strlen($filename) > 255 || preg_match('/[\r\n\/\\\\]/', $filename)) {
            jsonResponse(['ok' => false, 'error' => 'An attachment filename is invalid.'], 422);
        }
        $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
        if ($extension !== '' && in_array($extension, $blockedExtensions, true)) {
            jsonResponse(['ok' => false, 'error' => 'This file type cannot be attached.'], 422);
        }
        if (!preg_match('#^[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+$#', $contentType)) {
            jsonResponse(['ok' => false, 'error' => 'An attachment type is invalid.'], 422);
        }
        if (($attachment['encoding'] ?? 'base64') !== 'base64') {
            jsonResponse(['ok' => false, 'error' => 'Attachments must be supplied as base64 data.'], 422);
        }
        $decoded = base64_decode($content, true);
        if ($decoded === false) jsonResponse(['ok' => false, 'error' => 'An attachment could not be validated.'], 422);
        $size = strlen($decoded);
        if ($size > 10 * 1024 * 1024) jsonResponse(['ok' => false, 'error' => 'Each attachment must be 10 MB or smaller.'], 422);
        $totalBytes += $size;
        if ($totalBytes > 20 * 1024 * 1024) jsonResponse(['ok' => false, 'error' => 'Attachments must total 20 MB or less.'], 422);
        $normalized = [
            'filename' => $filename,
            'content' => base64_encode($decoded),
            'contentType' => $contentType,
            'encoding' => 'base64',
        ];
        if (isset($attachment['cid']) && is_string($attachment['cid']) && strlen($attachment['cid']) <= 255) {
            $normalized['cid'] = $attachment['cid'];
        }
        $attachments[] = $normalized;
    }
    return $attachments;
}

function hostingerMailNormalizeMessageRef(mixed $value): ?array {
    if ($value === null || $value === '') return null;
    if (!is_array($value)) jsonResponse(['ok' => false, 'error' => 'The message reference is invalid.'], 422);
    $uid = filter_var($value['uid'] ?? null, FILTER_VALIDATE_INT);
    $folder = trim((string)($value['folder'] ?? ''));
    if ($uid === false || $uid < 1 || $folder === '' || strlen($folder) > 100) {
        jsonResponse(['ok' => false, 'error' => 'The message reference is invalid.'], 422);
    }
    return ['uid' => (int)$uid, 'folder' => $folder];
}

function hostingerMailNormalizeCompose(array $input, bool $forSending): array {
    $to = hostingerMailNormalizeAddresses($input['to'] ?? [], 'to');
    $cc = hostingerMailNormalizeAddresses($input['cc'] ?? [], 'cc');
    $bcc = hostingerMailNormalizeAddresses($input['bcc'] ?? [], 'bcc');
    $subject = trim((string)($input['subject'] ?? ''));
    $text = (string)($input['text'] ?? '');
    $html = (string)($input['html'] ?? '');
    if (strlen($subject) > 998 || strlen($text) > 1024 * 1024 || strlen($html) > 1024 * 1024) {
        jsonResponse(['ok' => false, 'error' => 'The message is too large to send.'], 422);
    }

    $inReplyTo = hostingerMailNormalizeMessageRef($input['inReplyTo'] ?? null);
    $forwardOf = hostingerMailNormalizeMessageRef($input['forwardOf'] ?? null);
    if ($inReplyTo && $forwardOf) {
        jsonResponse(['ok' => false, 'error' => 'A message cannot be both a reply and a forward.'], 422);
    }
    $attachments = hostingerMailNormalizeAttachments($input['attachments'] ?? []);
    if ($forSending) {
        if (!$to && !$cc && !$bcc) jsonResponse(['ok' => false, 'error' => 'Add at least one recipient before sending.'], 422);
        if (trim($text) === '' && trim(strip_tags($html)) === '') jsonResponse(['ok' => false, 'error' => 'Write a message before sending.'], 422);
    }

    // Draft records need a stable, complete shape even when fields are blank.
    // Provider send requests, by contrast, omit empty optional fields.
    $payload = [];
    if (!$forSending || $to) $payload['to'] = $to;
    if (!$forSending || $cc) $payload['cc'] = $cc;
    if (!$forSending || $bcc) $payload['bcc'] = $bcc;
    $payload['subject'] = $subject;
    $payload['text'] = $text;
    if ($html !== '') $payload['html'] = $html;
    if (!$forSending || $attachments) $payload['attachments'] = $attachments;
    if ($inReplyTo) $payload['inReplyTo'] = $inReplyTo;
    if ($forwardOf) $payload['forwardOf'] = $forwardOf;
    return $payload;
}

function hostingerMailDrafts(?PDO $pdo, string $clientId, string $resourceId): array {
    if ($pdo === null && isMongoStorageEnabled()) {
        $drafts = [];
        foreach (mongoFindMany('client_mail_drafts', [
            'client_id' => $clientId,
            'provider_mailbox_id' => $resourceId,
        ], ['sort' => ['updated_at' => -1]]) as $row) {
            $draft = json_decode((string)($row['draft_json'] ?? ''), true);
            if (!is_array($draft)) continue;
            $draft['id'] = (string)$row['id'];
            $draft['updatedAt'] = (string)$row['updated_at'];
            $drafts[] = $draft;
        }
        return $drafts;
    }
    $stmt = $pdo->prepare(
        'SELECT id, draft_json, updated_at FROM client_mail_drafts
         WHERE client_id = ? AND provider_mailbox_id = ? ORDER BY updated_at DESC'
    );
    $stmt->execute([$clientId, $resourceId]);
    $drafts = [];
    foreach ($stmt->fetchAll() as $row) {
        $draft = json_decode((string)$row['draft_json'], true);
        if (!is_array($draft)) continue;
        $draft['id'] = (string)$row['id'];
        $draft['updatedAt'] = (string)$row['updated_at'];
        $drafts[] = $draft;
    }
    return $drafts;
}

function hostingerMailStarred(PDO $pdo, string $resourceId, int $page, int $perPage): array {
    $folders = hostingerMailListFolders($pdo, $resourceId);
    $folderRows = $folders['data'] ?? [];
    if (!is_array($folderRows)) $folderRows = [];

    $offset = ($page - 1) * $perPage;
    $needed = $offset + $perPage;
    $providerPerPage = 100;
    $providerPageCount = max(1, (int)ceil($needed / $providerPerPage));
    $messages = [];
    $total = 0;

    foreach ($folderRows as $folder) {
        if (!is_array($folder)) continue;
        $path = trim((string)($folder['path'] ?? ''));
        if ($path === '' || ($folder['specialUse'] ?? null) === '\\Drafts') continue;
        for ($providerPage = 1; $providerPage <= $providerPageCount; $providerPage++) {
            $query = hostingerMailQuery(['page' => $providerPage, 'perPage' => $providerPerPage, 'sort' => '-date']);
            $requestPath = hostingerMailFolderPath($resourceId, $path, '/messages/search?' . $query);
            $response = hostingerMailStoredRequest($pdo, 'POST', $requestPath, ['flags' => ['\\Flagged']]);
            $data = hostingerMailResponseCollection($response);
            if ($providerPage === 1) $total += (int)($data['pagination']['total'] ?? 0);
            foreach (($data['data'] ?? []) as $message) {
                if (is_array($message)) $messages[] = $message;
            }
            if (count($data['data'] ?? []) < $providerPerPage) break;
        }
    }

    usort($messages, static function (array $left, array $right): int {
        return strcmp((string)($right['date'] ?? ''), (string)($left['date'] ?? ''));
    });
    $unique = [];
    foreach ($messages as $message) {
        $key = (string)($message['path'] ?? '') . ':' . (string)($message['uid'] ?? '');
        $unique[$key] = $message;
    }
    $messages = array_values($unique);
    return [
        'messages' => array_slice($messages, $offset, $perPage),
        'pagination' => [
            'page' => $page,
            'perPage' => $perPage,
            'total' => $total,
            'totalPages' => (int)ceil($total / max(1, $perPage)),
        ],
    ];
}

function hostingerMailFindFolder(array $folders, string $specialUse, string $namePattern): ?array {
    foreach ($folders as $folder) {
        if (is_array($folder) && strcasecmp((string)($folder['specialUse'] ?? ''), $specialUse) === 0) return $folder;
    }
    foreach ($folders as $folder) {
        if (is_array($folder) && preg_match($namePattern, (string)($folder['name'] ?? ''))) return $folder;
    }
    return null;
}

function hostingerMailFolderRows(?PDO $pdo, string $resourceId): array {
    $folders = hostingerMailListFolders($pdo, $resourceId);
    return is_array($folders['data'] ?? null) ? array_values(array_filter($folders['data'], 'is_array')) : [];
}

function hostingerMailRequireKnownFolder(array $folders, string $path): void {
    $knownPaths = array_map(static fn($item) => (string)($item['path'] ?? ''), $folders);
    if ($path === '' || strlen($path) > 100 || !in_array($path, $knownPaths, true)) {
        jsonResponse(['ok' => false, 'error' => 'That destination folder is not available in this mailbox.'], 422);
    }
}

function hostingerMailNormalizeUids(mixed $value): array {
    if (!is_array($value) || count($value) < 1 || count($value) > 100) {
        jsonResponse(['ok' => false, 'error' => 'Select between 1 and 100 emails.'], 422);
    }
    $uids = [];
    foreach ($value as $uid) {
        $parsed = filter_var($uid, FILTER_VALIDATE_INT);
        if ($parsed === false || $parsed < 1) jsonResponse(['ok' => false, 'error' => 'A selected email is invalid.'], 422);
        $uids[] = (int)$parsed;
    }
    return array_values(array_unique($uids));
}

function hostingerMailNormalizeFlagList(mixed $value): array {
    if ($value === null) return [];
    if (!is_array($value)) jsonResponse(['ok' => false, 'error' => 'Message flags are invalid.'], 422);
    $allowedFlags = ['\\Seen', '\\Flagged', '\\Answered'];
    $flags = array_values(array_unique(array_map('strval', $value)));
    foreach ($flags as $flag) {
        if (!in_array($flag, $allowedFlags, true)) jsonResponse(['ok' => false, 'error' => 'That email action is not supported.'], 422);
    }
    return $flags;
}

function hostingerMailNormalizeSenderAddress(mixed $value): string {
    $address = strtolower(trim(is_string($value) ? $value : ''));
    if ($address === '' || strlen($address) > 254 || filter_var($address, FILTER_VALIDATE_EMAIL) === false) {
        jsonResponse(['ok' => false, 'error' => 'Enter a valid sender email address.'], 422);
    }
    return $address;
}

function hostingerMailBlockedSenders(?PDO $pdo, string $clientId, string $resourceId): array {
    if ($pdo === null && isMongoStorageEnabled()) {
        return array_map(static fn($row) => [
            'address' => (string)$row['address'],
            'blockedAt' => (string)$row['created_at'],
        ], mongoFindMany('client_mail_blocked_senders', [
            'client_id' => $clientId,
            'provider_mailbox_id' => $resourceId,
        ], ['sort' => ['address' => 1]]));
    }
    $stmt = $pdo->prepare(
        'SELECT address, created_at FROM client_mail_blocked_senders
         WHERE client_id = ? AND provider_mailbox_id = ? ORDER BY address'
    );
    $stmt->execute([$clientId, $resourceId]);
    return array_map(static fn($row) => [
        'address' => (string)$row['address'],
        'blockedAt' => (string)$row['created_at'],
    ], $stmt->fetchAll());
}

function hostingerMailRecordActivity(?PDO $pdo, string $clientId, string $resourceId, string $action, int $count = 1): void {
    try {
        if ($pdo === null && isMongoStorageEnabled()) {
            mongoInsert('client_mail_activity', [
                'id' => 'mac_' . bin2hex(random_bytes(10)),
                'client_id' => $clientId,
                'provider_mailbox_id' => $resourceId,
                'action' => $action,
                'item_count' => max(1, $count),
                'created_at' => hostingerMailNow(),
            ]);
            return;
        }
        $pdo->prepare(
            'INSERT INTO client_mail_activity (id, client_id, provider_mailbox_id, action, item_count, created_at)
             VALUES (?, ?, ?, ?, ?, ?)'
        )->execute(['mac_' . bin2hex(random_bytes(10)), $clientId, $resourceId, $action, max(1, $count), hostingerMailNow()]);
    } catch (Throwable $error) {
        error_log('[hostinger-mail] Activity could not be recorded.');
    }
}

function hostingerMailRecordOpened(?PDO $pdo, string $clientId, string $resourceId): void {
    if ($pdo === null && isMongoStorageEnabled()) {
        $last = mongoFindOne('client_mail_activity', [
            'client_id' => $clientId,
            'provider_mailbox_id' => $resourceId,
            'action' => 'opened',
        ]);
        if ($last && strtotime((string)($last['created_at'] ?? '')) > time() - 900) return;
        hostingerMailRecordActivity(null, $clientId, $resourceId, 'opened');
        return;
    }
    $stmt = $pdo->prepare(
        "SELECT created_at FROM client_mail_activity
         WHERE client_id = ? AND provider_mailbox_id = ? AND action = 'opened'
         ORDER BY created_at DESC LIMIT 1"
    );
    $stmt->execute([$clientId, $resourceId]);
    $last = $stmt->fetchColumn();
    if ($last && strtotime((string)$last) > time() - 900) return;
    hostingerMailRecordActivity($pdo, $clientId, $resourceId, 'opened');
}

/** Moves messages from blocked senders out of the inbox page and returns the remaining rows. */
function hostingerMailFilterBlockedInbox(?PDO $pdo, string $clientId, string $resourceId, string $folder, array $messages): array {
    $blocked = array_column(hostingerMailBlockedSenders($pdo, $clientId, $resourceId), 'address');
    if (!$blocked || !$messages) return ['messages' => $messages, 'moved' => 0];
    $folders = hostingerMailFolderRows($pdo, $resourceId);
    $inbox = hostingerMailFindFolder($folders, '\\Inbox', '/^inbox$/i');
    $junk = hostingerMailFindFolder($folders, '\\Junk', '/spam|junk/i');
    if (!$inbox || !$junk || (string)$inbox['path'] !== $folder) return ['messages' => $messages, 'moved' => 0];
    $moveUids = [];
    $kept = [];
    foreach ($messages as $message) {
        $from = strtolower((string)($message['from']['address'] ?? ''));
        if ($from !== '' && in_array($from, $blocked, true) && (int)($message['uid'] ?? 0) > 0) {
            $moveUids[] = (int)$message['uid'];
        } else {
            $kept[] = $message;
        }
    }
    if (!$moveUids) return ['messages' => $messages, 'moved' => 0];
    try {
        hostingerMailStoredRequest($pdo, 'POST', hostingerMailFolderPath($resourceId, $folder, '/messages/move'), [
            'uids' => $moveUids,
            'targetFolder' => (string)$junk['path'],
        ]);
    } catch (HostingerMailApiException $error) {
        return ['messages' => $messages, 'moved' => 0];
    }
    return ['messages' => $kept, 'moved' => count($moveUids)];
}

function hostingerMailboxStats(?PDO $pdo, string $resourceId): array {
    $folders = hostingerMailFolderRows($pdo, $resourceId);
    $summary = ['inbox' => null, 'sent' => null, 'junk' => null, 'trash' => null];
    $uses = ['inbox' => ['\\Inbox', '/^inbox$/i'], 'sent' => ['\\Sent', '/sent/i'], 'junk' => ['\\Junk', '/spam|junk/i'], 'trash' => ['\\Trash', '/trash|deleted/i']];
    foreach ($uses as $key => [$use, $pattern]) {
        $folder = hostingerMailFindFolder($folders, $use, $pattern);
        if ($folder) $summary[$key] = ['messageCount' => (int)($folder['messageCount'] ?? 0), 'unreadCount' => (int)($folder['unreadCount'] ?? 0)];
    }
    $totalMessages = array_sum(array_map(static fn($folder) => (int)($folder['messageCount'] ?? 0), $folders));
    $quota = null;
    try {
        $quotaResponse = hostingerMailStoredRequest($pdo, 'GET', '/api/v1/mailboxes/' . hostingerMailSegment($resourceId) . '/quota');
        $quotaData = hostingerMailResponseData($quotaResponse);
        $quota = [
            'supported' => (bool)($quotaData['supported'] ?? false),
            'totalUsage' => (int)($quotaData['totalUsage'] ?? 0),
            'totalLimit' => (int)($quotaData['totalLimit'] ?? 0),
            'totalPercentage' => (int)($quotaData['totalPercentage'] ?? 0),
        ];
    } catch (HostingerMailApiException $error) {
        $quota = null;
    }
    return ['folders' => $summary, 'folderCount' => count($folders), 'totalMessages' => $totalMessages, 'quota' => $quota];
}

function hostingerMailHandleRequest(PDO $pdo, string $apiPath, string $method, array $input, ?array $adminSession, ?array $portalSession): bool {
    $adminBase = '/admin/integrations/hostinger-mail';
    $isAdminMailRoute = $apiPath === $adminBase
        || $apiPath === $adminBase . '/test'
        || $apiPath === '/admin/hostinger/mailboxes'
        || $apiPath === '/admin/hostinger/overview'
        || preg_match('#^/admin/hostinger/mailboxes/([^/]+)/stats$#', $apiPath) === 1
        || preg_match('#^/admin/clients/([^/]+)/mailboxes(?:/([^/]+))?$#', $apiPath) === 1
        || preg_match('#^/admin/staff/([^/]+)/mailboxes(?:/([^/]+))?$#', $apiPath) === 1
        || preg_match('#^/admin/staff-mailboxes/([^/]+)/reassign$#', $apiPath) === 1
        || preg_match('#^/admin/client-mailboxes/([^/]+)/reassign$#', $apiPath) === 1;

    if ($isAdminMailRoute) {
        requireSuperAdmin($pdo, $adminSession);
        header('Cache-Control: no-store, private');
        header('Pragma: no-cache');
        $staff = requireActiveAdminStaff($pdo, $adminSession);

        if ($apiPath === $adminBase && $method === 'GET') {
            $integration = hostingerMailIntegration($pdo);
            jsonResponse([
                'ok' => true,
                'integration' => [
                    'configured' => !empty($integration['encrypted_token']),
                    'status' => $integration['status'] ?? 'not_configured',
                    'lastTestedAt' => $integration['last_tested_at'] ?? null,
                    'lastSuccessAt' => $integration['last_success_at'] ?? null,
                    'mailboxCount' => (int)($integration['mailbox_count'] ?? 0),
                ],
            ]);
        }

        if ($apiPath === $adminBase . '/test' && $method === 'POST') {
            $candidate = trim((string)($input['token'] ?? ''));
            $integration = hostingerMailIntegration($pdo);
            $testingStored = $candidate === '';
            if ($testingStored) {
                if (!$integration || empty($integration['encrypted_token'])) {
                    jsonResponse(['ok' => false, 'error' => 'Enter a Hostinger Mail API token first.'], 409);
                }
                $candidate = decryptClientSecret((string)$integration['encrypted_token']);
            }
            if (strlen($candidate) < 16 || strlen($candidate) > 4096 || preg_match('/\s/', $candidate)) {
                jsonResponse(['ok' => false, 'error' => 'Enter a valid Hostinger Mail API token.'], 422);
            }
            try {
                $account = hostingerMailAccountWithToken($candidate);
                if ($testingStored) hostingerMailRecordStatus($pdo, 'connected', null, true, $account);
                hostingerMailRecordAudit($pdo, (string)$staff['id'], 'HOSTINGER_MAIL_CONNECTION_TESTED', 'Hostinger Mail API connection tested.');
                jsonResponse([
                    'ok' => true,
                    'message' => 'Hostinger Mail API connection successful.',
                    'mailboxCount' => count($account['mailboxes']),
                    'testedStoredToken' => $testingStored,
                ]);
            } catch (HostingerMailApiException $error) {
                if ($testingStored) hostingerMailRecordStatus($pdo, 'connection_error', $error->providerCode ?: 'connection_error', true);
                $safe = hostingerMailSafeProviderError($error, true);
                jsonResponse(['ok' => false, 'error' => $safe[0]], $safe[1]);
            }
        }

        if ($apiPath === $adminBase && $method === 'POST') {
            $token = trim((string)($input['token'] ?? ''));
            if (strlen($token) < 16 || strlen($token) > 4096 || preg_match('/\s/', $token)) {
                jsonResponse(['ok' => false, 'error' => 'Enter a valid Hostinger Mail API token.'], 422);
            }
            try {
                $account = hostingerMailAccountWithToken($token);
                $encrypted = encryptClientSecret($token);
                $existing = hostingerMailIntegration($pdo);
                $now = hostingerMailNow();
                if ($existing) {
                    $pdo->prepare(
                        "UPDATE hostinger_mail_integrations
                         SET encrypted_token = ?, status = 'connected', last_tested_at = ?, last_success_at = ?,
                             last_error_code = NULL, mailbox_count = ?, order_resource_id = ?, updated_by = ?, updated_at = ?
                         WHERE id = 'primary'"
                    )->execute([
                        $encrypted, $now, $now, count($account['mailboxes']),
                        (string)($account['orderResourceId'] ?? ''), (string)$staff['id'], $now,
                    ]);
                    $auditAction = 'HOSTINGER_MAIL_TOKEN_UPDATED';
                    $auditMessage = 'Super Admin updated the Hostinger Mail API credential.';
                } else {
                    $pdo->prepare(
                        "INSERT INTO hostinger_mail_integrations
                         (id, encrypted_token, status, last_tested_at, last_success_at, last_error_code, mailbox_count, order_resource_id, created_by, updated_by, created_at, updated_at)
                         VALUES ('primary', ?, 'connected', ?, ?, NULL, ?, ?, ?, ?, ?, ?)"
                    )->execute([
                        $encrypted, $now, $now, count($account['mailboxes']),
                        (string)($account['orderResourceId'] ?? ''), (string)$staff['id'],
                        (string)$staff['id'], $now, $now,
                    ]);
                    $auditAction = 'HOSTINGER_MAIL_TOKEN_CONFIGURED';
                    $auditMessage = 'Super Admin configured the Hostinger Mail API credential.';
                }
                hostingerMailRecordAudit($pdo, (string)$staff['id'], $auditAction, $auditMessage);
                jsonResponse([
                    'ok' => true,
                    'message' => 'Hostinger Mail API token saved and validated.',
                    'integration' => [
                        'configured' => true,
                        'status' => 'connected',
                        'lastTestedAt' => $now,
                        'lastSuccessAt' => $now,
                        'mailboxCount' => count($account['mailboxes']),
                    ],
                ]);
            } catch (HostingerMailApiException $error) {
                $safe = hostingerMailSafeProviderError($error, true);
                jsonResponse(['ok' => false, 'error' => $safe[0]], $safe[1]);
            }
        }

        if ($apiPath === $adminBase && $method === 'DELETE') {
            $integration = hostingerMailIntegration($pdo);
            if ($integration) {
                $pdo->prepare("DELETE FROM hostinger_mail_integrations WHERE id = 'primary'")->execute();
                hostingerMailRecordAudit($pdo, (string)$staff['id'], 'HOSTINGER_MAIL_TOKEN_REMOVED', 'Super Admin removed the Hostinger Mail API credential.');
            }
            jsonResponse(['ok' => true, 'message' => 'Hostinger Mail API token removed.']);
        }

        if ($apiPath === '/admin/hostinger/overview' && $method === 'GET') {
            $integration = hostingerMailIntegration($pdo);
            $configured = !empty($integration['encrypted_token']);
            $providerMailboxes = [];
            $providerError = null;
            if ($configured) {
                try {
                    foreach (hostingerMailAccount($pdo)['mailboxes'] as $mailbox) {
                        if (!is_array($mailbox) || empty($mailbox['resourceId']) || empty($mailbox['address'])) continue;
                        $providerMailboxes[(string)$mailbox['resourceId']] = (string)$mailbox['address'];
                    }
                } catch (HostingerMailApiException $error) {
                    $providerError = hostingerMailSafeProviderError($error, true)[0];
                }
            }
            $assignmentStmt = $pdo->prepare(
                "SELECT m.id, m.client_id, m.provider_mailbox_id, m.email_address, m.display_name, m.status, m.created_at,
                        c.name AS client_name, c.company AS client_company, c.email AS client_email,
                        a.portal_enabled, a.status AS portal_status
                 FROM client_mailboxes m
                 LEFT JOIN clients c ON c.id = m.client_id
                 LEFT JOIN client_portal_access a ON a.client_id = m.client_id
                 WHERE m.provider = 'hostinger'"
            );
            $assignmentStmt->execute();
            $assignments = [];
            foreach ($assignmentStmt->fetchAll() as $row) $assignments[(string)$row['provider_mailbox_id']] = $row;

            $activityStmt = $pdo->prepare(
                "SELECT provider_mailbox_id, action, MAX(created_at) AS last_at,
                        SUM(CASE WHEN created_at >= ? THEN item_count ELSE 0 END) AS recent_count
                 FROM client_mail_activity GROUP BY provider_mailbox_id, action"
            );
            $activityStmt->execute([date('c', time() - 86400 * 30)]);
            $activity = [];
            foreach ($activityStmt->fetchAll() as $row) {
                $activity[(string)$row['provider_mailbox_id']][(string)$row['action']] = [
                    'lastAt' => (string)$row['last_at'],
                    'recentCount' => (int)$row['recent_count'],
                ];
            }

            $resourceIds = array_values(array_unique(array_merge(array_keys($providerMailboxes), array_keys($assignments))));
            $rows = [];
            foreach ($resourceIds as $resourceId) {
                $assignment = $assignments[$resourceId] ?? null;
                $mailboxActivity = $activity[$resourceId] ?? [];
                $rows[] = [
                    'resourceId' => $resourceId,
                    'address' => $providerMailboxes[$resourceId] ?? (string)($assignment['email_address'] ?? ''),
                    'inHostinger' => $configured && $providerError === null ? isset($providerMailboxes[$resourceId]) : null,
                    'assignment' => $assignment ? [
                        'id' => (string)$assignment['id'],
                        'clientId' => (string)$assignment['client_id'],
                        'clientName' => (string)($assignment['client_name'] ?? ''),
                        'clientCompany' => (string)($assignment['client_company'] ?? ''),
                        'clientEmail' => (string)($assignment['client_email'] ?? ''),
                        'displayName' => (string)$assignment['display_name'],
                        'enabled' => $assignment['status'] === 'enabled',
                        'portalActive' => !empty($assignment['portal_enabled']) && ($assignment['portal_status'] ?? '') === 'Active',
                        'assignedAt' => (string)$assignment['created_at'],
                    ] : null,
                    'activity' => [
                        'lastOpenedAt' => $mailboxActivity['opened']['lastAt'] ?? null,
                        'lastSentAt' => $mailboxActivity['sent']['lastAt'] ?? null,
                        'sentLast30Days' => $mailboxActivity['sent']['recentCount'] ?? 0,
                    ],
                ];
            }
            usort($rows, static fn($left, $right) => strcasecmp($left['address'], $right['address']));

            $clientStmt = $pdo->prepare(
                "SELECT c.id, c.name, c.company, c.email, a.portal_enabled, a.status AS portal_status
                 FROM clients c LEFT JOIN client_portal_access a ON a.client_id = c.id
                 WHERE c.deleted_at IS NULL OR c.deleted_at = ''
                 ORDER BY COALESCE(NULLIF(c.company, ''), c.name) LIMIT 1000"
            );
            $clientStmt->execute();
            $clients = array_map(static fn($row) => [
                'id' => (string)$row['id'],
                'name' => (string)($row['name'] ?? ''),
                'company' => (string)($row['company'] ?? ''),
                'email' => (string)($row['email'] ?? ''),
                'portalActive' => !empty($row['portal_enabled']) && ($row['portal_status'] ?? '') === 'Active',
            ], $clientStmt->fetchAll());

            jsonResponse([
                'ok' => true,
                'integration' => [
                    'configured' => $configured,
                    'status' => $integration['status'] ?? 'not_configured',
                    'lastTestedAt' => $integration['last_tested_at'] ?? null,
                    'lastSuccessAt' => $integration['last_success_at'] ?? null,
                ],
                'providerError' => $providerError,
                'mailboxes' => $rows,
                'clients' => $clients,
            ]);
        }

        if (preg_match('#^/admin/hostinger/mailboxes/([^/]+)/stats$#', $apiPath, $matches) && $method === 'GET') {
            $resourceId = rawurldecode($matches[1]);
            if (!preg_match('/^AC[A-Za-z0-9]+$/', $resourceId)) jsonResponse(['ok' => false, 'error' => 'Mailbox was not found.'], 404);
            jsonResponse(['ok' => true, 'stats' => hostingerMailboxStats($pdo, $resourceId)]);
        }

        if ($apiPath === '/admin/hostinger/mailboxes' && $method === 'GET') {
            $account = hostingerMailAccount($pdo);
            jsonResponse([
                'ok' => true,
                'orderResourceId' => (string)($account['orderResourceId'] ?? ''),
                'mailboxes' => hostingerMailNormalizeProviderMailboxes($account, $pdo),
            ]);
        }

        if (preg_match('#^/admin/clients/([^/]+)/mailboxes(?:/([^/]+))?$#', $apiPath, $matches)) {
            $clientId = rawurldecode($matches[1]);
            if (!preg_match('/^[A-Za-z0-9_-]{1,191}$/', $clientId)) {
                jsonResponse(['ok' => false, 'error' => 'Client account was not found.'], 404);
            }
            $clientStmt = $pdo->prepare('SELECT id, name, company FROM clients WHERE id = ? LIMIT 1');
            $clientStmt->execute([$clientId]);
            $client = $clientStmt->fetch();
            if (!$client) jsonResponse(['ok' => false, 'error' => 'Email account assignments require a client portal account.'], 404);

            $assignmentId = isset($matches[2]) ? rawurldecode($matches[2]) : null;
            if (!$assignmentId && $method === 'GET') {
                $stmt = $pdo->prepare(
                    'SELECT id, client_id, provider_mailbox_id, email_address, display_name, status, created_at, updated_at
                     FROM client_mailboxes WHERE client_id = ? AND provider = ? ORDER BY email_address'
                );
                $stmt->execute([$clientId, 'hostinger']);
                $mailboxes = [];
                foreach ($stmt->fetchAll() as $row) {
                    $mailboxes[] = [
                        'id' => (string)$row['id'],
                        'clientId' => (string)$row['client_id'],
                        'providerMailboxId' => (string)$row['provider_mailbox_id'],
                        'emailAddress' => (string)$row['email_address'],
                        'displayName' => (string)$row['display_name'],
                        'enabled' => $row['status'] === 'enabled',
                        'createdAt' => (string)$row['created_at'],
                        'updatedAt' => (string)$row['updated_at'],
                    ];
                }
                jsonResponse(['ok' => true, 'mailboxes' => $mailboxes]);
            }

            if (!$assignmentId && $method === 'POST') {
                $resourceId = trim((string)($input['providerMailboxId'] ?? ''));
                $displayName = trim((string)($input['displayName'] ?? ''));
                $enabled = array_key_exists('enabled', $input) ? (bool)$input['enabled'] : true;
                if (!preg_match('/^AC[A-Za-z0-9]+$/', $resourceId)) {
                    jsonResponse(['ok' => false, 'error' => 'Select a mailbox returned by Hostinger.'], 422);
                }
                if (strlen($displayName) > 191) jsonResponse(['ok' => false, 'error' => 'The display name is too long.'], 422);
                $account = hostingerMailAccount($pdo);
                $providerMailbox = null;
                foreach ($account['mailboxes'] as $candidate) {
                    if (($candidate['resourceId'] ?? null) === $resourceId) {
                        $providerMailbox = $candidate;
                        break;
                    }
                }
                if (!$providerMailbox || !filter_var((string)($providerMailbox['address'] ?? ''), FILTER_VALIDATE_EMAIL)) {
                    jsonResponse(['ok' => false, 'error' => 'That mailbox was not found in the connected Hostinger account.'], 422);
                }
                $existingStmt = $pdo->prepare('SELECT client_id FROM client_mailboxes WHERE provider_mailbox_id = ? LIMIT 1');
                $existingStmt->execute([$resourceId]);
                $existing = $existingStmt->fetch();
                if ($existing) {
                    jsonResponse(['ok' => false, 'error' => 'This mailbox is already assigned to another client. Use the explicit reassignment action to transfer it.'], 409);
                }
                $now = hostingerMailNow();
                $assignmentId = 'hmb_' . bin2hex(random_bytes(12));
                $pdo->prepare(
                    'INSERT INTO client_mailboxes
                     (id, client_id, provider, provider_mailbox_id, email_address, display_name, status, created_by, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                )->execute([
                    $assignmentId, $clientId, 'hostinger', $resourceId, (string)$providerMailbox['address'],
                    $displayName !== '' ? $displayName : (string)$providerMailbox['address'],
                    $enabled ? 'enabled' : 'disabled', (string)$staff['id'], $now, $now,
                ]);
                hostingerMailRecordAudit(
                    $pdo,
                    (string)$staff['id'],
                    'HOSTINGER_MAILBOX_ASSIGNED',
                    'Hostinger mailbox ' . (string)$providerMailbox['address'] . ' assigned to client ' . $clientId . '.',
                    (string)($client['company'] ?: $client['name'])
                );
                jsonResponse([
                    'ok' => true,
                    'mailbox' => [
                        'id' => $assignmentId,
                        'clientId' => $clientId,
                        'providerMailboxId' => $resourceId,
                        'emailAddress' => (string)$providerMailbox['address'],
                        'displayName' => $displayName !== '' ? $displayName : (string)$providerMailbox['address'],
                        'enabled' => $enabled,
                        'createdAt' => $now,
                        'updatedAt' => $now,
                    ],
                ], 201);
            }

            if ($assignmentId && preg_match('/^[A-Za-z0-9_-]{1,191}$/', $assignmentId)) {
                $assignmentStmt = $pdo->prepare(
                    'SELECT id, client_id, provider_mailbox_id, email_address, display_name, status
                     FROM client_mailboxes WHERE id = ? AND client_id = ? AND provider = ? LIMIT 1'
                );
                $assignmentStmt->execute([$assignmentId, $clientId, 'hostinger']);
                $assignment = $assignmentStmt->fetch();
                if (!$assignment) jsonResponse(['ok' => false, 'error' => 'Mailbox assignment was not found.'], 404);

                if ($method === 'PATCH') {
                    $displayName = $assignment['display_name'];
                    $status = $assignment['status'];
                    if (array_key_exists('displayName', $input)) {
                        if (!is_string($input['displayName']) || strlen(trim($input['displayName'])) > 191) {
                            jsonResponse(['ok' => false, 'error' => 'The display name is invalid.'], 422);
                        }
                        $displayName = trim($input['displayName']);
                    }
                    if (array_key_exists('enabled', $input)) {
                        if (!is_bool($input['enabled'])) jsonResponse(['ok' => false, 'error' => 'Choose whether the mailbox is enabled.'], 422);
                        $status = $input['enabled'] ? 'enabled' : 'disabled';
                    }
                    if (!array_key_exists('displayName', $input) && !array_key_exists('enabled', $input)) {
                        jsonResponse(['ok' => false, 'error' => 'There are no mailbox changes to save.'], 422);
                    }
                    $now = hostingerMailNow();
                    $pdo->prepare('UPDATE client_mailboxes SET display_name = ?, status = ?, updated_at = ? WHERE id = ?')
                        ->execute([$displayName, $status, $now, $assignmentId]);
                    $action = $status !== $assignment['status'] ? 'HOSTINGER_MAILBOX_STATUS_CHANGED' : 'HOSTINGER_MAILBOX_UPDATED';
                    $details = 'Mailbox ' . $assignment['email_address'] . ' updated for client ' . $clientId . '.';
                    hostingerMailRecordAudit($pdo, (string)$staff['id'], $action, $details, (string)($client['company'] ?: $client['name']));
                    jsonResponse(['ok' => true, 'mailbox' => [
                        'id' => $assignmentId,
                        'clientId' => $clientId,
                        'providerMailboxId' => (string)$assignment['provider_mailbox_id'],
                        'emailAddress' => (string)$assignment['email_address'],
                        'displayName' => $displayName,
                        'enabled' => $status === 'enabled',
                        'updatedAt' => $now,
                    ]]);
                }

                if ($method === 'DELETE') {
                    $pdo->beginTransaction();
                    $pdo->prepare('DELETE FROM client_mail_drafts WHERE client_id = ? AND provider_mailbox_id = ?')
                        ->execute([$clientId, $assignment['provider_mailbox_id']]);
                    $pdo->prepare('DELETE FROM client_mail_blocked_senders WHERE client_id = ? AND provider_mailbox_id = ?')
                        ->execute([$clientId, $assignment['provider_mailbox_id']]);
                    $pdo->prepare('DELETE FROM client_mailboxes WHERE id = ?')->execute([$assignmentId]);
                    $pdo->commit();
                    hostingerMailRecordAudit(
                        $pdo,
                        (string)$staff['id'],
                        'HOSTINGER_MAILBOX_UNASSIGNED',
                        'Mailbox ' . $assignment['email_address'] . ' removed from client ' . $clientId . '; the Hostinger mailbox was not deleted.',
                        (string)($client['company'] ?: $client['name'])
                    );
                    jsonResponse(['ok' => true, 'message' => 'Mailbox removed from this client. The Hostinger mailbox was not deleted.']);
                }
            }

            jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
        }

        if (preg_match('#^/admin/staff/([^/]+)/mailboxes(?:/([^/]+))?$#', $apiPath, $matches)) {
            $staffId = rawurldecode($matches[1]);
            if (!preg_match('/^[A-Za-z0-9_-]{1,191}$/', $staffId)) {
                jsonResponse(['ok' => false, 'error' => 'Staff account was not found.'], 404);
            }
            $targetStmt = $pdo->prepare('SELECT id, name, role, office_id, team_id, status FROM staff_users WHERE id = ? AND deleted_at IS NULL LIMIT 1');
            $targetStmt->execute([$staffId]);
            $targetStaff = $targetStmt->fetch();
            if (!$targetStaff || $targetStaff['status'] !== 'Active') {
                jsonResponse(['ok' => false, 'error' => 'Staff account was not found or is unavailable.'], 404);
            }

            $actor = requireActiveAdminStaff($pdo, $adminSession);
            $hasScope = false;
            if ($actor['role'] === 'Super Admin') $hasScope = true;
            elseif ($actor['role'] === 'Office Manager' && $targetStaff['office_id'] === $actor['office_id']) $hasScope = true;
            elseif ($actor['role'] === 'Team Leader' && $targetStaff['team_id'] === $actor['team_id']) $hasScope = true;
            elseif ($actor['id'] === $targetStaff['id']) $hasScope = true;
            if (!$hasScope) jsonResponse(['ok' => false, 'error' => 'You do not have access to this staff mailbox.'], 403);

            $assignmentId = isset($matches[2]) ? rawurldecode($matches[2]) : null;
            if (!$assignmentId && $method === 'GET') {
                $stmt = $pdo->prepare(
                    'SELECT id, staff_id, provider_mailbox_id, email_address, display_name, status, created_at, updated_at
                     FROM staff_mailboxes WHERE staff_id = ? AND provider = ? ORDER BY email_address'
                );
                $stmt->execute([$staffId, 'hostinger']);
                $mailboxes = [];
                foreach ($stmt->fetchAll() as $row) {
                    $mailboxes[] = [
                        'id' => (string)$row['id'],
                        'staffId' => (string)$row['staff_id'],
                        'providerMailboxId' => (string)$row['provider_mailbox_id'],
                        'emailAddress' => (string)$row['email_address'],
                        'displayName' => (string)$row['display_name'],
                        'enabled' => $row['status'] === 'enabled',
                        'createdAt' => (string)$row['created_at'],
                        'updatedAt' => (string)$row['updated_at'],
                    ];
                }
                jsonResponse(['ok' => true, 'mailboxes' => $mailboxes]);
            }

            if (!$assignmentId && $method === 'POST') {
                $resourceId = trim((string)($input['providerMailboxId'] ?? ''));
                $displayName = trim((string)($input['displayName'] ?? ''));
                $enabled = array_key_exists('enabled', $input) ? (bool)$input['enabled'] : true;
                if (!preg_match('/^AC[A-Za-z0-9]+$/', $resourceId)) {
                    jsonResponse(['ok' => false, 'error' => 'Select a mailbox returned by Hostinger.'], 422);
                }
                if (strlen($displayName) > 191) jsonResponse(['ok' => false, 'error' => 'The display name is too long.'], 422);
                $account = hostingerMailAccount($pdo);
                $providerMailbox = null;
                foreach ($account['mailboxes'] as $candidate) {
                    if (($candidate['resourceId'] ?? null) === $resourceId) { $providerMailbox = $candidate; break; }
                }
                if (!$providerMailbox || !filter_var((string)($providerMailbox['address'] ?? ''), FILTER_VALIDATE_EMAIL)) {
                    jsonResponse(['ok' => false, 'error' => 'That mailbox was not found in the connected Hostinger account.'], 422);
                }
                $existingStmt = $pdo->prepare('SELECT staff_id FROM staff_mailboxes WHERE provider_mailbox_id = ? LIMIT 1');
                $existingStmt->execute([$resourceId]);
                if ($existingStmt->fetch()) {
                    jsonResponse(['ok' => false, 'error' => 'This mailbox is already assigned to another staff account. Use reassignment to transfer it.'], 409);
                }
                $now = hostingerMailNow();
                $assignmentId = 'hmb_staff_' . bin2hex(random_bytes(12));
                $pdo->prepare(
                    'INSERT INTO staff_mailboxes (id, staff_id, provider, provider_mailbox_id, email_address, display_name, status, created_by, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                )->execute([
                    $assignmentId, $staffId, 'hostinger', $resourceId, (string)$providerMailbox['address'],
                    $displayName !== '' ? $displayName : (string)$providerMailbox['address'],
                    $enabled ? 'enabled' : 'disabled', (string)$actor['id'], $now, $now,
                ]);
                hostingerMailRecordAudit($pdo, (string)$actor['id'], 'HOSTINGER_STAFF_MAILBOX_ASSIGNED', 'Hostinger mailbox ' . (string)$providerMailbox['address'] . ' assigned to staff ' . $staffId . '.');
                jsonResponse(['ok' => true, 'mailbox' => ['id' => $assignmentId, 'staffId' => $staffId, 'providerMailboxId' => $resourceId, 'emailAddress' => (string)$providerMailbox['address'], 'displayName' => $displayName !== '' ? $displayName : (string)$providerMailbox['address'], 'enabled' => $enabled, 'createdAt' => $now, 'updatedAt' => $now]], 201);
            }

            if ($assignmentId && preg_match('/^[A-Za-z0-9_-]{1,191}$/', $assignmentId)) {
                $assignmentStmt = $pdo->prepare(
                    'SELECT id, staff_id, provider_mailbox_id, email_address, display_name, status FROM staff_mailboxes WHERE id = ? AND staff_id = ? AND provider = ? LIMIT 1'
                );
                $assignmentStmt->execute([$assignmentId, $staffId, 'hostinger']);
                $assignment = $assignmentStmt->fetch();
                if (!$assignment) jsonResponse(['ok' => false, 'error' => 'Mailbox assignment was not found.'], 404);

                if ($method === 'PATCH') {
                    $displayName = $assignment['display_name'];
                    $status = $assignment['status'];
                    if (array_key_exists('displayName', $input)) {
                        if (!is_string($input['displayName']) || strlen(trim($input['displayName'])) > 191) jsonResponse(['ok' => false, 'error' => 'The display name is invalid.'], 422);
                        $displayName = trim($input['displayName']);
                    }
                    if (array_key_exists('enabled', $input)) {
                        if (!is_bool($input['enabled'])) jsonResponse(['ok' => false, 'error' => 'Choose whether the mailbox is enabled.'], 422);
                        $status = $input['enabled'] ? 'enabled' : 'disabled';
                    }
                    if (!array_key_exists('displayName', $input) && !array_key_exists('enabled', $input)) jsonResponse(['ok' => false, 'error' => 'There are no mailbox changes to save.'], 422);
                    $now = hostingerMailNow();
                    $pdo->prepare('UPDATE staff_mailboxes SET display_name = ?, status = ?, updated_at = ? WHERE id = ?')->execute([$displayName, $status, $now, $assignmentId]);
                    hostingerMailRecordAudit($pdo, (string)$actor['id'], 'HOSTINGER_STAFF_MAILBOX_UPDATED', 'Mailbox ' . $assignment['email_address'] . ' updated for staff ' . $staffId . '.');
                    jsonResponse(['ok' => true, 'mailbox' => ['id' => $assignmentId, 'staffId' => $staffId, 'providerMailboxId' => (string)$assignment['provider_mailbox_id'], 'emailAddress' => (string)$assignment['email_address'], 'displayName' => $displayName, 'enabled' => $status === 'enabled', 'updatedAt' => $now]]);
                }

                if ($method === 'DELETE') {
                    $pdo->beginTransaction();
                    $pdo->prepare('DELETE FROM staff_mailboxes WHERE id = ?')->execute([$assignmentId]);
                    $pdo->commit();
                    hostingerMailRecordAudit($pdo, (string)$actor['id'], 'HOSTINGER_STAFF_MAILBOX_UNASSIGNED', 'Mailbox ' . $assignment['email_address'] . ' removed from staff ' . $staffId . '; the Hostinger mailbox was not deleted.');
                    jsonResponse(['ok' => true, 'message' => 'Mailbox removed from this staff account. The Hostinger mailbox was not deleted.']);
                }
            }

            jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
        }

        if (preg_match('#^/admin/staff-mailboxes/([^/]+)/reassign$#', $apiPath, $matches) && $method === 'POST') {
            $assignmentId = rawurldecode($matches[1]);
            $targetStaffId = trim((string)($input['targetStaffId'] ?? ''));
            $displayName = trim((string)($input['displayName'] ?? ''));
            if (($input['confirmed'] ?? false) !== true) jsonResponse(['ok' => false, 'error' => 'Confirm the mailbox transfer before continuing.'], 422);
            if (!preg_match('/^[A-Za-z0-9_-]{1,191}$/', $assignmentId) || !preg_match('/^[A-Za-z0-9_-]{1,191}$/', $targetStaffId) || strlen($displayName) > 191) jsonResponse(['ok' => false, 'error' => 'The mailbox transfer details are invalid.'], 422);
            $actor = requireActiveAdminStaff($pdo, $adminSession);
            $targetStmt = $pdo->prepare('SELECT id, name, role, office_id, team_id, status FROM staff_users WHERE id = ? AND deleted_at IS NULL LIMIT 1');
            $targetStmt->execute([$targetStaffId]);
            $targetStaff = $targetStmt->fetch();
            if (!$targetStaff || $targetStaff['status'] !== 'Active') jsonResponse(['ok' => false, 'error' => 'The destination staff account was not found.'], 404);
            $hasScope = false;
            if ($actor['role'] === 'Super Admin') $hasScope = true;
            elseif ($actor['role'] === 'Office Manager' && $targetStaff['office_id'] === $actor['office_id']) $hasScope = true;
            elseif ($actor['role'] === 'Team Leader' && $targetStaff['team_id'] === $actor['team_id']) $hasScope = true;
            elseif ($actor['id'] === $targetStaffId) $hasScope = true;
            if (!$hasScope) jsonResponse(['ok' => false, 'error' => 'You cannot transfer a mailbox into this staff account.'], 403);
            $pdo->beginTransaction();
            $assignmentStmt = $pdo->prepare('SELECT * FROM staff_mailboxes WHERE id = ? LIMIT 1');
            $assignmentStmt->execute([$assignmentId]);
            $assignment = $assignmentStmt->fetch();
            if (!$assignment) { $pdo->rollBack(); jsonResponse(['ok' => false, 'error' => 'Mailbox assignment was not found.'], 404); }
            if ($assignment['staff_id'] === $targetStaffId) { $pdo->rollBack(); jsonResponse(['ok' => false, 'error' => 'This mailbox is already assigned to the selected staff member.'], 409); }
            $sourceStmt = $pdo->prepare('SELECT name FROM staff_users WHERE id = ? LIMIT 1');
            $sourceStmt->execute([$assignment['staff_id']]);
            $sourceStaff = $sourceStmt->fetch() ?: [];
            $now = hostingerMailNow();
            $newDisplayName = $displayName !== '' ? $displayName : (string)$assignment['email_address'];
            $pdo->prepare('UPDATE staff_mailboxes SET staff_id = ?, display_name = ?, updated_at = ? WHERE id = ?')->execute([$targetStaffId, $newDisplayName, $now, $assignmentId]);
            $pdo->commit();
            hostingerMailRecordAudit($pdo, (string)$actor['id'], 'HOSTINGER_STAFF_MAILBOX_REASSIGNED', 'Mailbox ' . $assignment['email_address'] . ' transferred from staff ' . $assignment['staff_id'] . ' to staff ' . $targetStaffId . '.');
            jsonResponse(['ok' => true, 'message' => 'Mailbox reassigned to the selected staff member.']);
        }

        if (preg_match('#^/admin/client-mailboxes/([^/]+)/reassign$#', $apiPath, $matches) && $method === 'POST') {
            $assignmentId = rawurldecode($matches[1]);
            $targetClientId = trim((string)($input['targetClientId'] ?? ''));
            $displayName = trim((string)($input['displayName'] ?? ''));
            if (($input['confirmed'] ?? false) !== true) {
                jsonResponse(['ok' => false, 'error' => 'Confirm the mailbox transfer before continuing.'], 422);
            }
            if (!preg_match('/^[A-Za-z0-9_-]{1,191}$/', $assignmentId)
                || !preg_match('/^[A-Za-z0-9_-]{1,191}$/', $targetClientId)
                || strlen($displayName) > 191) {
                jsonResponse(['ok' => false, 'error' => 'The mailbox transfer details are invalid.'], 422);
            }
            $targetStmt = $pdo->prepare('SELECT id, name, company FROM clients WHERE id = ? LIMIT 1');
            $targetStmt->execute([$targetClientId]);
            $targetClient = $targetStmt->fetch();
            if (!$targetClient) jsonResponse(['ok' => false, 'error' => 'The destination client account was not found.'], 404);
            $pdo->beginTransaction();
            $assignmentStmt = $pdo->prepare('SELECT * FROM client_mailboxes WHERE id = ? LIMIT 1');
            $assignmentStmt->execute([$assignmentId]);
            $assignment = $assignmentStmt->fetch();
            if (!$assignment) {
                $pdo->rollBack();
                jsonResponse(['ok' => false, 'error' => 'Mailbox assignment was not found.'], 404);
            }
            if ($assignment['client_id'] === $targetClientId) {
                $pdo->rollBack();
                jsonResponse(['ok' => false, 'error' => 'This mailbox is already assigned to the selected client.'], 409);
            }
            $sourceStmt = $pdo->prepare('SELECT name, company FROM clients WHERE id = ? LIMIT 1');
            $sourceStmt->execute([$assignment['client_id']]);
            $sourceClient = $sourceStmt->fetch() ?: [];
            $now = hostingerMailNow();
            $newDisplayName = $displayName !== '' ? $displayName : (string)$assignment['email_address'];
            $pdo->prepare('DELETE FROM client_mail_drafts WHERE client_id = ? AND provider_mailbox_id = ?')
                ->execute([$assignment['client_id'], $assignment['provider_mailbox_id']]);
            $pdo->prepare('DELETE FROM client_mail_blocked_senders WHERE client_id = ? AND provider_mailbox_id = ?')
                ->execute([$assignment['client_id'], $assignment['provider_mailbox_id']]);
            $pdo->prepare('UPDATE client_mailboxes SET client_id = ?, display_name = ?, updated_at = ? WHERE id = ?')
                ->execute([$targetClientId, $newDisplayName, $now, $assignmentId]);
            $pdo->commit();
            hostingerMailRecordAudit(
                $pdo,
                (string)$staff['id'],
                'HOSTINGER_MAILBOX_REASSIGNED',
                'Mailbox ' . $assignment['email_address'] . ' transferred from client ' . $assignment['client_id'] . ' to client ' . $targetClientId . '.',
                (string)($targetClient['company'] ?: $targetClient['name'])
            );
            jsonResponse(['ok' => true, 'message' => 'Mailbox reassigned to the selected client.']);
        }

        jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }

        if ($apiPath === '/portal/mailboxes' && $method === 'GET') {
        header('Cache-Control: no-store, private');
        header('Pragma: no-cache');
        $integration = hostingerMailIntegration($pdo);
        if (!$integration || empty($integration['encrypted_token'])) {
            jsonResponse(['ok' => false, 'error' => 'Email service is not configured yet. Please contact your administrator.'], 409);
        }
        $stmt = $pdo->prepare(
            "SELECT id, client_id, provider_mailbox_id, email_address, display_name, created_at, updated_at
             FROM client_mailboxes WHERE client_id = ? AND provider = 'hostinger' AND status = 'enabled'
             ORDER BY email_address"
        );
        $stmt->execute([(string)$portalSession['id']]);
        $mailboxes = [];
        foreach ($stmt->fetchAll() as $row) {
            $mailboxes[] = [
                'id' => (string)$row['id'],
                'clientId' => (string)$row['client_id'],
                'providerMailboxId' => (string)$row['provider_mailbox_id'],
                'emailAddress' => (string)$row['email_address'],
                'displayName' => (string)$row['display_name'],
                'enabled' => true,
                'createdAt' => (string)$row['created_at'],
                'updatedAt' => (string)$row['updated_at'],
            ];
        }
        jsonResponse(['ok' => true, 'mailboxes' => $mailboxes]);
    }

    if (preg_match('#^/portal/mailboxes/([^/]+)/folders$#', $apiPath, $matches) && $method === 'GET') {
        $resourceId = rawurldecode($matches[1]);
        hostingerMailRequireClientMailbox($pdo, (string)$portalSession['id'], $resourceId);
        $folders = hostingerMailListFolders($pdo, $resourceId);
        hostingerMailRecordOpened($pdo, (string)$portalSession['id'], $resourceId);
        jsonResponse([
            'ok' => true,
            'folders' => is_array($folders['data'] ?? null) ? $folders['data'] : [],
            'pagination' => $folders['pagination'] ?? null,
            'draftsStoredInCodex' => true,
        ]);
    }

    if (preg_match('#^/portal/mailboxes/([^/]+)/starred$#', $apiPath, $matches) && $method === 'GET') {
        $resourceId = rawurldecode($matches[1]);
        hostingerMailRequireClientMailbox($pdo, (string)$portalSession['id'], $resourceId);
        $page = hostingerMailPageParam('page', 1, 100);
        $perPage = hostingerMailPageParam('perPage', 25, 100);
        $result = hostingerMailStarred($pdo, $resourceId, $page, $perPage);
        jsonResponse(['ok' => true, 'messages' => $result['messages'], 'pagination' => $result['pagination']]);
    }

    if (preg_match('#^/portal/mailboxes/([^/]+)/drafts(?:/([^/]+))?$#', $apiPath, $matches)) {
        $resourceId = rawurldecode($matches[1]);
        hostingerMailRequireClientMailbox($pdo, (string)$portalSession['id'], $resourceId);
        $draftId = isset($matches[2]) ? rawurldecode($matches[2]) : null;
        if (!$draftId && $method === 'GET') {
            jsonResponse(['ok' => true, 'drafts' => hostingerMailDrafts($pdo, (string)$portalSession['id'], $resourceId)]);
        }
        if (!$draftId && $method === 'POST') {
            $payload = hostingerMailNormalizeCompose($input, false);
            $draftId = trim((string)($input['id'] ?? ''));
            if ($draftId !== '' && !preg_match('/^[A-Za-z0-9_-]{1,191}$/', $draftId)) {
                jsonResponse(['ok' => false, 'error' => 'Draft could not be saved.'], 422);
            }
            $existing = null;
            if ($draftId !== '') {
                $stmt = $pdo->prepare('SELECT id FROM client_mail_drafts WHERE id = ? AND client_id = ? AND provider_mailbox_id = ? LIMIT 1');
                $stmt->execute([$draftId, (string)$portalSession['id'], $resourceId]);
                $existing = $stmt->fetch();
                if (!$existing) jsonResponse(['ok' => false, 'error' => 'Draft not found.'], 404);
            } else {
                $draftId = 'md_' . bin2hex(random_bytes(12));
            }
            $now = hostingerMailNow();
            $draftJson = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            if ($draftJson === false) jsonResponse(['ok' => false, 'error' => 'Draft could not be saved.'], 422);
            if ($existing) {
                $pdo->prepare('UPDATE client_mail_drafts SET draft_json = ?, updated_at = ? WHERE id = ?')
                    ->execute([$draftJson, $now, $draftId]);
            } else {
                $pdo->prepare('INSERT INTO client_mail_drafts (id, client_id, provider_mailbox_id, draft_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
                    ->execute([$draftId, (string)$portalSession['id'], $resourceId, $draftJson, $now, $now]);
            }
            jsonResponse(['ok' => true, 'draft' => array_merge($payload, ['id' => $draftId, 'updatedAt' => $now])], $existing ? 200 : 201);
        }
        if ($draftId && preg_match('/^[A-Za-z0-9_-]{1,191}$/', $draftId)) {
            if ($method === 'GET') {
                $stmt = $pdo->prepare('SELECT draft_json, updated_at FROM client_mail_drafts WHERE id = ? AND client_id = ? AND provider_mailbox_id = ? LIMIT 1');
                $stmt->execute([$draftId, (string)$portalSession['id'], $resourceId]);
                $row = $stmt->fetch();
                if (!$row) jsonResponse(['ok' => false, 'error' => 'Draft not found.'], 404);
                $draft = json_decode((string)$row['draft_json'], true);
                if (!is_array($draft)) $draft = [];
                jsonResponse(['ok' => true, 'draft' => array_merge($draft, ['id' => $draftId, 'updatedAt' => (string)$row['updated_at']])]);
            }
            if ($method === 'DELETE') {
                $stmt = $pdo->prepare('DELETE FROM client_mail_drafts WHERE id = ? AND client_id = ? AND provider_mailbox_id = ?');
                $stmt->execute([$draftId, (string)$portalSession['id'], $resourceId]);
                if ($stmt->rowCount() === 0) jsonResponse(['ok' => false, 'error' => 'Draft not found.'], 404);
                jsonResponse(['ok' => true, 'message' => 'Draft removed.']);
            }
        }
        jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }

    if (preg_match('#^/portal/mailboxes/([^/]+)/quota$#', $apiPath, $matches) && $method === 'GET') {
        $resourceId = rawurldecode($matches[1]);
        hostingerMailRequireClientMailbox($pdo, (string)$portalSession['id'], $resourceId);
        $response = hostingerMailStoredRequest($pdo, 'GET', '/api/v1/mailboxes/' . hostingerMailSegment($resourceId) . '/quota');
        $quota = hostingerMailResponseData($response);
        jsonResponse(['ok' => true, 'quota' => [
            'supported' => (bool)($quota['supported'] ?? false),
            'totalUsage' => (int)($quota['totalUsage'] ?? 0),
            'totalLimit' => (int)($quota['totalLimit'] ?? 0),
            'totalPercentage' => (int)($quota['totalPercentage'] ?? 0),
        ]]);
    }

    if (preg_match('#^/portal/mailboxes/([^/]+)/blocked-senders$#', $apiPath, $matches)) {
        $resourceId = rawurldecode($matches[1]);
        $clientId = (string)$portalSession['id'];
        hostingerMailRequireClientMailbox($pdo, $clientId, $resourceId);
        if ($method === 'GET') {
            jsonResponse(['ok' => true, 'blockedSenders' => hostingerMailBlockedSenders($pdo, $clientId, $resourceId)]);
        }
        if ($method === 'POST') {
            $address = hostingerMailNormalizeSenderAddress($input['address'] ?? null);
            $ownStmt = $pdo->prepare("SELECT 1 FROM client_mailboxes WHERE client_id = ? AND LOWER(email_address) = ? LIMIT 1");
            $ownStmt->execute([$clientId, $address]);
            if ($ownStmt->fetchColumn()) jsonResponse(['ok' => false, 'error' => 'You cannot block one of your own mailboxes.'], 422);
            $existsStmt = $pdo->prepare('SELECT 1 FROM client_mail_blocked_senders WHERE client_id = ? AND provider_mailbox_id = ? AND address = ? LIMIT 1');
            $existsStmt->execute([$clientId, $resourceId, $address]);
            if (!$existsStmt->fetchColumn()) {
                $countStmt = $pdo->prepare('SELECT COUNT(*) FROM client_mail_blocked_senders WHERE client_id = ? AND provider_mailbox_id = ?');
                $countStmt->execute([$clientId, $resourceId]);
                if ((int)$countStmt->fetchColumn() >= 500) jsonResponse(['ok' => false, 'error' => 'The blocked sender list is full. Unblock a sender first.'], 422);
                $pdo->prepare('INSERT INTO client_mail_blocked_senders (id, client_id, provider_mailbox_id, address, created_at) VALUES (?, ?, ?, ?, ?)')
                    ->execute(['mbs_' . bin2hex(random_bytes(10)), $clientId, $resourceId, $address, hostingerMailNow()]);
            }
            $moved = 0;
            $folders = hostingerMailFolderRows($pdo, $resourceId);
            $inbox = hostingerMailFindFolder($folders, '\\Inbox', '/^inbox$/i');
            $junk = hostingerMailFindFolder($folders, '\\Junk', '/spam|junk/i');
            if ($inbox && $junk) {
                $search = hostingerMailStoredRequest(
                    $pdo,
                    'POST',
                    hostingerMailFolderPath($resourceId, (string)$inbox['path'], '/messages/search?' . hostingerMailQuery(['page' => 1, 'perPage' => 100])),
                    ['from' => $address]
                );
                $uids = [];
                foreach ((hostingerMailResponseCollection($search)['data'] ?? []) as $message) {
                    if (is_array($message) && strtolower((string)($message['from']['address'] ?? '')) === $address && (int)($message['uid'] ?? 0) > 0) {
                        $uids[] = (int)$message['uid'];
                    }
                }
                if ($uids) {
                    hostingerMailStoredRequest($pdo, 'POST', hostingerMailFolderPath($resourceId, (string)$inbox['path'], '/messages/move'), [
                        'uids' => $uids,
                        'targetFolder' => (string)$junk['path'],
                    ]);
                    $moved = count($uids);
                }
            }
            jsonResponse([
                'ok' => true,
                'message' => $moved ? "Sender blocked. {$moved} message(s) moved to Spam." : 'Sender blocked. Future messages will be moved to Spam.',
                'moved' => $moved,
                'blockedSenders' => hostingerMailBlockedSenders($pdo, $clientId, $resourceId),
            ]);
        }
        if ($method === 'DELETE') {
            $address = hostingerMailNormalizeSenderAddress($input['address'] ?? null);
            $pdo->prepare('DELETE FROM client_mail_blocked_senders WHERE client_id = ? AND provider_mailbox_id = ? AND address = ?')
                ->execute([$clientId, $resourceId, $address]);
            jsonResponse([
                'ok' => true,
                'message' => 'Sender unblocked.',
                'blockedSenders' => hostingerMailBlockedSenders($pdo, $clientId, $resourceId),
            ]);
        }
        jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }

    if (preg_match('#^/portal/mailboxes/([^/]+)/folders/([^/]+)/messages/bulk$#', $apiPath, $matches) && $method === 'POST') {
        $resourceId = rawurldecode($matches[1]);
        $folder = rawurldecode($matches[2]);
        hostingerMailRequireClientMailbox($pdo, (string)$portalSession['id'], $resourceId);
        $uids = hostingerMailNormalizeUids($input['uids'] ?? null);
        $action = (string)($input['action'] ?? '');
        if ($action === 'move') {
            $targetFolder = trim((string)($input['targetFolder'] ?? ''));
            hostingerMailRequireKnownFolder(hostingerMailFolderRows($pdo, $resourceId), $targetFolder);
            hostingerMailStoredRequest($pdo, 'POST', hostingerMailFolderPath($resourceId, $folder, '/messages/move'), [
                'uids' => $uids,
                'targetFolder' => $targetFolder,
            ]);
            jsonResponse(['ok' => true, 'message' => count($uids) . ' email(s) moved.', 'count' => count($uids)]);
        }
        if ($action === 'delete') {
            if (($input['confirmed'] ?? false) !== true) jsonResponse(['ok' => false, 'error' => 'Confirm permanent deletion before continuing.'], 422);
            hostingerMailStoredRequest($pdo, 'POST', hostingerMailFolderPath($resourceId, $folder, '/messages/delete'), ['uids' => $uids]);
            jsonResponse(['ok' => true, 'message' => count($uids) . ' email(s) permanently deleted.', 'count' => count($uids)]);
        }
        if ($action === 'flags') {
            $addFlags = hostingerMailNormalizeFlagList($input['addFlags'] ?? []);
            $removeFlags = hostingerMailNormalizeFlagList($input['removeFlags'] ?? []);
            if (!$addFlags && !$removeFlags) jsonResponse(['ok' => false, 'error' => 'Choose an email action.'], 422);
            $payload = ['uids' => $uids];
            if ($addFlags) $payload['addFlags'] = $addFlags;
            if ($removeFlags) $payload['removeFlags'] = $removeFlags;
            $response = hostingerMailStoredRequest($pdo, 'POST', hostingerMailFolderPath($resourceId, $folder, '/messages/flags'), $payload);
            $result = hostingerMailResponseData($response);
            $failed = is_array($result['failed'] ?? null) ? count($result['failed']) : 0;
            jsonResponse(['ok' => true, 'message' => $failed ? "Updated with {$failed} failure(s)." : 'Emails updated.', 'failed' => $failed]);
        }
        jsonResponse(['ok' => false, 'error' => 'That email action is not supported.'], 422);
    }

    if (preg_match('#^/portal/mailboxes/([^/]+)/folders/([^/]+)/messages$#', $apiPath, $matches) && $method === 'DELETE') {
        $resourceId = rawurldecode($matches[1]);
        $folder = rawurldecode($matches[2]);
        hostingerMailRequireClientMailbox($pdo, (string)$portalSession['id'], $resourceId);
        if (($input['confirmed'] ?? false) !== true) jsonResponse(['ok' => false, 'error' => 'Confirm emptying this folder before continuing.'], 422);
        $folders = hostingerMailFolderRows($pdo, $resourceId);
        $trash = hostingerMailFindFolder($folders, '\\Trash', '/trash|deleted/i');
        $junk = hostingerMailFindFolder($folders, '\\Junk', '/spam|junk/i');
        $allowed = array_filter([(string)($trash['path'] ?? ''), (string)($junk['path'] ?? '')]);
        if (!in_array($folder, $allowed, true)) jsonResponse(['ok' => false, 'error' => 'Only Trash and Spam can be emptied.'], 422);
        hostingerMailStoredRequest($pdo, 'DELETE', hostingerMailFolderPath($resourceId, $folder, '/messages'));
        jsonResponse(['ok' => true, 'message' => 'Folder emptied.']);
    }

    if (preg_match('#^/portal/mailboxes/([^/]+)/folders/([^/]+)/messages/search$#', $apiPath, $matches)
        && $method === 'POST') {
        $resourceId = rawurldecode($matches[1]);
        $folder = rawurldecode($matches[2]);
        hostingerMailRequireClientMailbox($pdo, (string)$portalSession['id'], $resourceId);
        $text = trim((string)($input['text'] ?? ''));
        if ($text === '' || strlen($text) > 1024) jsonResponse(['ok' => false, 'error' => 'Enter a search term up to 1,024 characters.'], 422);
        $page = hostingerMailPageParam('page', 1, 100000);
        $perPage = hostingerMailPageParam('perPage', 25, 100);
        $sort = (string)($_GET['sort'] ?? '-uid');
        if (!preg_match('/^-?(uid|date|size)$/', $sort)) $sort = '-uid';
        $path = hostingerMailFolderPath(
            $resourceId,
            $folder,
            '/messages/search?' . hostingerMailQuery(['page' => $page, 'perPage' => $perPage, 'sort' => $sort])
        );
        $response = hostingerMailStoredRequest($pdo, 'POST', $path, ['text' => $text]);
        $data = hostingerMailResponseCollection($response);
        jsonResponse([
            'ok' => true,
            'messages' => is_array($data['data'] ?? null) ? $data['data'] : [],
            'pagination' => $data['pagination'] ?? null,
        ]);
    }

    if (preg_match('#^/portal/mailboxes/([^/]+)/folders/([^/]+)/messages$#', $apiPath, $matches)
        && $method === 'GET') {
        $resourceId = rawurldecode($matches[1]);
        $folder = rawurldecode($matches[2]);
        hostingerMailRequireClientMailbox($pdo, (string)$portalSession['id'], $resourceId);
        $page = hostingerMailPageParam('page', 1, 100000);
        $perPage = hostingerMailPageParam('perPage', 25, 100);
        $sort = (string)($_GET['sort'] ?? '-uid');
        if (!preg_match('/^-?(uid|date|size)$/', $sort)) $sort = '-uid';
        $path = hostingerMailFolderPath(
            $resourceId,
            $folder,
            '/messages?' . hostingerMailQuery(['page' => $page, 'perPage' => $perPage, 'sort' => $sort])
        );
        $response = hostingerMailStoredRequest($pdo, 'GET', $path);
        $data = hostingerMailResponseCollection($response);
        $rows = is_array($data['data'] ?? null) ? array_values(array_filter($data['data'], 'is_array')) : [];
        $filtered = hostingerMailFilterBlockedInbox($pdo, (string)$portalSession['id'], $resourceId, $folder, $rows);
        $pagination = $data['pagination'] ?? null;
        if ($filtered['moved'] > 0 && is_array($pagination)) {
            $pagination['total'] = max(0, (int)($pagination['total'] ?? 0) - $filtered['moved']);
        }
        jsonResponse([
            'ok' => true,
            'messages' => $filtered['messages'],
            'pagination' => $pagination,
            'blockedMoved' => $filtered['moved'],
        ]);
    }

    if (preg_match('#^/portal/mailboxes/([^/]+)/folders/([^/]+)/messages/([^/]+)/attachments/([^/]+)$#', $apiPath, $matches)
        && $method === 'GET') {
        $resourceId = rawurldecode($matches[1]);
        $folder = rawurldecode($matches[2]);
        $uid = filter_var($matches[3], FILTER_VALIDATE_INT);
        $attachmentId = rawurldecode($matches[4]);
        hostingerMailRequireClientMailbox($pdo, (string)$portalSession['id'], $resourceId);
        if ($uid === false || $uid < 1 || $attachmentId === '') jsonResponse(['ok' => false, 'error' => 'Attachment not found.'], 404);
        $path = hostingerMailFolderPath(
            $resourceId,
            $folder,
            '/messages/' . (int)$uid . '/attachments/' . hostingerMailSegment($attachmentId)
        );
        $token = hostingerMailToken($pdo);
        $baseUrl = hostingerMailApiBaseUrl();
        $protocol = parse_url($baseUrl, PHP_URL_SCHEME) === 'https' ? CURLPROTO_HTTPS : CURLPROTO_HTTP;
        $handle = curl_init();
        if ($handle === false) jsonResponse(['ok' => false, 'error' => 'Unable to connect to the email service. Please try again.'], 502);
        curl_setopt_array($handle, [
            CURLOPT_URL => $baseUrl . $path,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Accept: application/octet-stream', 'Authorization: Bearer ' . $token],
            CURLOPT_CONNECTTIMEOUT => 7,
            CURLOPT_TIMEOUT => 25,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => $protocol,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);
        $body = curl_exec($handle);
        $curlError = curl_errno($handle);
        $status = (int)curl_getinfo($handle, CURLINFO_HTTP_CODE);
        curl_close($handle);
        if ($body === false || $curlError !== 0) {
            hostingerMailRecordStatus($pdo, 'connection_error', 'network_error');
            jsonResponse(['ok' => false, 'error' => 'Unable to connect to the email service. Please try again.'], 502);
        }
        if ($status < 200 || $status >= 300) {
            $decoded = json_decode((string)$body, true);
            $providerCode = is_array($decoded) ? (string)($decoded['code'] ?? '') : '';
            $error = new HostingerMailApiException($status, preg_replace('/[^A-Za-z0-9_.-]/', '', $providerCode) ?: '');
            if (in_array($status, [401, 403], true) || $status >= 500) hostingerMailRecordStatus($pdo, 'connection_error', $error->providerCode ?: 'connection_error');
            $safe = hostingerMailSafeProviderError($error, false);
            jsonResponse(['ok' => false, 'error' => $safe[0]], $safe[1]);
        }
        hostingerMailRecordStatus($pdo, 'connected');
        header('Cache-Control: private, no-store');
        header('Pragma: no-cache');
        header('X-Content-Type-Options: nosniff');
        header('Content-Type: application/octet-stream');
        header('Content-Disposition: attachment; filename="email-attachment"');
        echo $body;
        exit;
    }

    if (preg_match('#^/portal/mailboxes/([^/]+)/folders/([^/]+)/messages/([^/]+)/move$#', $apiPath, $matches)
        && $method === 'POST') {
        $resourceId = rawurldecode($matches[1]);
        $folder = rawurldecode($matches[2]);
        $uid = filter_var($matches[3], FILTER_VALIDATE_INT);
        hostingerMailRequireClientMailbox($pdo, (string)$portalSession['id'], $resourceId);
        if ($uid === false || $uid < 1) jsonResponse(['ok' => false, 'error' => 'That email could not be found.'], 404);
        $targetFolder = trim((string)($input['targetFolder'] ?? ''));
        if ($targetFolder === '' || strlen($targetFolder) > 100) jsonResponse(['ok' => false, 'error' => 'Choose a valid destination folder.'], 422);
        $folders = hostingerMailListFolders($pdo, $resourceId);
        $knownPaths = array_map(static fn($item) => (string)($item['path'] ?? ''), $folders['data'] ?? []);
        if (!in_array($targetFolder, $knownPaths, true)) jsonResponse(['ok' => false, 'error' => 'That destination folder is not available in this mailbox.'], 422);
        $path = hostingerMailFolderPath($resourceId, $folder, '/messages/' . (int)$uid . '/move');
        hostingerMailStoredRequest($pdo, 'POST', $path, ['targetFolder' => $targetFolder]);
        jsonResponse(['ok' => true, 'message' => 'Email moved.']);
    }

    if (preg_match('#^/portal/mailboxes/([^/]+)/folders/([^/]+)/messages/([^/]+)$#', $apiPath, $matches)) {
        $resourceId = rawurldecode($matches[1]);
        $folder = rawurldecode($matches[2]);
        $uid = filter_var($matches[3], FILTER_VALIDATE_INT);
        hostingerMailRequireClientMailbox($pdo, (string)$portalSession['id'], $resourceId);
        if ($uid === false || $uid < 1) jsonResponse(['ok' => false, 'error' => 'That email could not be found.'], 404);
        $basePath = hostingerMailFolderPath($resourceId, $folder, '/messages/' . (int)$uid);

        if ($method === 'GET') {
            $messageResponse = hostingerMailStoredRequest($pdo, 'GET', $basePath);
            $message = hostingerMailResponseData($messageResponse);
            $textResponse = hostingerMailStoredRequest($pdo, 'GET', $basePath . '/text');
            $body = hostingerMailResponseData($textResponse);
            $message['unseen'] = false;
            $message['flags'] = array_values(array_unique(array_merge(
                array_filter($message['flags'] ?? [], static fn($flag) => $flag !== '\\Seen'),
                ['\\Seen']
            )));
            jsonResponse(['ok' => true, 'message' => $message, 'body' => $body]);
        }

        if ($method === 'PATCH') {
            $allowedFlags = ['\\Seen', '\\Flagged', '\\Answered'];
            $addFlags = $input['addFlags'] ?? [];
            $removeFlags = $input['removeFlags'] ?? [];
            if (!is_array($addFlags) || !is_array($removeFlags)) jsonResponse(['ok' => false, 'error' => 'Message flags are invalid.'], 422);
            $addFlags = array_values(array_unique(array_map('strval', $addFlags)));
            $removeFlags = array_values(array_unique(array_map('strval', $removeFlags)));
            foreach (array_merge($addFlags, $removeFlags) as $flag) {
                if (!in_array($flag, $allowedFlags, true)) jsonResponse(['ok' => false, 'error' => 'That email action is not supported.'], 422);
            }
            if (!$addFlags && !$removeFlags) jsonResponse(['ok' => false, 'error' => 'Choose an email action.'], 422);
            hostingerMailStoredRequest($pdo, 'PATCH', $basePath, ['addFlags' => $addFlags, 'removeFlags' => $removeFlags]);
            jsonResponse(['ok' => true, 'message' => 'Email updated.']);
        }

        if ($method === 'DELETE') {
            if (($input['confirmed'] ?? false) !== true) {
                jsonResponse(['ok' => false, 'error' => 'Confirm permanent deletion before continuing.'], 422);
            }
            hostingerMailStoredRequest($pdo, 'DELETE', $basePath);
            jsonResponse(['ok' => true, 'message' => 'Email permanently deleted.']);
        }

        jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }

    if (preg_match('#^/portal/mailboxes/([^/]+)/send$#', $apiPath, $matches) && $method === 'POST') {
        $resourceId = rawurldecode($matches[1]);
        $assignment = hostingerMailRequireClientMailbox($pdo, (string)$portalSession['id'], $resourceId);
        $payload = hostingerMailNormalizeCompose($input, true);
        $payload['displayName'] = (string)$assignment['display_name'];
        $path = '/api/v1/mailboxes/' . hostingerMailSegment($resourceId) . '/send';
        $clientId = (string)$portalSession['id'];
        if (($input['sendIndividually'] ?? false) === true) {
            $recipients = $payload['to'] ?? [];
            if (!empty($payload['cc']) || !empty($payload['bcc']) || isset($payload['inReplyTo']) || isset($payload['forwardOf'])) {
                jsonResponse(['ok' => false, 'error' => 'Individual sending uses the To field only, without Cc, Bcc, replies, or forwards.'], 422);
            }
            if (count($recipients) < 1 || count($recipients) > 50) {
                jsonResponse(['ok' => false, 'error' => 'Individual sending supports between 1 and 50 recipients.'], 422);
            }
            $sent = 0;
            $failed = [];
            foreach ($recipients as $recipient) {
                try {
                    hostingerMailStoredRequest($pdo, 'POST', $path, array_merge($payload, ['to' => [$recipient]]));
                    $sent++;
                } catch (HostingerMailApiException $error) {
                    $failed[] = $recipient;
                    if (in_array($error->providerStatus, [0, 401, 403, 429], true)) {
                        $failed = array_merge($failed, array_slice($recipients, $sent + count($failed)));
                        break;
                    }
                }
            }
            if ($sent > 0) hostingerMailRecordActivity($pdo, $clientId, $resourceId, 'sent', $sent);
            if ($sent === 0) jsonResponse(['ok' => false, 'error' => 'None of the individual emails could be sent. Please try again.', 'failed' => $failed], 502);
            jsonResponse([
                'ok' => true,
                'sent' => true,
                'sentCount' => $sent,
                'failed' => array_values(array_unique($failed)),
                'message' => $failed ? "Sent {$sent} email(s); " . count(array_unique($failed)) . ' could not be sent.' : "Sent {$sent} individual email(s).",
            ]);
        }
        hostingerMailStoredRequest($pdo, 'POST', $path, $payload);
        hostingerMailRecordActivity($pdo, $clientId, $resourceId, 'sent');
        jsonResponse(['ok' => true, 'sent' => true, 'message' => 'Email sent.']);
    }

    return false;
}

function hostingerMailMongoTransaction(callable $operation): mixed {
    try {
        $session = getMongoDatabase()->getManager()->startSession();
        $session->startTransaction();
    } catch (Throwable $error) {
        jsonResponse([
            'ok' => false,
            'error' => 'MongoDB transactions are required for this operation; no data was changed.',
        ], 503);
    }
    try {
        $result = $operation($session);
        $session->commitTransaction();
        return $result;
    } catch (Throwable $error) {
        if ($session->isInTransaction()) $session->abortTransaction();
        throw $error;
    }
}

function hostingerMailMongoFindOne(string $table, array $filter, mixed $session = null): ?array {
    $options = $session === null ? [] : ['session' => $session];
    return mongoDocumentToArray(getMongoCollection(mongoCollectionName($table))->findOne($filter, $options));
}

function hostingerMailMongoFindMany(string $table, array $filter = [], array $options = [], mixed $session = null): array {
    if ($session !== null) $options['session'] = $session;
    $rows = [];
    foreach (getMongoCollection(mongoCollectionName($table))->find($filter, $options) as $document) {
        $row = mongoDocumentToArray($document);
        if ($row !== null) $rows[] = $row;
    }
    return $rows;
}

function hostingerMailMongoInsert(string $table, array $document, mixed $session = null): void {
    if (!isset($document['_id'])) $document['_id'] = (string)($document['id'] ?? '');
    if ($document['_id'] === '') throw new InvalidArgumentException('MongoDB mail rows require a stable id.');
    $options = $session === null ? [] : ['session' => $session];
    getMongoCollection(mongoCollectionName($table))->insertOne($document, $options);
}

function hostingerMailMongoUpdate(string $table, array $filter, array $updates, mixed $session = null): int {
    $options = $session === null ? [] : ['session' => $session];
    return getMongoCollection(mongoCollectionName($table))->updateOne($filter, ['$set' => $updates], $options)->getModifiedCount();
}

function hostingerMailMongoDelete(string $table, array $filter, mixed $session = null): int {
    $options = $session === null ? [] : ['session' => $session];
    return getMongoCollection(mongoCollectionName($table))->deleteMany($filter, $options)->getDeletedCount();
}

function hostingerMailMongoStaff(?array $session, bool $superAdmin = false): array {
    if (!$session) jsonResponse(['ok' => false, 'error' => 'Authentication required.'], 401);
    $staff = hostingerMailMongoFindOne('staff_users', [
        'id' => (string)($session['id'] ?? ''),
        'deleted_at' => null,
        'status' => 'Active',
    ]);
    if (!$staff) jsonResponse(['ok' => false, 'error' => 'Administrator account is unavailable.'], 401);
    $caps = $staff['capabilities'] ?? [];
    if (is_string($caps)) $caps = json_decode($caps, true);
    $staff['capabilities'] = is_array($caps) ? $caps : [];
    if ($superAdmin && ($staff['role'] ?? '') !== 'Super Admin') {
        jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can perform this action.'], 403);
    }
    return $staff;
}

function hostingerMailMongoAudit(array $staff, string $action, string $details, ?string $clientName = null, mixed $session = null): void {
    hostingerMailMongoInsert('audit_logs', [
        'id' => 'aud_' . bin2hex(random_bytes(8)),
        'user_id' => (string)$staff['id'],
        'client_name' => $clientName,
        'action' => $action,
        'details' => $details,
        'ip_address' => $_SERVER['REMOTE_ADDR'] ?? null,
        'created_at' => hostingerMailNow(),
    ], $session);
}

function hostingerMailMongoAssignmentResponse(array $row, string $idField): array {
    return [
        'id' => (string)($row['id'] ?? ''),
        $idField === 'client_id' ? 'clientId' : 'staffId' => (string)($row[$idField] ?? ''),
        'providerMailboxId' => (string)($row['provider_mailbox_id'] ?? ''),
        'emailAddress' => (string)($row['email_address'] ?? ''),
        'displayName' => (string)($row['display_name'] ?? ''),
        'enabled' => ($row['status'] ?? '') === 'enabled',
        'createdAt' => (string)($row['created_at'] ?? ''),
        'updatedAt' => (string)($row['updated_at'] ?? ''),
    ];
}

function hostingerMailMongoPortalProviderRequest(?PDO $pdo, string $resourceId, string $path, string $method = 'GET', ?array $payload = null): array {
    return hostingerMailStoredRequest($pdo, $method, hostingerMailFolderPath($resourceId, '', '') === ''
        ? $path
        : $path, $payload);
}

function hostingerMailMongoDispatch(?PDO $ignoredPdo, string $apiPath, string $method, array $input, ?array $adminSession, ?array $portalSession): bool {
    $pdo = null;
    $adminBase = '/admin/integrations/hostinger-mail';
    $adminRoute = $apiPath === $adminBase || $apiPath === $adminBase . '/test'
        || $apiPath === '/admin/hostinger/mailboxes' || $apiPath === '/admin/hostinger/overview'
        || preg_match('#^/admin/hostinger/mailboxes/([^/]+)/stats$#', $apiPath)
        || preg_match('#^/admin/clients/([^/]+)/mailboxes(?:/([^/]+))?$#', $apiPath)
        || preg_match('#^/admin/staff/([^/]+)/mailboxes(?:/([^/]+))?$#', $apiPath)
        || preg_match('#^/admin/staff-mailboxes/([^/]+)/reassign$#', $apiPath)
        || preg_match('#^/admin/client-mailboxes/([^/]+)/reassign$#', $apiPath);

    if ($adminRoute) {
        $staff = hostingerMailMongoStaff($adminSession, true);
        header('Cache-Control: no-store, private');
        header('Pragma: no-cache');
        if ($apiPath === $adminBase && $method === 'GET') {
            $row = hostingerMailIntegration(null);
            jsonResponse(['ok' => true, 'integration' => [
                'configured' => !empty($row['encrypted_token']),
                'status' => $row['status'] ?? 'not_configured',
                'lastTestedAt' => $row['last_tested_at'] ?? null,
                'lastSuccessAt' => $row['last_success_at'] ?? null,
                'mailboxCount' => (int)($row['mailbox_count'] ?? 0),
            ]]);
        }
        if ($apiPath === $adminBase . '/test' && $method === 'POST') {
            $candidate = trim((string)($input['token'] ?? ''));
            $integration = hostingerMailIntegration(null);
            $testingStored = $candidate === '';
            if ($testingStored) {
                if (!$integration || empty($integration['encrypted_token'])) jsonResponse(['ok' => false, 'error' => 'Enter a Hostinger Mail API token first.'], 409);
                $candidate = decryptClientSecret((string)$integration['encrypted_token']);
            }
            if (strlen($candidate) < 16 || strlen($candidate) > 4096 || preg_match('/\s/', $candidate)) jsonResponse(['ok' => false, 'error' => 'Enter a valid Hostinger Mail API token.'], 422);
            try {
                $account = hostingerMailAccountWithToken($candidate);
                if ($testingStored) hostingerMailRecordStatus(null, 'connected', null, true, $account);
                hostingerMailMongoAudit($staff, 'HOSTINGER_MAIL_CONNECTION_TESTED', 'Hostinger Mail API connection tested.');
                jsonResponse([
                    'ok' => true,
                    'message' => 'Hostinger Mail API connection successful.',
                    'mailboxCount' => count($account['mailboxes']),
                    'testedStoredToken' => $testingStored,
                ]);
            } catch (HostingerMailApiException $error) {
                if ($testingStored) hostingerMailRecordStatus(null, 'connection_error', $error->providerCode ?: 'connection_error', true);
                $safe = hostingerMailSafeProviderError($error, true);
                jsonResponse(['ok' => false, 'error' => $safe[0]], $safe[1]);
            }
        }
        if ($apiPath === $adminBase && $method === 'POST') {
            $token = trim((string)($input['token'] ?? ''));
            if (strlen($token) < 16 || strlen($token) > 4096 || preg_match('/\s/', $token)) jsonResponse(['ok' => false, 'error' => 'Enter a valid Hostinger Mail API token.'], 422);
            try {
                $account = hostingerMailAccountWithToken($token);
                $now = hostingerMailNow();
                $existing = hostingerMailIntegration(null);
                $document = [
                    'id' => 'primary',
                    'encrypted_token' => encryptClientSecret($token),
                    'status' => 'connected',
                    'last_tested_at' => $now,
                    'last_success_at' => $now,
                    'last_error_code' => null,
                    'mailbox_count' => count($account['mailboxes']),
                    'order_resource_id' => (string)($account['orderResourceId'] ?? ''),
                    'updated_by' => (string)$staff['id'],
                    'updated_at' => $now,
                ];
                if (!$existing) {
                    $document['created_by'] = (string)$staff['id'];
                    $document['created_at'] = $now;
                }
                getMongoCollection(mongoCollectionName('hostinger_mail_integrations'))->updateOne(
                    ['id' => 'primary'],
                    ['$set' => $document],
                    ['upsert' => true],
                );
                hostingerMailMongoAudit(
                    $staff,
                    $existing ? 'HOSTINGER_MAIL_TOKEN_UPDATED' : 'HOSTINGER_MAIL_TOKEN_CONFIGURED',
                    $existing ? 'Super Admin updated the Hostinger Mail API credential.' : 'Super Admin configured the Hostinger Mail API credential.',
                );
                jsonResponse(['ok' => true, 'message' => 'Hostinger Mail API token saved and validated.', 'integration' => [
                    'configured' => true, 'status' => 'connected', 'lastTestedAt' => $now,
                    'lastSuccessAt' => $now, 'mailboxCount' => count($account['mailboxes']),
                ]]);
            } catch (HostingerMailApiException $error) {
                $safe = hostingerMailSafeProviderError($error, true);
                jsonResponse(['ok' => false, 'error' => $safe[0]], $safe[1]);
            }
        }
        if ($apiPath === $adminBase && $method === 'DELETE') {
            if (hostingerMailIntegration(null)) {
                hostingerMailMongoDelete('hostinger_mail_integrations', ['id' => 'primary']);
                hostingerMailMongoAudit($staff, 'HOSTINGER_MAIL_TOKEN_REMOVED', 'Super Admin removed the Hostinger Mail API credential.');
            }
            jsonResponse(['ok' => true, 'message' => 'Hostinger Mail API token removed.']);
        }
        if ($apiPath === '/admin/hostinger/mailboxes' && $method === 'GET') {
            $account = hostingerMailAccount(null);
            jsonResponse(['ok' => true, 'orderResourceId' => (string)($account['orderResourceId'] ?? ''),
                'mailboxes' => hostingerMailNormalizeProviderMailboxes($account, null)]);
        }
        if (preg_match('#^/admin/hostinger/mailboxes/([^/]+)/stats$#', $apiPath, $matches) && $method === 'GET') {
            $resourceId = rawurldecode($matches[1]);
            if (!preg_match('/^AC[A-Za-z0-9]+$/', $resourceId)) jsonResponse(['ok' => false, 'error' => 'Mailbox was not found.'], 404);
            jsonResponse(['ok' => true, 'stats' => hostingerMailboxStats(null, $resourceId)]);
        }
        if ($apiPath === '/admin/hostinger/overview' && $method === 'GET') {
            return hostingerMailMongoOverview($staff);
        }
        if (preg_match('#^/admin/clients/([^/]+)/mailboxes(?:/([^/]+))?$#', $apiPath, $matches)) {
            return hostingerMailMongoClientAssignments($staff, $matches, $method, $input);
        }
        if (preg_match('#^/admin/staff/([^/]+)/mailboxes(?:/([^/]+))?$#', $apiPath, $matches)) {
            return hostingerMailMongoStaffAssignments($staff, $matches, $method, $input);
        }
        if (preg_match('#^/admin/staff-mailboxes/([^/]+)/reassign$#', $apiPath, $matches) && $method === 'POST') {
            return hostingerMailMongoReassignStaff($staff, rawurldecode($matches[1]), $input);
        }
        if (preg_match('#^/admin/client-mailboxes/([^/]+)/reassign$#', $apiPath, $matches) && $method === 'POST') {
            return hostingerMailMongoReassignClient($staff, rawurldecode($matches[1]), $input);
        }
        jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }

    if (!str_starts_with($apiPath, '/portal/mailboxes')) return false;
    if (!$portalSession || empty($portalSession['id'])) jsonResponse(['ok' => false, 'error' => 'Authentication required.'], 401);
    $clientId = (string)$portalSession['id'];
    if ($apiPath === '/portal/mailboxes' && $method === 'GET') {
        header('Cache-Control: no-store, private');
        header('Pragma: no-cache');
        $integration = hostingerMailIntegration(null);
        if (!$integration || empty($integration['encrypted_token'])) jsonResponse(['ok' => false, 'error' => 'Email service is not configured yet. Please contact your administrator.'], 409);
        $rows = hostingerMailMongoFindMany('client_mailboxes', [
            'client_id' => $clientId, 'provider' => 'hostinger', 'status' => 'enabled',
        ], ['sort' => ['email_address' => 1]]);
        $mailboxes = array_map(static fn($row) => [
            'id' => (string)$row['id'], 'clientId' => (string)$row['client_id'],
            'providerMailboxId' => (string)$row['provider_mailbox_id'],
            'emailAddress' => (string)$row['email_address'], 'displayName' => (string)$row['display_name'],
            'enabled' => true, 'createdAt' => (string)$row['created_at'], 'updatedAt' => (string)$row['updated_at'],
        ], $rows);
        jsonResponse(['ok' => true, 'mailboxes' => $mailboxes]);
    }
    return hostingerMailMongoPortalRoutes($pdo, $apiPath, $method, $input, $clientId);
}

function hostingerMailMongoOverview(array $staff): bool {
    $integration = hostingerMailIntegration(null);
    $configured = !empty($integration['encrypted_token']);
    $providerMailboxes = [];
    $providerError = null;
    if ($configured) {
        try {
            foreach (hostingerMailAccount(null)['mailboxes'] as $mailbox) {
                if (!is_array($mailbox) || empty($mailbox['resourceId']) || empty($mailbox['address'])) continue;
                $providerMailboxes[(string)$mailbox['resourceId']] = (string)$mailbox['address'];
            }
        } catch (HostingerMailApiException $error) {
            $providerError = hostingerMailSafeProviderError($error, true)[0];
        }
    }
    $assignments = [];
    foreach (hostingerMailMongoFindMany('client_mailboxes', ['provider' => 'hostinger']) as $row) {
        $client = hostingerMailMongoFindOne('clients', ['id' => (string)($row['client_id'] ?? '')]) ?? [];
        $portal = hostingerMailMongoFindOne('client_portal_access', ['client_id' => (string)($row['client_id'] ?? '')]) ?? [];
        $row['client_name'] = $client['name'] ?? '';
        $row['client_company'] = $client['company'] ?? '';
        $row['client_email'] = $client['email'] ?? '';
        $row['portal_enabled'] = $portal['portal_enabled'] ?? 0;
        $row['portal_status'] = $portal['status'] ?? '';
        $assignments[(string)$row['provider_mailbox_id']] = $row;
    }
    $activity = [];
    $cutoff = date('c', time() - 86400 * 30);
    foreach (hostingerMailMongoFindMany('client_mail_activity') as $row) {
        $resourceId = (string)($row['provider_mailbox_id'] ?? '');
        $action = (string)($row['action'] ?? '');
        $created = (string)($row['created_at'] ?? '');
        if ($resourceId === '' || $action === '') continue;
        if (!isset($activity[$resourceId][$action]) || strcmp($created, $activity[$resourceId][$action]['lastAt']) > 0) {
            $activity[$resourceId][$action]['lastAt'] = $created;
        }
        if ($created >= $cutoff) $activity[$resourceId][$action]['recentCount'] =
            ($activity[$resourceId][$action]['recentCount'] ?? 0) + (int)($row['item_count'] ?? 0);
    }
    $ids = array_values(array_unique(array_merge(array_keys($providerMailboxes), array_keys($assignments))));
    $rows = [];
    foreach ($ids as $resourceId) {
        $assignment = $assignments[$resourceId] ?? null;
        $mailboxActivity = $activity[$resourceId] ?? [];
        $rows[] = [
            'resourceId' => $resourceId,
            'address' => $providerMailboxes[$resourceId] ?? (string)($assignment['email_address'] ?? ''),
            'inHostinger' => $configured && $providerError === null ? isset($providerMailboxes[$resourceId]) : null,
            'assignment' => $assignment ? [
                'id' => (string)$assignment['id'], 'clientId' => (string)$assignment['client_id'],
                'clientName' => (string)$assignment['client_name'], 'clientCompany' => (string)$assignment['client_company'],
                'clientEmail' => (string)$assignment['client_email'], 'displayName' => (string)$assignment['display_name'],
                'enabled' => $assignment['status'] === 'enabled',
                'portalActive' => !empty($assignment['portal_enabled']) && $assignment['portal_status'] === 'Active',
                'assignedAt' => (string)$assignment['created_at'],
            ] : null,
            'activity' => [
                'lastOpenedAt' => $mailboxActivity['opened']['lastAt'] ?? null,
                'lastSentAt' => $mailboxActivity['sent']['lastAt'] ?? null,
                'sentLast30Days' => $mailboxActivity['sent']['recentCount'] ?? 0,
            ],
        ];
    }
    usort($rows, static fn($a, $b) => strcasecmp($a['address'], $b['address']));
    $clients = [];
    foreach (hostingerMailMongoFindMany('clients', ['$or' => [['deleted_at' => null], ['deleted_at' => '']]], ['limit' => 1000]) as $client) {
        $portal = hostingerMailMongoFindOne('client_portal_access', ['client_id' => (string)$client['id']]) ?? [];
        $clients[] = [
            'id' => (string)$client['id'], 'name' => (string)($client['name'] ?? ''),
            'company' => (string)($client['company'] ?? ''), 'email' => (string)($client['email'] ?? ''),
            'portalActive' => !empty($portal['portal_enabled']) && ($portal['status'] ?? '') === 'Active',
        ];
    }
    usort($clients, static fn($a, $b) => strcasecmp(($a['company'] ?: $a['name']), ($b['company'] ?: $b['name'])));
    jsonResponse(['ok' => true, 'integration' => [
        'configured' => $configured, 'status' => $integration['status'] ?? 'not_configured',
        'lastTestedAt' => $integration['last_tested_at'] ?? null, 'lastSuccessAt' => $integration['last_success_at'] ?? null,
    ], 'providerError' => $providerError, 'mailboxes' => $rows, 'clients' => $clients]);
}

function hostingerMailMongoClientAssignments(array $staff, array $matches, string $method, array $input): bool {
    $clientId = rawurldecode($matches[1]);
    if (!preg_match('/^[A-Za-z0-9_-]{1,191}$/', $clientId)) jsonResponse(['ok' => false, 'error' => 'Client account was not found.'], 404);
    $client = hostingerMailMongoFindOne('clients', ['id' => $clientId]);
    if (!$client) jsonResponse(['ok' => false, 'error' => 'Email account assignments require a client portal account.'], 404);
    $assignmentId = isset($matches[2]) ? rawurldecode($matches[2]) : null;
    if (!$assignmentId && $method === 'GET') {
        $rows = hostingerMailMongoFindMany('client_mailboxes', ['client_id' => $clientId, 'provider' => 'hostinger'], ['sort' => ['email_address' => 1]]);
        $mailboxes = array_map(static fn($row) => hostingerMailMongoAssignmentResponse($row, 'client_id'), $rows);
        jsonResponse(['ok' => true, 'mailboxes' => $mailboxes]);
    }
    if (!$assignmentId && $method === 'POST') {
        $resourceId = trim((string)($input['providerMailboxId'] ?? ''));
        $displayName = trim((string)($input['displayName'] ?? ''));
        $enabled = array_key_exists('enabled', $input) ? (bool)$input['enabled'] : true;
        if (!preg_match('/^AC[A-Za-z0-9]+$/', $resourceId)) jsonResponse(['ok' => false, 'error' => 'Select a mailbox returned by Hostinger.'], 422);
        if (strlen($displayName) > 191) jsonResponse(['ok' => false, 'error' => 'The display name is too long.'], 422);
        $account = hostingerMailAccount(null);
        $providerMailbox = null;
        foreach ($account['mailboxes'] as $candidate) if (($candidate['resourceId'] ?? null) === $resourceId) { $providerMailbox = $candidate; break; }
        if (!$providerMailbox || !filter_var((string)($providerMailbox['address'] ?? ''), FILTER_VALIDATE_EMAIL)) jsonResponse(['ok' => false, 'error' => 'That mailbox was not found in the connected Hostinger account.'], 422);
        if (hostingerMailMongoFindOne('client_mailboxes', ['provider_mailbox_id' => $resourceId])
            || hostingerMailMongoFindOne('staff_mailboxes', ['provider_mailbox_id' => $resourceId])) {
            jsonResponse(['ok' => false, 'error' => 'This mailbox is already assigned to another client. Use the explicit reassignment action to transfer it.'], 409);
        }
        $now = hostingerMailNow();
        $id = 'hmb_' . bin2hex(random_bytes(12));
        $address = (string)$providerMailbox['address'];
        $row = ['id' => $id, 'client_id' => $clientId, 'provider' => 'hostinger', 'provider_mailbox_id' => $resourceId,
            'email_address' => $address, 'display_name' => $displayName !== '' ? $displayName : $address,
            'status' => $enabled ? 'enabled' : 'disabled', 'created_by' => (string)$staff['id'], 'created_at' => $now, 'updated_at' => $now];
        hostingerMailMongoInsert('client_mailboxes', $row);
        hostingerMailMongoAudit($staff, 'HOSTINGER_MAILBOX_ASSIGNED', 'Hostinger mailbox ' . $address . ' assigned to client ' . $clientId . '.', (string)(($client['company'] ?? '') ?: ($client['name'] ?? '')));
        jsonResponse(['ok' => true, 'mailbox' => [
            'id' => $id, 'clientId' => $clientId, 'providerMailboxId' => $resourceId, 'emailAddress' => $address,
            'displayName' => $row['display_name'], 'enabled' => $enabled, 'createdAt' => $now, 'updatedAt' => $now,
        ]], 201);
    }
    if ($assignmentId && preg_match('/^[A-Za-z0-9_-]{1,191}$/', $assignmentId)) {
        $assignment = hostingerMailMongoFindOne('client_mailboxes', ['id' => $assignmentId, 'client_id' => $clientId, 'provider' => 'hostinger']);
        if (!$assignment) jsonResponse(['ok' => false, 'error' => 'Mailbox assignment was not found.'], 404);
        if ($method === 'PATCH') {
            $displayName = (string)$assignment['display_name'];
            $status = (string)$assignment['status'];
            if (array_key_exists('displayName', $input)) {
                if (!is_string($input['displayName']) || strlen(trim($input['displayName'])) > 191) jsonResponse(['ok' => false, 'error' => 'The display name is invalid.'], 422);
                $displayName = trim($input['displayName']);
            }
            if (array_key_exists('enabled', $input)) {
                if (!is_bool($input['enabled'])) jsonResponse(['ok' => false, 'error' => 'Choose whether the mailbox is enabled.'], 422);
                $status = $input['enabled'] ? 'enabled' : 'disabled';
            }
            if (!array_key_exists('displayName', $input) && !array_key_exists('enabled', $input)) jsonResponse(['ok' => false, 'error' => 'There are no mailbox changes to save.'], 422);
            $now = hostingerMailNow();
            hostingerMailMongoUpdate('client_mailboxes', ['id' => $assignmentId, 'client_id' => $clientId, 'provider' => 'hostinger'], ['display_name' => $displayName, 'status' => $status, 'updated_at' => $now]);
            $action = $status !== $assignment['status'] ? 'HOSTINGER_MAILBOX_STATUS_CHANGED' : 'HOSTINGER_MAILBOX_UPDATED';
            hostingerMailMongoAudit($staff, $action, 'Mailbox ' . $assignment['email_address'] . ' updated for client ' . $clientId . '.', (string)(($client['company'] ?? '') ?: ($client['name'] ?? '')));
            jsonResponse(['ok' => true, 'mailbox' => ['id' => $assignmentId, 'clientId' => $clientId,
                'providerMailboxId' => (string)$assignment['provider_mailbox_id'], 'emailAddress' => (string)$assignment['email_address'],
                'displayName' => $displayName, 'enabled' => $status === 'enabled', 'updatedAt' => $now]]);
        }
        if ($method === 'DELETE') {
            hostingerMailMongoTransaction(static function ($session) use ($assignment, $assignmentId, $clientId): void {
                hostingerMailMongoDelete('client_mail_drafts', ['client_id' => $clientId, 'provider_mailbox_id' => $assignment['provider_mailbox_id']], $session);
                hostingerMailMongoDelete('client_mail_blocked_senders', ['client_id' => $clientId, 'provider_mailbox_id' => $assignment['provider_mailbox_id']], $session);
                hostingerMailMongoDelete('client_mailboxes', ['id' => $assignmentId, 'client_id' => $clientId], $session);
            });
            hostingerMailMongoAudit($staff, 'HOSTINGER_MAILBOX_UNASSIGNED', 'Mailbox ' . $assignment['email_address'] . ' removed from client ' . $clientId . '; the Hostinger mailbox was not deleted.',
                (string)(($client['company'] ?? '') ?: ($client['name'] ?? '')));
            jsonResponse(['ok' => true, 'message' => 'Mailbox removed from this client. The Hostinger mailbox was not deleted.']);
        }
    }
    jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

function hostingerMailMongoStaffAssignments(array $staff, array $matches, string $method, array $input): bool {
    $staffId = rawurldecode($matches[1]);
    if (!preg_match('/^[A-Za-z0-9_-]{1,191}$/', $staffId)) jsonResponse(['ok' => false, 'error' => 'Staff account was not found.'], 404);
    $target = hostingerMailMongoFindOne('staff_users', ['id' => $staffId, 'deleted_at' => null]);
    if (!$target || ($target['status'] ?? '') !== 'Active') jsonResponse(['ok' => false, 'error' => 'Staff account was not found or is unavailable.'], 404);
    $actor = hostingerMailMongoStaff($staffSession = ['id' => $staff['id']]);
    $allowed = ($actor['role'] ?? '') === 'Super Admin'
        || (($actor['role'] ?? '') === 'Office Manager' && ($target['office_id'] ?? null) === ($actor['office_id'] ?? null))
        || (($actor['role'] ?? '') === 'Team Leader' && ($target['team_id'] ?? null) === ($actor['team_id'] ?? null))
        || (string)$actor['id'] === (string)$target['id'];
    if (!$allowed) jsonResponse(['ok' => false, 'error' => 'You do not have access to this staff mailbox.'], 403);
    $assignmentId = isset($matches[2]) ? rawurldecode($matches[2]) : null;
    if (!$assignmentId && $method === 'GET') {
        $rows = hostingerMailMongoFindMany('staff_mailboxes', ['staff_id' => $staffId, 'provider' => 'hostinger'], ['sort' => ['email_address' => 1]]);
        jsonResponse(['ok' => true, 'mailboxes' => array_map(static fn($row) => hostingerMailMongoAssignmentResponse($row, 'staff_id'), $rows)]);
    }
    if (!$assignmentId && $method === 'POST') {
        $resourceId = trim((string)($input['providerMailboxId'] ?? ''));
        $displayName = trim((string)($input['displayName'] ?? ''));
        $enabled = array_key_exists('enabled', $input) ? (bool)$input['enabled'] : true;
        if (!preg_match('/^AC[A-Za-z0-9]+$/', $resourceId)) jsonResponse(['ok' => false, 'error' => 'Select a mailbox returned by Hostinger.'], 422);
        if (strlen($displayName) > 191) jsonResponse(['ok' => false, 'error' => 'The display name is too long.'], 422);
        $account = hostingerMailAccount(null);
        $providerMailbox = null;
        foreach ($account['mailboxes'] as $candidate) if (($candidate['resourceId'] ?? null) === $resourceId) { $providerMailbox = $candidate; break; }
        if (!$providerMailbox || !filter_var((string)($providerMailbox['address'] ?? ''), FILTER_VALIDATE_EMAIL)) jsonResponse(['ok' => false, 'error' => 'That mailbox was not found in the connected Hostinger account.'], 422);
        if (hostingerMailMongoFindOne('staff_mailboxes', ['provider_mailbox_id' => $resourceId])
            || hostingerMailMongoFindOne('client_mailboxes', ['provider_mailbox_id' => $resourceId])) {
            jsonResponse(['ok' => false, 'error' => 'This mailbox is already assigned to another account. Use the explicit reassignment action to transfer it.'], 409);
        }
        $now = hostingerMailNow();
        $id = 'hms_' . bin2hex(random_bytes(12));
        $address = (string)$providerMailbox['address'];
        $row = ['id' => $id, 'staff_id' => $staffId, 'provider' => 'hostinger', 'provider_mailbox_id' => $resourceId,
            'email_address' => $address, 'display_name' => $displayName !== '' ? $displayName : $address,
            'status' => $enabled ? 'enabled' : 'disabled', 'created_by' => (string)$actor['id'], 'created_at' => $now, 'updated_at' => $now];
        hostingerMailMongoInsert('staff_mailboxes', $row);
        hostingerMailMongoAudit($actor, 'HOSTINGER_STAFF_MAILBOX_ASSIGNED', 'Hostinger mailbox ' . $address . ' assigned to staff ' . $staffId . '.');
        $result = hostingerMailMongoAssignmentResponse($row, 'staff_id');
        jsonResponse(['ok' => true, 'mailbox' => $result], 201);
    }
    if ($assignmentId && preg_match('/^[A-Za-z0-9_-]{1,191}$/', $assignmentId)) {
        $assignment = hostingerMailMongoFindOne('staff_mailboxes', ['id' => $assignmentId, 'staff_id' => $staffId, 'provider' => 'hostinger']);
        if (!$assignment) jsonResponse(['ok' => false, 'error' => 'Mailbox assignment was not found.'], 404);
        if ($method === 'PATCH') {
            $displayName = (string)$assignment['display_name'];
            $status = (string)$assignment['status'];
            if (array_key_exists('displayName', $input)) {
                if (!is_string($input['displayName']) || strlen(trim($input['displayName'])) > 191) jsonResponse(['ok' => false, 'error' => 'The display name is invalid.'], 422);
                $displayName = trim($input['displayName']);
            }
            if (array_key_exists('enabled', $input)) {
                if (!is_bool($input['enabled'])) jsonResponse(['ok' => false, 'error' => 'Choose whether the mailbox is enabled.'], 422);
                $status = $input['enabled'] ? 'enabled' : 'disabled';
            }
            if (!array_key_exists('displayName', $input) && !array_key_exists('enabled', $input)) jsonResponse(['ok' => false, 'error' => 'There are no mailbox changes to save.'], 422);
            $now = hostingerMailNow();
            hostingerMailMongoUpdate('staff_mailboxes', ['id' => $assignmentId, 'staff_id' => $staffId], ['display_name' => $displayName, 'status' => $status, 'updated_at' => $now]);
            hostingerMailMongoAudit($actor, $status !== $assignment['status'] ? 'HOSTINGER_STAFF_MAILBOX_STATUS_CHANGED' : 'HOSTINGER_STAFF_MAILBOX_UPDATED',
                'Mailbox ' . $assignment['email_address'] . ' updated for staff ' . $staffId . '.');
            jsonResponse(['ok' => true, 'mailbox' => array_merge(hostingerMailMongoAssignmentResponse(array_merge($assignment, ['display_name' => $displayName, 'status' => $status, 'updated_at' => $now]), 'staff_id'), ['enabled' => $status === 'enabled'])]);
        }
        if ($method === 'DELETE') {
            hostingerMailMongoTransaction(static function ($session) use ($assignment, $assignmentId, $staffId, $actor): void {
                hostingerMailMongoDelete('staff_mailboxes', ['id' => $assignmentId, 'staff_id' => $staffId], $session);
                hostingerMailMongoAudit($actor, 'HOSTINGER_STAFF_MAILBOX_UNASSIGNED',
                    'Mailbox ' . $assignment['email_address'] . ' removed from staff ' . $staffId . '; the Hostinger mailbox was not deleted.', null, $session);
            });
            jsonResponse(['ok' => true, 'message' => 'Mailbox removed from this staff member. The Hostinger mailbox was not deleted.']);
        }
    }
    jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

function hostingerMailMongoReassignStaff(array $actor, string $assignmentId, array $input): bool {
    $targetStaffId = trim((string)($input['targetStaffId'] ?? ''));
    $displayName = trim((string)($input['displayName'] ?? ''));
    if (($input['confirmed'] ?? false) !== true) jsonResponse(['ok' => false, 'error' => 'Confirm the mailbox transfer before continuing.'], 422);
    if (!preg_match('/^[A-Za-z0-9_-]{1,191}$/', $assignmentId) || !preg_match('/^[A-Za-z0-9_-]{1,191}$/', $targetStaffId) || strlen($displayName) > 191) jsonResponse(['ok' => false, 'error' => 'The mailbox transfer details are invalid.'], 422);
    $target = hostingerMailMongoFindOne('staff_users', ['id' => $targetStaffId, 'deleted_at' => null]);
    if (!$target || ($target['status'] ?? '') !== 'Active') jsonResponse(['ok' => false, 'error' => 'The destination staff account was not found.'], 404);
    $scoped = ($actor['role'] ?? '') === 'Super Admin'
        || (($actor['role'] ?? '') === 'Office Manager' && ($actor['office_id'] ?? null) === ($target['office_id'] ?? null))
        || (($actor['role'] ?? '') === 'Team Leader' && ($actor['team_id'] ?? null) === ($target['team_id'] ?? null))
        || (string)$actor['id'] === $targetStaffId;
    if (!$scoped) jsonResponse(['ok' => false, 'error' => 'You cannot transfer a mailbox into this staff account.'], 403);
    hostingerMailMongoTransaction(static function ($session) use ($assignmentId, $targetStaffId, $displayName, $actor): void {
        $assignment = hostingerMailMongoFindOne('staff_mailboxes', ['id' => $assignmentId], $session);
        if (!$assignment) jsonResponse(['ok' => false, 'error' => 'Mailbox assignment was not found.'], 404);
        if ((string)$assignment['staff_id'] === $targetStaffId) jsonResponse(['ok' => false, 'error' => 'This mailbox is already assigned to the selected staff member.'], 409);
        $now = hostingerMailNow();
        $newName = $displayName !== '' ? $displayName : (string)$assignment['email_address'];
        $result = getMongoCollection(mongoCollectionName('staff_mailboxes'))->updateOne(
            ['id' => $assignmentId, 'staff_id' => (string)$assignment['staff_id']],
            ['$set' => ['staff_id' => $targetStaffId, 'display_name' => $newName, 'updated_at' => $now]],
            ['session' => $session],
        );
        if ($result->getModifiedCount() !== 1) throw new RuntimeException('Mailbox assignment changed during transfer.');
        hostingerMailMongoAudit($actor, 'HOSTINGER_STAFF_MAILBOX_REASSIGNED',
            'Mailbox ' . $assignment['email_address'] . ' transferred from staff ' . $assignment['staff_id'] . ' to staff ' . $targetStaffId . '.', null, $session);
    });
    jsonResponse(['ok' => true, 'message' => 'Mailbox reassigned to the selected staff member.']);
}

function hostingerMailMongoReassignClient(array $staff, string $assignmentId, array $input): bool {
    $targetClientId = trim((string)($input['targetClientId'] ?? ''));
    $displayName = trim((string)($input['displayName'] ?? ''));
    if (($input['confirmed'] ?? false) !== true) jsonResponse(['ok' => false, 'error' => 'Confirm the mailbox transfer before continuing.'], 422);
    if (!preg_match('/^[A-Za-z0-9_-]{1,191}$/', $assignmentId) || !preg_match('/^[A-Za-z0-9_-]{1,191}$/', $targetClientId) || strlen($displayName) > 191) jsonResponse(['ok' => false, 'error' => 'The mailbox transfer details are invalid.'], 422);
    $target = hostingerMailMongoFindOne('clients', ['id' => $targetClientId]);
    if (!$target) jsonResponse(['ok' => false, 'error' => 'The destination client account was not found.'], 404);
    hostingerMailMongoTransaction(static function ($session) use ($assignmentId, $targetClientId, $displayName, $staff, $target): void {
        $assignment = hostingerMailMongoFindOne('client_mailboxes', ['id' => $assignmentId], $session);
        if (!$assignment) jsonResponse(['ok' => false, 'error' => 'Mailbox assignment was not found.'], 404);
        if ((string)$assignment['client_id'] === $targetClientId) jsonResponse(['ok' => false, 'error' => 'This mailbox is already assigned to the selected client.'], 409);
        $sourceId = (string)$assignment['client_id'];
        $resourceId = (string)$assignment['provider_mailbox_id'];
        $newName = $displayName !== '' ? $displayName : (string)$assignment['email_address'];
        $now = hostingerMailNow();
        hostingerMailMongoDelete('client_mail_drafts', ['client_id' => $sourceId, 'provider_mailbox_id' => $resourceId], $session);
        hostingerMailMongoDelete('client_mail_blocked_senders', ['client_id' => $sourceId, 'provider_mailbox_id' => $resourceId], $session);
        $result = getMongoCollection(mongoCollectionName('client_mailboxes'))->updateOne(
            ['id' => $assignmentId, 'client_id' => $sourceId],
            ['$set' => ['client_id' => $targetClientId, 'display_name' => $newName, 'updated_at' => $now]],
            ['session' => $session],
        );
        if ($result->getModifiedCount() !== 1) throw new RuntimeException('Mailbox assignment changed during transfer.');
        hostingerMailMongoAudit($staff, 'HOSTINGER_MAILBOX_REASSIGNED',
            'Mailbox ' . $assignment['email_address'] . ' transferred from client ' . $sourceId . ' to client ' . $targetClientId . '.',
            (string)(($target['company'] ?? '') ?: ($target['name'] ?? '')), $session);
    });
    jsonResponse(['ok' => true, 'message' => 'Mailbox reassigned to the selected client.']);
}

function hostingerMailMongoPortalRoutes(?PDO $pdo, string $apiPath, string $method, array $input, string $clientId): bool {
    if (preg_match('#^/portal/mailboxes/([^/]+)/folders$#', $apiPath, $m) && $method === 'GET') {
        $resourceId = rawurldecode($m[1]);
        hostingerMailRequireClientMailbox($pdo, $clientId, $resourceId);
        $result = hostingerMailListFolders($pdo, $resourceId);
        hostingerMailRecordOpened($pdo, $clientId, $resourceId);
        jsonResponse(['ok' => true, 'folders' => is_array($result['data'] ?? null) ? $result['data'] : [],
            'pagination' => $result['pagination'] ?? null, 'draftsStoredInCodex' => true]);
    }
    if (preg_match('#^/portal/mailboxes/([^/]+)/starred$#', $apiPath, $m) && $method === 'GET') {
        $resourceId = rawurldecode($m[1]);
        hostingerMailRequireClientMailbox($pdo, $clientId, $resourceId);
        $result = hostingerMailStarred($pdo, $resourceId, hostingerMailPageParam('page', 1, 100), hostingerMailPageParam('perPage', 25, 100));
        jsonResponse(['ok' => true, 'messages' => $result['messages'], 'pagination' => $result['pagination']]);
    }
    if (preg_match('#^/portal/mailboxes/([^/]+)/drafts(?:/([^/]+))?$#', $apiPath, $m)) {
        return hostingerMailMongoDraftRoute($pdo, rawurldecode($m[1]), isset($m[2]) ? rawurldecode($m[2]) : null, $method, $input, $clientId);
    }
    if (preg_match('#^/portal/mailboxes/([^/]+)/quota$#', $apiPath, $m) && $method === 'GET') {
        $resourceId = rawurldecode($m[1]);
        hostingerMailRequireClientMailbox($pdo, $clientId, $resourceId);
        $result = hostingerMailResponseData(hostingerMailStoredRequest($pdo, 'GET', '/api/v1/mailboxes/' . hostingerMailSegment($resourceId) . '/quota'));
        jsonResponse(['ok' => true, 'quota' => [
            'supported' => (bool)($result['supported'] ?? false), 'totalUsage' => (int)($result['totalUsage'] ?? 0),
            'totalLimit' => (int)($result['totalLimit'] ?? 0), 'totalPercentage' => (int)($result['totalPercentage'] ?? 0),
        ]]);
    }
    if (preg_match('#^/portal/mailboxes/([^/]+)/blocked-senders$#', $apiPath, $m)) {
        return hostingerMailMongoBlockedSenderRoute($pdo, rawurldecode($m[1]), $method, $input, $clientId);
    }
    if (preg_match('#^/portal/mailboxes/([^/]+)/folders/([^/]+)/messages/bulk$#', $apiPath, $m) && $method === 'POST') {
        $resourceId = rawurldecode($m[1]); $folder = rawurldecode($m[2]);
        hostingerMailRequireClientMailbox($pdo, $clientId, $resourceId);
        $uids = hostingerMailNormalizeUids($input['uids'] ?? null);
        $action = (string)($input['action'] ?? '');
        if ($action === 'move') {
            $target = trim((string)($input['targetFolder'] ?? ''));
            hostingerMailRequireKnownFolder(hostingerMailFolderRows($pdo, $resourceId), $target);
            hostingerMailStoredRequest($pdo, 'POST', hostingerMailFolderPath($resourceId, $folder, '/messages/move'), ['uids' => $uids, 'targetFolder' => $target]);
            jsonResponse(['ok' => true, 'message' => count($uids) . ' email(s) moved.', 'count' => count($uids)]);
        }
        if ($action === 'delete') {
            if (($input['confirmed'] ?? false) !== true) jsonResponse(['ok' => false, 'error' => 'Confirm permanent deletion before continuing.'], 422);
            hostingerMailStoredRequest($pdo, 'POST', hostingerMailFolderPath($resourceId, $folder, '/messages/delete'), ['uids' => $uids]);
            jsonResponse(['ok' => true, 'message' => count($uids) . ' email(s) permanently deleted.', 'count' => count($uids)]);
        }
        if ($action === 'flags') {
            $add = hostingerMailNormalizeFlagList($input['addFlags'] ?? []);
            $remove = hostingerMailNormalizeFlagList($input['removeFlags'] ?? []);
            if (!$add && !$remove) jsonResponse(['ok' => false, 'error' => 'Choose an email action.'], 422);
            $payload = ['uids' => $uids]; if ($add) $payload['addFlags'] = $add; if ($remove) $payload['removeFlags'] = $remove;
            $response = hostingerMailResponseData(hostingerMailStoredRequest($pdo, 'POST', hostingerMailFolderPath($resourceId, $folder, '/messages/flags'), $payload));
            $failed = is_array($response['failed'] ?? null) ? count($response['failed']) : 0;
            jsonResponse(['ok' => true, 'message' => $failed ? "Updated with {$failed} failure(s)." : 'Emails updated.', 'failed' => $failed]);
        }
        jsonResponse(['ok' => false, 'error' => 'That email action is not supported.'], 422);
    }
    if (preg_match('#^/portal/mailboxes/([^/]+)/folders/([^/]+)/messages$#', $apiPath, $m) && $method === 'DELETE') {
        $resourceId = rawurldecode($m[1]); $folder = rawurldecode($m[2]);
        hostingerMailRequireClientMailbox($pdo, $clientId, $resourceId);
        if (($input['confirmed'] ?? false) !== true) jsonResponse(['ok' => false, 'error' => 'Confirm emptying this folder before continuing.'], 422);
        $folders = hostingerMailFolderRows($pdo, $resourceId);
        $trash = hostingerMailFindFolder($folders, '\\Trash', '/trash|deleted/i');
        $junk = hostingerMailFindFolder($folders, '\\Junk', '/spam|junk/i');
        if (!in_array($folder, array_filter([(string)($trash['path'] ?? ''), (string)($junk['path'] ?? '')]), true)) jsonResponse(['ok' => false, 'error' => 'Only Trash and Spam can be emptied.'], 422);
        hostingerMailStoredRequest($pdo, 'DELETE', hostingerMailFolderPath($resourceId, $folder, '/messages'));
        jsonResponse(['ok' => true, 'message' => 'Folder emptied.']);
    }
    if (preg_match('#^/portal/mailboxes/([^/]+)/folders/([^/]+)/messages/search$#', $apiPath, $m) && $method === 'POST') {
        $resourceId = rawurldecode($m[1]); $folder = rawurldecode($m[2]);
        hostingerMailRequireClientMailbox($pdo, $clientId, $resourceId);
        $text = trim((string)($input['text'] ?? ''));
        if ($text === '' || strlen($text) > 1024) jsonResponse(['ok' => false, 'error' => 'Enter a search term up to 1,024 characters.'], 422);
        $page = hostingerMailPageParam('page', 1, 100000); $perPage = hostingerMailPageParam('perPage', 25, 100);
        $sort = (string)($_GET['sort'] ?? '-uid'); if (!preg_match('/^-?(uid|date|size)$/', $sort)) $sort = '-uid';
        $path = hostingerMailFolderPath($resourceId, $folder, '/messages/search?' . hostingerMailQuery(['page' => $page, 'perPage' => $perPage, 'sort' => $sort]));
        $data = hostingerMailResponseCollection(hostingerMailStoredRequest($pdo, 'POST', $path, ['text' => $text]));
        jsonResponse(['ok' => true, 'messages' => is_array($data['data'] ?? null) ? $data['data'] : [], 'pagination' => $data['pagination'] ?? null]);
    }
    if (preg_match('#^/portal/mailboxes/([^/]+)/folders/([^/]+)/messages$#', $apiPath, $m) && $method === 'GET') {
        $resourceId = rawurldecode($m[1]); $folder = rawurldecode($m[2]);
        hostingerMailRequireClientMailbox($pdo, $clientId, $resourceId);
        $page = hostingerMailPageParam('page', 1, 100000); $perPage = hostingerMailPageParam('perPage', 25, 100);
        $sort = (string)($_GET['sort'] ?? '-uid'); if (!preg_match('/^-?(uid|date|size)$/', $sort)) $sort = '-uid';
        $path = hostingerMailFolderPath($resourceId, $folder, '/messages?' . hostingerMailQuery(['page' => $page, 'perPage' => $perPage, 'sort' => $sort]));
        $data = hostingerMailResponseCollection(hostingerMailStoredRequest($pdo, 'GET', $path));
        $rows = is_array($data['data'] ?? null) ? array_values(array_filter($data['data'], 'is_array')) : [];
        $filtered = hostingerMailFilterBlockedInbox($pdo, $clientId, $resourceId, $folder, $rows);
        $pagination = $data['pagination'] ?? null;
        if ($filtered['moved'] > 0 && is_array($pagination)) $pagination['total'] = max(0, (int)($pagination['total'] ?? 0) - $filtered['moved']);
        jsonResponse(['ok' => true, 'messages' => $filtered['messages'], 'pagination' => $pagination, 'blockedMoved' => $filtered['moved']]);
    }
    if (preg_match('#^/portal/mailboxes/([^/]+)/folders/([^/]+)/messages/([^/]+)/attachments/([^/]+)$#', $apiPath, $m) && $method === 'GET') {
        return hostingerMailMongoAttachment($pdo, rawurldecode($m[1]), rawurldecode($m[2]), $m[3], rawurldecode($m[4]), $clientId);
    }
    if (preg_match('#^/portal/mailboxes/([^/]+)/folders/([^/]+)/messages/([^/]+)/move$#', $apiPath, $m) && $method === 'POST') {
        $resourceId = rawurldecode($m[1]); $folder = rawurldecode($m[2]); $uid = filter_var($m[3], FILTER_VALIDATE_INT);
        hostingerMailRequireClientMailbox($pdo, $clientId, $resourceId);
        if ($uid === false || $uid < 1) jsonResponse(['ok' => false, 'error' => 'That email could not be found.'], 404);
        $target = trim((string)($input['targetFolder'] ?? ''));
        if ($target === '' || strlen($target) > 100) jsonResponse(['ok' => false, 'error' => 'Choose a valid destination folder.'], 422);
        hostingerMailRequireKnownFolder(hostingerMailFolderRows($pdo, $resourceId), $target);
        hostingerMailStoredRequest($pdo, 'POST', hostingerMailFolderPath($resourceId, $folder, '/messages/' . (int)$uid . '/move'), ['targetFolder' => $target]);
        jsonResponse(['ok' => true, 'message' => 'Email moved.']);
    }
    if (preg_match('#^/portal/mailboxes/([^/]+)/folders/([^/]+)/messages/([^/]+)$#', $apiPath, $m)) {
        return hostingerMailMongoMessageRoute($pdo, rawurldecode($m[1]), rawurldecode($m[2]), $m[3], $method, $input, $clientId);
    }
    if (preg_match('#^/portal/mailboxes/([^/]+)/send$#', $apiPath, $m) && $method === 'POST') {
        return hostingerMailMongoSend($pdo, rawurldecode($m[1]), $input, $clientId);
    }
    return false;
}

function hostingerMailMongoDraftRoute(?PDO $pdo, string $resourceId, ?string $draftId, string $method, array $input, string $clientId): bool {
    hostingerMailRequireClientMailbox($pdo, $clientId, $resourceId);
    if (!$draftId && $method === 'GET') jsonResponse(['ok' => true, 'drafts' => hostingerMailDrafts($pdo, $clientId, $resourceId)]);
    if (!$draftId && $method === 'POST') {
        $payload = hostingerMailNormalizeCompose($input, false);
        $draftId = trim((string)($input['id'] ?? ''));
        if ($draftId !== '' && !preg_match('/^[A-Za-z0-9_-]{1,191}$/', $draftId)) jsonResponse(['ok' => false, 'error' => 'Draft could not be saved.'], 422);
        $existing = $draftId === '' ? null : hostingerMailMongoFindOne('client_mail_drafts', ['id' => $draftId, 'client_id' => $clientId, 'provider_mailbox_id' => $resourceId]);
        if ($draftId !== '' && !$existing) jsonResponse(['ok' => false, 'error' => 'Draft not found.'], 404);
        if ($draftId === '') $draftId = 'md_' . bin2hex(random_bytes(12));
        $now = hostingerMailNow();
        $json = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($json === false) jsonResponse(['ok' => false, 'error' => 'Draft could not be saved.'], 422);
        if ($existing) {
            $updated = getMongoCollection(mongoCollectionName('client_mail_drafts'))->updateOne(
                ['id' => $draftId, 'client_id' => $clientId, 'provider_mailbox_id' => $resourceId],
                ['$set' => ['draft_json' => $json, 'updated_at' => $now]],
            );
            if ($updated->getMatchedCount() !== 1) jsonResponse(['ok' => false, 'error' => 'Draft not found.'], 404);
        } else {
            hostingerMailMongoInsert('client_mail_drafts', ['id' => $draftId, 'client_id' => $clientId,
                'provider_mailbox_id' => $resourceId, 'draft_json' => $json, 'created_at' => $now, 'updated_at' => $now]);
        }
        jsonResponse(['ok' => true, 'draft' => array_merge($payload, ['id' => $draftId, 'updatedAt' => $now])], $existing ? 200 : 201);
    }
    if ($draftId && preg_match('/^[A-Za-z0-9_-]{1,191}$/', $draftId)) {
        $filter = ['id' => $draftId, 'client_id' => $clientId, 'provider_mailbox_id' => $resourceId];
        if ($method === 'GET') {
            $row = hostingerMailMongoFindOne('client_mail_drafts', $filter);
            if (!$row) jsonResponse(['ok' => false, 'error' => 'Draft not found.'], 404);
            $draft = json_decode((string)$row['draft_json'], true);
            if (!is_array($draft)) $draft = [];
            jsonResponse(['ok' => true, 'draft' => array_merge($draft, ['id' => $draftId, 'updatedAt' => (string)$row['updated_at']])]);
        }
        if ($method === 'DELETE') {
            $deleted = getMongoCollection(mongoCollectionName('client_mail_drafts'))->deleteOne($filter);
            if ($deleted->getDeletedCount() === 0) jsonResponse(['ok' => false, 'error' => 'Draft not found.'], 404);
            jsonResponse(['ok' => true, 'message' => 'Draft removed.']);
        }
    }
    jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

function hostingerMailMongoBlockedSenderRoute(?PDO $pdo, string $resourceId, string $method, array $input, string $clientId): bool {
    hostingerMailRequireClientMailbox($pdo, $clientId, $resourceId);
    if ($method === 'GET') jsonResponse(['ok' => true, 'blockedSenders' => hostingerMailBlockedSenders($pdo, $clientId, $resourceId)]);
    if ($method === 'POST') {
        $address = hostingerMailNormalizeSenderAddress($input['address'] ?? null);
        foreach (hostingerMailMongoFindMany('client_mailboxes', ['client_id' => $clientId]) as $mailbox) {
            if (strtolower((string)($mailbox['email_address'] ?? '')) === $address) jsonResponse(['ok' => false, 'error' => 'You cannot block one of your own mailboxes.'], 422);
        }
        $filter = ['client_id' => $clientId, 'provider_mailbox_id' => $resourceId, 'address' => $address];
        $existing = hostingerMailMongoFindOne('client_mail_blocked_senders', $filter);
        if (!$existing) {
            if (count(hostingerMailMongoFindMany('client_mail_blocked_senders', ['client_id' => $clientId, 'provider_mailbox_id' => $resourceId])) >= 500) jsonResponse(['ok' => false, 'error' => 'The blocked sender list is full. Unblock a sender first.'], 422);
            // This write precedes provider moves in SQL mode. Require transaction support first,
            // so an unsupported Mongo deployment never performs a provider action then fails persistence.
            hostingerMailMongoTransaction(static fn($session) => null);
            hostingerMailMongoInsert('client_mail_blocked_senders', ['id' => 'mbs_' . bin2hex(random_bytes(10)),
                'client_id' => $clientId, 'provider_mailbox_id' => $resourceId, 'address' => $address, 'created_at' => hostingerMailNow()]);
        }
        $moved = 0;
        $folders = hostingerMailFolderRows($pdo, $resourceId);
        $inbox = hostingerMailFindFolder($folders, '\\Inbox', '/^inbox$/i');
        $junk = hostingerMailFindFolder($folders, '\\Junk', '/spam|junk/i');
        if ($inbox && $junk) {
            $query = hostingerMailQuery(['page' => 1, 'perPage' => 100]);
            $search = hostingerMailStoredRequest($pdo, 'POST', hostingerMailFolderPath($resourceId, (string)$inbox['path'], '/messages/search?' . $query), ['from' => $address]);
            $uids = [];
            $searchRows = hostingerMailResponseCollection($search);
            foreach (($searchRows['data'] ?? []) as $message) {
                if (is_array($message) && strtolower((string)($message['from']['address'] ?? '')) === $address && (int)($message['uid'] ?? 0) > 0) $uids[] = (int)$message['uid'];
            }
            if ($uids) {
                hostingerMailStoredRequest($pdo, 'POST', hostingerMailFolderPath($resourceId, (string)$inbox['path'], '/messages/move'),
                    ['uids' => $uids, 'targetFolder' => (string)$junk['path']]);
                $moved = count($uids);
            }
        }
        jsonResponse(['ok' => true, 'message' => $moved ? "Sender blocked. {$moved} message(s) moved to Spam." : 'Sender blocked. Future messages will be moved to Spam.',
            'moved' => $moved, 'blockedSenders' => hostingerMailBlockedSenders($pdo, $clientId, $resourceId)]);
    }
    if ($method === 'DELETE') {
        $address = hostingerMailNormalizeSenderAddress($input['address'] ?? null);
        hostingerMailMongoDelete('client_mail_blocked_senders', ['client_id' => $clientId, 'provider_mailbox_id' => $resourceId, 'address' => $address]);
        jsonResponse(['ok' => true, 'message' => 'Sender unblocked.', 'blockedSenders' => hostingerMailBlockedSenders($pdo, $clientId, $resourceId)]);
    }
    jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

function hostingerMailMongoMessageRoute(?PDO $pdo, string $resourceId, string $folder, string $uidValue, string $method, array $input, string $clientId): bool {
    hostingerMailRequireClientMailbox($pdo, $clientId, $resourceId);
    $uid = filter_var($uidValue, FILTER_VALIDATE_INT);
    if ($uid === false || $uid < 1) jsonResponse(['ok' => false, 'error' => 'That email could not be found.'], 404);
    $basePath = hostingerMailFolderPath($resourceId, $folder, '/messages/' . (int)$uid);
    if ($method === 'GET') {
        $message = hostingerMailResponseData(hostingerMailStoredRequest($pdo, 'GET', $basePath));
        $body = hostingerMailResponseData(hostingerMailStoredRequest($pdo, 'GET', $basePath . '/text'));
        $message['unseen'] = false;
        $message['flags'] = array_values(array_unique(array_merge(
            array_filter($message['flags'] ?? [], static fn($flag) => $flag !== '\\Seen'),
            ['\\Seen'],
        )));
        jsonResponse(['ok' => true, 'message' => $message, 'body' => $body]);
    }
    if ($method === 'PATCH') {
        $allowed = ['\\Seen', '\\Flagged', '\\Answered'];
        $add = $input['addFlags'] ?? []; $remove = $input['removeFlags'] ?? [];
        if (!is_array($add) || !is_array($remove)) jsonResponse(['ok' => false, 'error' => 'Message flags are invalid.'], 422);
        $add = array_values(array_unique(array_map('strval', $add)));
        $remove = array_values(array_unique(array_map('strval', $remove)));
        foreach (array_merge($add, $remove) as $flag) if (!in_array($flag, $allowed, true)) jsonResponse(['ok' => false, 'error' => 'That email action is not supported.'], 422);
        if (!$add && !$remove) jsonResponse(['ok' => false, 'error' => 'Choose an email action.'], 422);
        hostingerMailStoredRequest($pdo, 'PATCH', $basePath, ['addFlags' => $add, 'removeFlags' => $remove]);
        jsonResponse(['ok' => true, 'message' => 'Email updated.']);
    }
    if ($method === 'DELETE') {
        if (($input['confirmed'] ?? false) !== true) jsonResponse(['ok' => false, 'error' => 'Confirm permanent deletion before continuing.'], 422);
        hostingerMailStoredRequest($pdo, 'DELETE', $basePath);
        jsonResponse(['ok' => true, 'message' => 'Email permanently deleted.']);
    }
    jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

function hostingerMailMongoAttachment(?PDO $pdo, string $resourceId, string $folder, string $uidValue, string $attachmentId, string $clientId): bool {
    hostingerMailRequireClientMailbox($pdo, $clientId, $resourceId);
    $uid = filter_var($uidValue, FILTER_VALIDATE_INT);
    if ($uid === false || $uid < 1 || $attachmentId === '') jsonResponse(['ok' => false, 'error' => 'Attachment not found.'], 404);
    $path = hostingerMailFolderPath($resourceId, $folder, '/messages/' . (int)$uid . '/attachments/' . hostingerMailSegment($attachmentId));
    $token = hostingerMailToken($pdo);
    $baseUrl = hostingerMailApiBaseUrl();
    $protocol = parse_url($baseUrl, PHP_URL_SCHEME) === 'https' ? CURLPROTO_HTTPS : CURLPROTO_HTTP;
    $handle = curl_init();
    if ($handle === false) jsonResponse(['ok' => false, 'error' => 'Unable to connect to the email service. Please try again.'], 502);
    curl_setopt_array($handle, [
        CURLOPT_URL => $baseUrl . $path, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Accept: application/octet-stream', 'Authorization: Bearer ' . $token],
        CURLOPT_CONNECTTIMEOUT => 7, CURLOPT_TIMEOUT => 25, CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROTOCOLS => $protocol, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    $body = curl_exec($handle);
    $curlError = curl_errno($handle);
    $status = (int)curl_getinfo($handle, CURLINFO_HTTP_CODE);
    curl_close($handle);
    if ($body === false || $curlError !== 0) {
        hostingerMailRecordStatus($pdo, 'connection_error', 'network_error');
        jsonResponse(['ok' => false, 'error' => 'Unable to connect to the email service. Please try again.'], 502);
    }
    if ($status < 200 || $status >= 300) {
        $decoded = json_decode((string)$body, true);
        $providerCode = is_array($decoded) ? (string)($decoded['code'] ?? '') : '';
        $error = new HostingerMailApiException($status, preg_replace('/[^A-Za-z0-9_.-]/', '', $providerCode) ?: '');
        if (in_array($status, [401, 403], true) || $status >= 500) hostingerMailRecordStatus($pdo, 'connection_error', $error->providerCode ?: 'connection_error');
        $safe = hostingerMailSafeProviderError($error, false);
        jsonResponse(['ok' => false, 'error' => $safe[0]], $safe[1]);
    }
    hostingerMailRecordStatus($pdo, 'connected');
    header('Cache-Control: private, no-store');
    header('Pragma: no-cache');
    header('X-Content-Type-Options: nosniff');
    header('Content-Type: application/octet-stream');
    header('Content-Disposition: attachment; filename="email-attachment"');
    echo $body;
    exit;
}

function hostingerMailMongoSend(?PDO $pdo, string $resourceId, array $input, string $clientId): bool {
    $assignment = hostingerMailRequireClientMailbox($pdo, $clientId, $resourceId);
    $payload = hostingerMailNormalizeCompose($input, true);
    $payload['displayName'] = (string)$assignment['display_name'];
    $path = '/api/v1/mailboxes/' . hostingerMailSegment($resourceId) . '/send';
    if (($input['sendIndividually'] ?? false) === true) {
        $recipients = $payload['to'] ?? [];
        if (!empty($payload['cc']) || !empty($payload['bcc']) || isset($payload['inReplyTo']) || isset($payload['forwardOf'])) jsonResponse(['ok' => false, 'error' => 'Individual sending uses the To field only, without Cc, Bcc, replies, or forwards.'], 422);
        if (count($recipients) < 1 || count($recipients) > 50) jsonResponse(['ok' => false, 'error' => 'Individual sending supports between 1 and 50 recipients.'], 422);
        $sent = 0; $failed = [];
        foreach ($recipients as $recipient) {
            try {
                hostingerMailStoredRequest($pdo, 'POST', $path, array_merge($payload, ['to' => [$recipient]]));
                $sent++;
            } catch (HostingerMailApiException $error) {
                $failed[] = $recipient;
                if (in_array($error->providerStatus, [0, 401, 403, 429], true)) {
                    $failed = array_merge($failed, array_slice($recipients, $sent + count($failed)));
                    break;
                }
            }
        }
        if ($sent > 0) hostingerMailRecordActivity($pdo, $clientId, $resourceId, 'sent', $sent);
        if ($sent === 0) jsonResponse(['ok' => false, 'error' => 'None of the individual emails could be sent. Please try again.', 'failed' => $failed], 502);
        jsonResponse(['ok' => true, 'sent' => true, 'sentCount' => $sent, 'failed' => array_values(array_unique($failed)),
            'message' => $failed ? "Sent {$sent} email(s); " . count(array_unique($failed)) . ' could not be sent.' : "Sent {$sent} individual email(s)."]);
    }
    hostingerMailStoredRequest($pdo, 'POST', $path, $payload);
    hostingerMailRecordActivity($pdo, $clientId, $resourceId, 'sent');
    jsonResponse(['ok' => true, 'sent' => true, 'message' => 'Email sent.']);
}

function hostingerMailDispatch(?PDO $pdo, string $apiPath, string $method, array $input, ?array $adminSession, ?array $portalSession): bool {
    try {
        if (isMongoStorageEnabled()) {
            return hostingerMailMongoDispatch($pdo, $apiPath, $method, $input, $adminSession, $portalSession);
        }
        return hostingerMailHandleRequest($pdo, $apiPath, $method, $input, $adminSession, $portalSession);
    } catch (HostingerMailApiException $error) {
        $safe = hostingerMailSafeProviderError($error, str_starts_with($apiPath, '/admin/'));
        jsonResponse(['ok' => false, 'error' => $safe[0]], $safe[1]);
    } catch (Throwable $error) {
        error_log('[hostinger-mail] Request failed (' . get_class($error) . ').');
        jsonResponse(['ok' => false, 'error' => 'The email service could not complete this request. Please try again.'], 500);
    }
    return false;
}