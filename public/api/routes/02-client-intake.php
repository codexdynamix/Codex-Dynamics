<?php
/** Route group: CLIENT INTAKE (Contact forms, booking modals, newsletter) (included by index.php in order; uses its request globals). */

declare(strict_types=1);

// -----------------------------------------------------------------------------
// 2. CLIENT INTAKE (Contact forms, booking modals, newsletter)
// -----------------------------------------------------------------------------
if (!function_exists('mongoIntakeJsonArray')) {
function mongoIntakeJsonArray(mixed $value, array $fallback = []): array {
    if (is_array($value)) return $value;
    if (!is_string($value) || $value === '') return $fallback;
    $decoded = json_decode($value, true);
    return is_array($decoded) ? $decoded : $fallback;
}
}

if (!function_exists('mongoIntakeAdmin')) {
function mongoIntakeAdmin(?array $session, ?string $capability = null): array {
    if (!$session || empty($session['id'])) {
        jsonResponse(['ok' => false, 'error' => 'Authentication required.'], 401);
    }
    $staff = mongoFindOne('staff_users', ['id' => (string)$session['id'], 'deleted_at' => null]);
    if (!$staff || ($staff['status'] ?? '') !== 'Active') {
        jsonResponse(['ok' => false, 'error' => 'Administrator account is unavailable.'], 401);
    }
    $staff['capabilities'] = mongoIntakeJsonArray($staff['capabilities'] ?? null);
    if ($capability !== null && ($staff['role'] ?? '') !== 'Super Admin'
        && ($staff['capabilities'][$capability] ?? true) === false) {
        jsonResponse(['ok' => false, 'error' => 'This CRM tool is not enabled for your account.'], 403);
    }
    return $staff;
}
}

if (!function_exists('mongoIntakeCanView')) {
function mongoIntakeCanView(array $actor, array $client): bool {
    $role = (string)($actor['role'] ?? '');
    if ($role === 'Super Admin') return true;
    if ($role === 'Office Manager') {
        return !empty($actor['office_id']) && ($client['assigned_office_id'] ?? null) === $actor['office_id'];
    }
    if ($role === 'Team Leader') {
        return (!empty($actor['team_id']) && ($client['assigned_team_id'] ?? null) === $actor['team_id'])
            || ($client['assigned_team_leader_id'] ?? null) === ($actor['id'] ?? null);
    }
    return $role === 'Agent' && ($client['assigned_agent_id'] ?? null) === ($actor['id'] ?? null);
}
}

if (!function_exists('mongoIntakeScopeFilter')) {
function mongoIntakeScopeFilter(array $actor): array {
    $role = (string)($actor['role'] ?? '');
    if ($role === 'Super Admin') return [];
    if ($role === 'Office Manager') return ['assigned_office_id' => $actor['office_id'] ?? '__no_office__'];
    if ($role === 'Agent') return ['assigned_agent_id' => $actor['id'] ?? null];
    if ($role === 'Team Leader') {
        return !empty($actor['team_id'])
            ? ['$or' => [['assigned_team_id' => $actor['team_id']], ['assigned_team_leader_id' => $actor['id'] ?? null]]]
            : ['assigned_team_leader_id' => $actor['id'] ?? null];
    }
    return ['id' => '__inaccessible_client__'];
}
}

if (!function_exists('mongoIntakeClientResponse')) {
function mongoIntakeClientResponse(array $client): array {
    $client['assigned_agent_name'] = null;
    if (!empty($client['assigned_agent_id'])) {
        $agent = mongoFindOne('staff_users', ['id' => (string)$client['assigned_agent_id']]);
        $client['assigned_agent_name'] = $agent['name'] ?? null;
    }
    $access = mongoFindOne('client_portal_access', ['client_id' => (string)($client['id'] ?? '')]);
    $client['portal_enabled'] = !empty($access['portal_enabled']) ? 1 : 0;
    $client['portal_status'] = $access['status'] ?? null;
    unset($client['_id']);
    return normalizeClientRow($client);
}
}

if (!function_exists('mongoIntakeSiteRecord')) {
function mongoIntakeSiteRecord(array $record, string $type, bool $showcaseProject): array {
    $now = date('c');
    if ($type === 'project') {
        $showcase = $record['showcase'] ?? $record['showcase_json'] ?? null;
        if (is_string($showcase)) $showcase = json_decode($showcase, true);
        $document = [
            'title' => trim((string)($record['title'] ?? '')),
            'site_name' => trim((string)($record['site_name'] ?? $record['client'] ?? '')),
            'site_url' => trim((string)($record['site_url'] ?? '')),
            'description' => trim((string)($record['description'] ?? $record['detailedDescription'] ?? $record['shortDescription'] ?? '')),
            'category' => trim((string)($record['category'] ?? 'Websites & Web Apps')),
            'image_url' => trim((string)($record['image_url'] ?? $record['image'] ?? '')),
            'is_published' => array_key_exists('is_published', $record) ? !empty($record['is_published']) : (($record['published'] ?? true) !== false),
        ];
        if ($showcaseProject || array_key_exists('showcase_json', $record) || array_key_exists('showcase', $record)) {
            $document['showcase_json'] = is_array($showcase) && $showcase
                ? json_encode($showcase, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
                : null;
        }
    } elseif ($type === 'blog') {
        $title = trim((string)($record['title'] ?? ''));
        if ($title === '') jsonResponse(['ok' => false, 'error' => 'Blog title is required.'], 422);
        $slug = trim((string)($record['slug'] ?? ''));
        if ($slug === '') $slug = strtolower(trim((string)preg_replace('/[^a-zA-Z0-9]+/', '-', $title), '-'));
        $slug = substr($slug, 0, 180);
        $content = (string)($record['content'] ?? '');
        $excerpt = (string)($record['excerpt'] ?? substr(strip_tags($content), 0, 160));
        $document = [
            'title' => $title, 'slug' => $slug, 'content' => $content, 'excerpt' => $excerpt,
            'category' => trim((string)($record['category'] ?? 'Engineering')),
            'author' => trim((string)($record['author'] ?? 'Codex Team')),
            'status' => in_array(($record['status'] ?? 'draft'), ['draft', 'published'], true) ? $record['status'] : 'draft',
            'featured_image' => trim((string)($record['featured_image'] ?? $record['image_url'] ?? '')),
            'meta_description' => trim((string)($record['meta_description'] ?? $excerpt)),
            'reading_time' => max(1, (int)round(str_word_count(strip_tags($content)) / 200)),
            'updated_at' => $now,
        ];
        $id = filter_var($record['id'] ?? null, FILTER_VALIDATE_INT);
        foreach (mongoFindMany('blogs', ['deleted_at' => null]) as $other) {
            if ((string)($other['slug'] ?? '') === $slug && (int)($other['id'] ?? 0) !== (int)$id) {
                jsonResponse(['ok' => false, 'error' => 'That blog URL is already in use.'], 422);
            }
        }
    } elseif ($type === 'review') {
        $author = trim((string)($record['author'] ?? ''));
        if ($author === '') jsonResponse(['ok' => false, 'error' => 'Review author is required.'], 422);
        $document = [
            'author' => $author, 'rating' => max(1, min(5, (int)($record['rating'] ?? 5))),
            'comment' => trim((string)($record['comment'] ?? '')), 'is_published' => !empty($record['is_published']),
        ];
    } else {
        $name = trim((string)($record['name'] ?? ''));
        $url = trim((string)($record['url'] ?? ''));
        if ($name === '' || !filter_var($url, FILTER_VALIDATE_URL)) {
            jsonResponse(['ok' => false, 'error' => 'Enter a referring site name and a valid URL.'], 422);
        }
        $document = ['name' => $name, 'url' => $url, 'notes' => trim((string)($record['notes'] ?? ''))];
    }
    if ($showcaseProject && $type === 'project') {
        $document['showcase_json'] = json_encode($record, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
    return $document + ['updated_at' => $now];
}
}

if (!function_exists('mongoIntakeNextContentId')) {
function mongoIntakeNextContentId(string $table): int {
    $counterId = 'legacy_' . $table;
    $counterCollection = getMongoCollection('application_counters');
    if ($counterCollection->findOne(['_id' => $counterId]) === null) {
        $maximum = 0;
        foreach (mongoFindMany($table) as $row) {
            $id = $row['id'] ?? null;
            if ((is_int($id) || (is_string($id) && ctype_digit($id))) && (int)$id > $maximum) $maximum = (int)$id;
        }
        try {
            $counterCollection->updateOne(
                ['_id' => $counterId], ['$max' => ['sequence' => $maximum]], ['upsert' => true],
            );
        } catch (Throwable $error) {
            if (!str_contains(strtolower($error->getMessage()), 'duplicate')) throw $error;
        }
    }
    $counter = $counterCollection->findOneAndUpdate(
        ['_id' => $counterId],
        ['$inc' => ['sequence' => 1]],
        ['returnDocument' => \MongoDB\Operation\FindOneAndUpdate::RETURN_DOCUMENT_AFTER],
    );
    $counterRow = mongoDocumentToArray($counter);
    if (!is_array($counterRow) || !isset($counterRow['sequence'])) {
        throw new RuntimeException('Could not allocate a content ID.');
    }
    return (int)$counterRow['sequence'];
}
}

if (isMongoStorageEnabled()) {
    if ($apiPath === '/newsletter/subscribers') {
        if ($method !== 'POST') {
            jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
        }

        $email = strtolower(trim((string)($input['email'] ?? '')));
        $source = trim((string)($input['source'] ?? 'newsletter_signup'));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            jsonResponse(['ok' => false, 'error' => 'Enter a valid email address.'], 422);
        }

        $alreadySubscribed = false;
        try {
            $alreadySubscribed = mongoFindOne('newsletter_subscribers', ['email' => $email]) !== null;
            if (!$alreadySubscribed) {
                $id = 'sub_' . bin2hex(random_bytes(12));
                mongoInsert('newsletter_subscribers', [
                    'id' => $id,
                    'email' => $email,
                    'source' => substr($source !== '' ? $source : 'newsletter_signup', 0, 128),
                    'subscribed_at' => date('c'),
                ]);
            }
        } catch (Throwable $error) {
            // Preserve the SQL path's concurrent duplicate-subscription response.
            try {
                $alreadySubscribed = mongoFindOne('newsletter_subscribers', ['email' => $email]) !== null;
            } catch (Throwable) {
                // Report the original storage failure below.
            }
            if (!$alreadySubscribed) {
                error_log('MongoDB newsletter intake failed: ' . $error->getMessage());
                jsonResponse(['ok' => false, 'error' => 'Newsletter storage is unavailable.'], 503);
            }
        }
        if ($alreadySubscribed) {
            jsonResponse(['ok' => true, 'alreadySubscribed' => true]);
        }

        jsonResponse(['ok' => true, 'alreadySubscribed' => false], 201);
    }

    if ($apiPath === '/crm/clients') {
        if ($method !== 'POST') {
            jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
        }

        $id = 'ld_' . time() . '_' . substr(bin2hex(random_bytes(3)), 0, 4);
        $firstName = trim($input['firstName'] ?? $input['first_name'] ?? '');
        $lastName = trim($input['lastName'] ?? $input['last_name'] ?? '');
        $name = trim($input['name'] ?? "{$firstName} {$lastName}");
        $email = trim(strtolower($input['email'] ?? ''));
        $phone = trim($input['phone'] ?? '');
        $company = trim($input['company'] ?? '');
        $service = trim($input['service'] ?? 'General Inquiry');
        $budget = trim($input['budget'] ?? '');
        $timeline = trim($input['timeline'] ?? '');
        $message = trim($input['message'] ?? '');
        $source = trim($input['source'] ?? 'website_contact_modal');
        $now = date('c');
        $auditId = 'aud_' . time() . '_' . substr(bin2hex(random_bytes(3)), 0, 4);

        try {
            mongoInsert('clients', [
                'id' => $id,
                'first_name' => $firstName,
                'last_name' => $lastName,
                'name' => $name,
                'email' => $email,
                'phone' => $phone,
                'company' => $company,
                'service' => $service,
                'budget' => $budget,
                'timeline' => $timeline,
                'message' => $message,
                'source' => $source,
                'stage' => 'New',
                'status' => 'New',
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            mongoInsert('audit_logs', [
                'id' => $auditId,
                'user_id' => $id,
                'client_name' => $name,
                'action' => 'CLIENT_INQUIRY',
                'details' => "Inquiry submitted: {$service}",
                'ip_address' => $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1',
                'created_at' => $now,
            ]);
        } catch (Throwable $error) {
            error_log('MongoDB client intake failed: ' . $error->getMessage());
            jsonResponse(['ok' => false, 'error' => 'Client intake storage is unavailable.'], 503);
        }

        jsonResponse(['ok' => true, 'id' => $id, 'message' => 'Thank you! Your inquiry has been received.']);
    }

    if ($apiPath === '/portal/signup-request' && $method === 'POST') {
        $name = trim((string)($input['name'] ?? ''));
        $email = strtolower(trim((string)($input['email'] ?? '')));
        if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            jsonResponse(['ok' => false, 'error' => 'Enter your name and a valid email address.'], 422);
        }
        $hasPortal = false;
        foreach (mongoFindMany('clients', mongoAuthEmailFilter($email, true)) as $client) {
            if (mongoFindOne('client_portal_access', ['client_id' => (string)($client['id'] ?? '')]) !== null) {
                $hasPortal = true;
                break;
            }
        }
        $pending = mongoFindOne('signup_requests', [
            '$expr' => ['$and' => [
                ['$eq' => [['$toLower' => '$email'], $email]],
                ['$eq' => ['$status', 'pending']],
            ]],
        ]);
        if (!$hasPortal && $pending === null) {
            $data = [
                'name' => $name, 'email' => $email,
                'phone' => trim((string)($input['phone'] ?? '')),
                'company' => trim((string)($input['company'] ?? '')),
                'country' => trim((string)($input['country'] ?? '')),
                'country_code' => trim((string)($input['country_code'] ?? $input['countryCode'] ?? '')),
                'message' => trim((string)($input['message'] ?? '')),
            ];
            try {
                mongoInsert('signup_requests', [
                    'id' => 'signup_' . bin2hex(random_bytes(12)), ...$data,
                    'request_data' => json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                    'status' => 'pending', 'created_at' => date('c'),
                ]);
            } catch (Throwable $error) {
                error_log('MongoDB portal signup request failed: ' . $error->getMessage());
                jsonResponse(['ok' => false, 'error' => 'Signup request storage is unavailable.'], 503);
            }
        }
        jsonResponse(['ok' => true, 'message' => 'If eligible, your request has been received for review.'], 202);
    }

    if ($apiPath === '/portal/password-reset-request' && $method === 'POST') {
        $email = strtolower(trim((string)($input['email'] ?? '')));
        if (filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $matches = [];
            foreach (mongoFindMany('clients', mongoAuthEmailFilter($email, true)) as $client) {
                $access = mongoFindOne('client_portal_access', ['client_id' => (string)($client['id'] ?? '')]);
                if ($access && ($access['status'] ?? '') === 'Active' && !empty($access['portal_enabled'])) {
                    $matches[] = $client;
                }
            }
            if (count($matches) === 1) {
                $userId = (string)$matches[0]['id'];
                $now = date('c');
                try {
                    mongoUpsert('password_reset_requests', ['user_id' => $userId], [
                        'user_id' => $userId, 'requested_at' => $now, 'status' => 'pending',
                        'code_hash' => null, 'expires_at' => null, 'sent_at' => null, 'attempt_count' => 0,
                    ]);
                } catch (Throwable $error) {
                    error_log('MongoDB password reset request failed: ' . $error->getMessage());
                    jsonResponse(['ok' => false, 'error' => 'Password reset storage is unavailable.'], 503);
                }
            }
        }
        jsonResponse(['ok' => true, 'message' => 'If an active account matches that email, a reset request has been recorded.'], 202);
    }

    if (($apiPath === '/portal/signup/complete' || $apiPath === '/portal/password-reset/complete') && $method === 'POST') {
        $isSignupCompletion = $apiPath === '/portal/signup/complete';
        $email = strtolower(trim((string)($input['email'] ?? '')));
        $code = trim((string)($input[$isSignupCompletion ? 'verification_code' : 'code']
            ?? ($isSignupCompletion ? ($input['code'] ?? '') : '')));
        $password = (string)($input['password'] ?? '');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 8 || strlen($password) > 4096) {
            jsonResponse(['ok' => false, 'error' => 'Enter a valid email address and a password of at least 8 characters.'], 422);
        }
        if ($isSignupCompletion) {
            $approved = mongoFindMany(
                'signup_requests',
                array_merge(mongoAuthEmailFilter($email), ['status' => 'approved']),
                ['sort' => ['reviewed_at' => -1]],
            );
            $signup = $approved[0] ?? null;
            if (!$signup || empty($signup['verification_code_hash'])
                || strtotime((string)($signup['verification_expires_at'] ?? '')) <= time()) {
                jsonResponse(['ok' => false, 'error' => 'The verification code is invalid or expired.'], 400);
            }
            if ((int)($signup['verification_attempts'] ?? 0) >= 5) {
                jsonResponse(['ok' => false, 'error' => 'Too many attempts. Request a new verification code.'], 429);
            }
            if (!password_verify($code, (string)$signup['verification_code_hash'])) {
                getMongoCollection(mongoCollectionName('signup_requests'))->updateOne(
                    ['id' => (string)$signup['id']], ['$inc' => ['verification_attempts' => 1]],
                );
                jsonResponse(['ok' => false, 'error' => 'The verification code is invalid or expired.'], 400);
            }
        } else {
            $eligible = [];
            foreach (mongoFindMany('clients', mongoAuthEmailFilter($email, true)) as $client) {
                $access = mongoFindOne('client_portal_access', ['client_id' => (string)($client['id'] ?? '')]);
                $reset = mongoFindOne('password_reset_requests', ['user_id' => (string)($client['id'] ?? '')]);
                if ($access && ($access['status'] ?? '') === 'Active' && !empty($access['portal_enabled'])
                    && $reset && ($reset['status'] ?? '') === 'sent') {
                    $eligible[] = ['client' => $client, 'reset' => $reset];
                }
            }
            $record = count($eligible) === 1 ? $eligible[0] : null;
            $reset = $record['reset'] ?? null;
            if (!$reset || empty($reset['code_hash']) || strtotime((string)($reset['expires_at'] ?? '')) <= time()) {
                jsonResponse(['ok' => false, 'error' => 'The reset code is invalid or expired.'], 400);
            }
            if ((int)($reset['attempt_count'] ?? 0) >= 5) {
                jsonResponse(['ok' => false, 'error' => 'Too many attempts. Request a new reset code.'], 429);
            }
            if (!password_verify($code, (string)$reset['code_hash'])) {
                getMongoCollection(mongoCollectionName('password_reset_requests'))->updateOne(
                    ['user_id' => (string)$record['client']['id']], ['$inc' => ['attempt_count' => 1]],
                );
                jsonResponse(['ok' => false, 'error' => 'The reset code is invalid or expired.'], 400);
            }
        }
        $hash = password_hash($password, PASSWORD_DEFAULT);
        if ($hash === false) jsonResponse(['ok' => false, 'error' => 'Could not securely save the password.'], 500);
        encryptClientSecret($password);
        jsonResponse(['ok' => false, 'error' => 'Credential completion requires an atomic client-and-request transaction and is not enabled in MongoDB mode.'], 501);
    }

    if ($apiPath === '/crm/settings' && $method === 'GET') {
        $row = mongoFindOne('platform_settings', ['id' => 'global']);
        $settings = mongoIntakeJsonArray($row['settings_json'] ?? null);
        $siteConfig = !empty($row['site_config_json'])
            ? mongoIntakeJsonArray($row['site_config_json'])
            : null;
        jsonResponse(['ok' => true, 'settings' => $settings, 'site_config' => publicSiteConfig($siteConfig)]);
    }

    if ($apiPath === '/admin/site-content') {
        mongoIntakeAdmin($adminSession, 'content');
        if ($method !== 'GET') jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
        $projects = mongoFindMany('projects', ['deleted_at' => null], ['sort' => ['id' => -1], 'limit' => 1000]);
        foreach ($projects as &$project) {
            $showcase = mongoIntakeJsonArray($project['showcase_json'] ?? null);
            if ($showcase) $project = array_merge($project, $showcase);
            $project['id'] = (int)($project['id'] ?? 0);
            $project['is_published'] = !empty($project['is_published']);
            $project['published'] = $project['is_published'];
            unset($project['showcase_json'], $project['_id']);
        }
        unset($project);
        $content = [];
        foreach (['blogs', 'reviews', 'backlinks'] as $table) {
            $content[$table] = mongoFindMany($table, ['deleted_at' => null], ['sort' => ['id' => -1], 'limit' => 1000]);
            foreach ($content[$table] as &$row) unset($row['_id']);
            unset($row);
        }
        jsonResponse(['ok' => true, 'projects' => $projects] + $content);
    }

    if ($apiPath === '/admin/site-content/action' && $method === 'POST') {
        mongoIntakeAdmin($adminSession, 'content');
        $action = (string)($input['action'] ?? '');
        $record = is_array($input['record'] ?? null) ? $input['record'] : $input;
        $actions = [
            'save_project' => ['projects', 'project', false, false],
            'update_project' => ['projects', 'project', false, false],
            'save_showcase_project' => ['projects', 'project', true, false],
            'delete_project' => ['projects', 'project', false, true],
            'save_blog' => ['blogs', 'blog', false, false],
            'update_blog' => ['blogs', 'blog', false, false],
            'delete_blog' => ['blogs', 'blog', false, true],
            'save_review' => ['reviews', 'review', false, false],
            'update_review' => ['reviews', 'review', false, false],
            'delete_review' => ['reviews', 'review', false, true],
            'add_backlink' => ['backlinks', 'backlink', false, false],
            'update_backlink' => ['backlinks', 'backlink', false, false],
            'delete_backlink' => ['backlinks', 'backlink', false, true],
        ];
        if (!isset($actions[$action])) jsonResponse(['ok' => false, 'error' => 'Unsupported site content action.'], 400);
        [$table, $type, $showcase, $delete] = $actions[$action];
        $id = filter_var($record['id'] ?? null, FILTER_VALIDATE_INT);
        if ($delete) {
            if (!$id || $id < 1) jsonResponse(['ok' => false, 'error' => 'A valid record ID is required.'], 422);
            $existing = mongoFindOne($table, ['id' => (int)$id, 'deleted_at' => null]);
            if (!$existing) jsonResponse(['ok' => false, 'error' => 'Record not found.'], 404);
            $result = getMongoCollection(mongoCollectionName($table))->updateOne(
                ['id' => (int)$id, 'deleted_at' => null], ['$set' => ['deleted_at' => date('c')]],
            );
            if ($result->getMatchedCount() !== 1) jsonResponse(['ok' => false, 'error' => 'Record not found.'], 404);
            jsonResponse(['ok' => true, 'archived' => true, 'id' => (int)$id]);
        }
        if ($id !== false && $id !== null && $id > 0 && !mongoFindOne($table, ['id' => (int)$id])) {
            $label = ucfirst($type);
            jsonResponse(['ok' => false, 'error' => $label . ' not found.'], 404);
        }
        $document = mongoIntakeSiteRecord($record, $type, $showcase);
        $recordId = $id && $id > 0 ? (int)$id : mongoIntakeNextContentId($table);
        if ($type === 'blog') {
            foreach (mongoFindMany('blogs', ['deleted_at' => null]) as $other) {
                if ((string)($other['slug'] ?? '') === (string)$document['slug'] && (int)($other['id'] ?? 0) !== $recordId) {
                    jsonResponse(['ok' => false, 'error' => 'That blog URL is already in use.'], 422);
                }
            }
        }
        if (!$id || $id < 1) {
            $document['id'] = $recordId;
            if ($type === 'project' || $type === 'review' || $type === 'backlink') $document['created_at'] = date('c');
            mongoInsert($table, $document);
        } else {
            $document['deleted_at'] = null;
            mongoUpsert($table, ['id' => $recordId], $document);
        }
        jsonResponse(['ok' => true, 'id' => $recordId], $id ? 200 : 201);
    }

    if ($apiPath === '/admin/site-content/import-local' && $method === 'POST') {
        mongoIntakeAdmin($adminSession, 'content');
        jsonResponse(['ok' => false, 'error' => 'Local content import requires an atomic multi-document transaction and is not enabled in MongoDB mode.'], 501);
    }

    $signupComplete = $apiPath === '/portal/signup/complete' && $method === 'POST';
    $resetComplete = $apiPath === '/portal/password-reset/complete' && $method === 'POST';
    $adminClientPath = $apiPath === '/admin/clients'
        || $apiPath === '/admin/clients/import'
        || $apiPath === '/admin/clients/search'
        || preg_match('#^/admin/clients/([^/]+)/restore$#', $apiPath) === 1
        || preg_match('#^/admin/clients/([^/]+)$#', $apiPath) === 1;
    if ($adminClientPath) {
        $restoreMatch = [];
        $resourceMatch = [];
        $isCollection = $apiPath === '/admin/clients';
        $isImport = $apiPath === '/admin/clients/import';
        $isSearch = $apiPath === '/admin/clients/search';
        $isRestore = preg_match('#^/admin/clients/([^/]+)/restore$#', $apiPath, $restoreMatch) === 1;
        $isResource = preg_match('#^/admin/clients/([^/]+)$#', $apiPath, $resourceMatch) === 1
            && !in_array($resourceMatch[1], ['import', 'search', 'assign-bulk', 'bulk-assign', 'bulk-status', 'bin'], true);
        if (!$isCollection && !$isImport && !$isSearch && !$isRestore && !$isResource) {
            // Other client subroutes are handled by their dedicated route groups.
        } else {
            $actor = mongoIntakeAdmin($adminSession);
            if (($isCollection && in_array($method, ['GET', 'POST'], true)) || ($isSearch && $method === 'GET')) {
                if ($method === 'POST') {
                    if (($actor['role'] ?? '') !== 'Super Admin' && ($actor['capabilities']['client_upload'] ?? true) === false) {
                        jsonResponse(['ok' => false, 'error' => 'Client creation is not enabled for your account.'], 403);
                    }
                    jsonResponse(['ok' => false, 'error' => 'Client creation requires an atomic client-and-portal transaction and is not enabled in MongoDB mode.'], 501);
                }
                if ($isSearch && trim((string)($_GET['q'] ?? '')) === '') jsonResponse(['ok' => true, 'clients' => []]);
                $rows = [];
                $includeDeleted = $_GET['include_deleted'] ?? '';
                $search = trim((string)($_GET['search'] ?? $_GET['q'] ?? ''));
                foreach (mongoFindMany('clients') as $client) {
                    if (!mongoIntakeCanView($actor, $client)) continue;
                    $deleted = !empty($client['deleted_at']);
                    if ($includeDeleted === 'only' && !$deleted) continue;
                    if ($includeDeleted !== '1' && $includeDeleted !== 'only' && $deleted) continue;
                    $filters = ['stage' => 'stage', 'office_id' => 'assigned_office_id', 'team_id' => 'assigned_team_id',
                        'team_leader_id' => 'assigned_team_leader_id', 'agent_id' => 'assigned_agent_id'];
                    $matches = true;
                    foreach ($filters as $queryKey => $field) {
                        if (isset($_GET[$queryKey]) && (string)$_GET[$queryKey] !== ''
                            && (string)($client[$field] ?? '') !== (string)$_GET[$queryKey]) $matches = false;
                    }
                    if (!$matches) continue;
                    $needle = $isSearch ? trim((string)($_GET['q'] ?? '')) : $search;
                    $fields = $isSearch ? ['name', 'email', 'phone', 'company'] : ['name', 'email', 'phone', 'company', 'service', 'message'];
                    if ($needle !== '') {
                        $found = false;
                        foreach ($fields as $field) {
                            if (stripos((string)($client[$field] ?? ''), $needle) !== false) { $found = true; break; }
                        }
                        if (!$found) continue;
                    }
                    $rows[] = mongoIntakeClientResponse($client);
                }
                usort($rows, static fn(array $a, array $b): int => strcmp((string)($b['created_at'] ?? ''), (string)($a['created_at'] ?? ''))
                    ?: strcmp((string)($b['id'] ?? ''), (string)($a['id'] ?? '')));
                if ($isSearch) {
                    $limit = max(1, min(100, (int)($_GET['limit'] ?? 8)));
                    jsonResponse(['ok' => true, 'clients' => array_slice($rows, 0, $limit)]);
                }
                $total = count($rows);
                $limit = max(1, min(10000, (int)($_GET['limit'] ?? 500)));
                $offset = max(0, (int)($_GET['offset'] ?? 0));
                $rows = array_slice($rows, $offset, $limit);
                jsonResponse(['ok' => true, 'clients' => $rows, 'total' => $total, 'limit' => $limit,
                    'offset' => $offset, 'has_more' => $offset + count($rows) < $total]);
            }
            if ($isImport && $method === 'POST') {
                if (($actor['role'] ?? '') !== 'Super Admin') jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can import clients.'], 403);
                jsonResponse(['ok' => false, 'error' => 'Bulk client import requires an atomic multi-document transaction and is not enabled in MongoDB mode.'], 501);
            }
            if ($isResource) {
                $clientId = rawurldecode($resourceMatch[1]);
                $client = mongoFindOne('clients', ['id' => $clientId]);
                if (!$client || !empty($client['deleted_at'])) jsonResponse(['ok' => false, 'error' => 'Client not found.'], 404);
                if (!mongoIntakeCanView($actor, $client)) jsonResponse(['ok' => false, 'error' => 'You cannot access this client record.'], 403);
                if ($method === 'GET') jsonResponse(['ok' => true, 'client' => mongoIntakeClientResponse($client)]);
                if ($method === 'PATCH') {
                    foreach (['assigned_office_id', 'assigned_team_id', 'assigned_team_leader_id', 'assigned_agent_id'] as $assignmentField) {
                        if (array_key_exists($assignmentField, $input)) {
                            jsonResponse(['ok' => false, 'error' => 'Client reassignment requires an atomic assignment-history transaction and is not enabled in MongoDB mode.'], 501);
                        }
                    }
                    $allowed = ['first_name', 'last_name', 'name', 'email', 'phone', 'country', 'country_code', 'stage',
                        'funnel', 'company', 'service', 'budget', 'timeline', 'message', 'source', 'notes',
                        'comment_history', 'status_history', 'appointments'];
                    $updates = [];
                    foreach ($allowed as $field) if (array_key_exists($field, $input)) $updates[$field] = $input[$field];
                    if (isset($updates['email']) && strtolower(trim((string)$updates['email'])) !== strtolower(trim((string)($client['email'] ?? '')))) {
                        jsonResponse(['ok' => false, 'error' => 'Email changes require the transactional MongoDB client-identifier workflow.'], 501);
                    }
                    if (isset($updates['phone']) && (string)$updates['phone'] !== (string)($client['phone'] ?? '')) {
                        jsonResponse(['ok' => false, 'error' => 'Phone changes require the transactional MongoDB client-identifier workflow.'], 501);
                    }
                    foreach (['first_name', 'last_name', 'name', 'country', 'country_code', 'stage', 'funnel', 'company', 'service',
                        'budget', 'timeline', 'message', 'source', 'notes'] as $field) {
                        if (isset($updates[$field])) $updates[$field] = trim((string)$updates[$field]);
                    }
                    if (isset($updates['first_name']) || isset($updates['last_name'])) {
                        $updates['name'] = trim((string)($updates['first_name'] ?? $client['first_name'] ?? '') . ' '
                            . (string)($updates['last_name'] ?? $client['last_name'] ?? ''));
                    }
                    foreach (['comment_history', 'status_history', 'appointments'] as $field) {
                        if (isset($updates[$field]) && !is_array($updates[$field])) {
                            $updates[$field] = mongoIntakeJsonArray($updates[$field]);
                        }
                    }
                    if (!$updates) jsonResponse(['ok' => false, 'error' => 'No supported client fields were provided.'], 400);
                    $oldStage = (string)($client['stage'] ?? '');
                    $newStage = (string)($updates['stage'] ?? $oldStage);
                    if ($newStage !== $oldStage) {
                        $history = mongoIntakeJsonArray($client['status_history'] ?? null);
                        $history[] = ['id' => 'st_' . bin2hex(random_bytes(5)), 'from_stage' => $oldStage, 'to_stage' => $newStage,
                            'by_admin_id' => (string)$actor['id'], 'by_name' => (string)($actor['name'] ?? ''),
                            'created_at' => date('c')];
                        $updates['status_history'] = $history;
                    }
                    $updates['updated_at'] = date('c');
                    $updatedResult = getMongoCollection(mongoCollectionName('clients'))->updateOne(
                        array_merge(['id' => $clientId, 'deleted_at' => null], mongoIntakeScopeFilter($actor)), ['$set' => $updates],
                    );
                    if ($updatedResult->getMatchedCount() !== 1) jsonResponse(['ok' => false, 'error' => 'Client not found.'], 404);
                    $updated = mongoFindOne('clients', ['id' => $clientId]);
                    jsonResponse(['ok' => true, 'client' => mongoIntakeClientResponse($updated ?? array_merge($client, $updates))]);
                }
                if ($method === 'DELETE') {
                    $filter = array_merge(['id' => $clientId], mongoIntakeScopeFilter($actor));
                    if (($_GET['permanent'] ?? '') === '1') {
                        if (($actor['role'] ?? '') !== 'Super Admin') jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can permanently delete clients.'], 403);
                        mongoDelete('clients', $filter);
                    } else {
                        getMongoCollection(mongoCollectionName('clients'))->updateOne($filter, ['$set' => ['deleted_at' => date('c'), 'updated_at' => date('c')]]);
                    }
                    jsonResponse(['ok' => true, 'id' => $clientId, 'deleted' => true]);
                }
            }
            if ($isRestore && $method === 'POST') {
                $id = rawurldecode($restoreMatch[1]);
                $client = mongoFindOne('clients', ['id' => $id, 'deleted_at' => ['$ne' => null]]);
                if (!$client) jsonResponse(['ok' => false, 'error' => 'Deleted client not found.'], 404);
                if (!mongoIntakeCanView($actor, $client)) jsonResponse(['ok' => false, 'error' => 'You cannot access this client record.'], 403);
                $restoreResult = getMongoCollection(mongoCollectionName('clients'))->updateOne(
                    array_merge(['id' => $id, 'deleted_at' => ['$ne' => null]], mongoIntakeScopeFilter($actor)),
                    ['$set' => ['deleted_at' => null, 'updated_at' => date('c')]],
                );
                if ($restoreResult->getMatchedCount() !== 1) jsonResponse(['ok' => false, 'error' => 'Deleted client not found.'], 404);
                $restored = mongoFindOne('clients', ['id' => $id]);
                $restored ??= $client;
                unset($restored['_id']);
                jsonResponse(['ok' => true, 'client' => normalizeClientRow($restored)]);
            }
            if ($isImport && $method !== 'POST') jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
            if ($isCollection || $isSearch || $isRestore || $isResource) jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
        }
    }

    if ($signupComplete || $resetComplete
        || $apiPath === '/admin/clients/import'
        || $apiPath === '/admin/site-content/import-local') {
        jsonResponse(['ok' => false, 'error' => 'This workflow requires an atomic MongoDB transaction and is not enabled in MongoDB mode.'], 501);
    }

    // Let dedicated route groups handle their own explicitly migrated client subroutes.
    $isDedicatedClientRoute = str_starts_with($apiPath, '/admin/clients/')
        && preg_match('#^/admin/clients/(?:assign-bulk|bulk-assign|bulk-status|bin)(?:/|$)#', $apiPath) === 1;
    if (!$isDedicatedClientRoute && (
        $apiPath === '/newsletter' || str_starts_with($apiPath, '/newsletter/')
        || $apiPath === '/crm/clients' || str_starts_with($apiPath, '/crm/clients/')
        || $apiPath === '/portal/signup' || str_starts_with($apiPath, '/portal/signup/')
        || $apiPath === '/portal/signup-request' || str_starts_with($apiPath, '/portal/signup-request/')
        || $apiPath === '/portal/password-reset' || str_starts_with($apiPath, '/portal/password-reset/')
        || $apiPath === '/portal/password-reset-request' || str_starts_with($apiPath, '/portal/password-reset-request/')
        || $apiPath === '/crm/settings' || $apiPath === '/admin/clients' || str_starts_with($apiPath, '/admin/clients/')
        || $apiPath === '/admin/site-content' || str_starts_with($apiPath, '/admin/site-content/')
    )) {
        jsonResponse(['ok' => false, 'error' => 'This MongoDB route is not available.'], 501);
    }
}

if ($apiPath === '/newsletter/subscribers' && $method === 'POST') {
    $email = strtolower(trim((string)($input['email'] ?? '')));
    $source = trim((string)($input['source'] ?? 'newsletter_signup'));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        jsonResponse(['ok' => false, 'error' => 'Enter a valid email address.'], 422);
    }

    $findSubscriber = $pdo->prepare('SELECT id FROM newsletter_subscribers WHERE email = ? LIMIT 1');
    $findSubscriber->execute([$email]);
    $existingId = $findSubscriber->fetchColumn();
    if ($existingId !== false) {
        jsonResponse(['ok' => true, 'alreadySubscribed' => true]);
    }

    $id = 'sub_' . bin2hex(random_bytes(12));
    $now = date('c');
    try {
        $pdo->prepare('INSERT INTO newsletter_subscribers (id, email, source, subscribed_at) VALUES (?, ?, ?, ?)')
            ->execute([$id, $email, substr($source !== '' ? $source : 'newsletter_signup', 0, 128), $now]);
    } catch (PDOException $error) {
        // A concurrent request may have inserted the same normalized address.
        $findSubscriber->execute([$email]);
        if ($findSubscriber->fetchColumn() === false) {
            throw $error;
        }
        jsonResponse(['ok' => true, 'alreadySubscribed' => true]);
    }

    jsonResponse(['ok' => true, 'alreadySubscribed' => false], 201);
}

if ($apiPath === '/crm/clients') {
    if ($method === 'POST') {
        $id = 'ld_' . time() . '_' . substr(bin2hex(random_bytes(3)), 0, 4);
        $firstName = trim($input['firstName'] ?? $input['first_name'] ?? '');
        $lastName = trim($input['lastName'] ?? $input['last_name'] ?? '');
        $name = trim($input['name'] ?? "{$firstName} {$lastName}");
        $email = trim(strtolower($input['email'] ?? ''));
        $phone = trim($input['phone'] ?? '');
        $company = trim($input['company'] ?? '');
        $service = trim($input['service'] ?? 'General Inquiry');
        $budget = trim($input['budget'] ?? '');
        $timeline = trim($input['timeline'] ?? '');
        $message = trim($input['message'] ?? '');
        $source = trim($input['source'] ?? 'website_contact_modal');
        $now = date('c');

        $stmt = $pdo->prepare("
            INSERT INTO clients (id, first_name, last_name, name, email, phone, company, service, budget, timeline, message, source, stage, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'New', 'New', ?, ?)
        ");
        $stmt->execute([$id, $firstName, $lastName, $name, $email, $phone, $company, $service, $budget, $timeline, $message, $source, $now, $now]);

        // Also record an audit log
        $auditId = 'aud_' . time() . '_' . substr(bin2hex(random_bytes(3)), 0, 4);
        $pdo->prepare("INSERT INTO audit_logs (id, user_id, client_name, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            ->execute([$auditId, $id, $name, 'CLIENT_INQUIRY', "Inquiry submitted: {$service}", $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1', $now]);

        jsonResponse(['ok' => true, 'id' => $id, 'message' => 'Thank you! Your inquiry has been received.']);
    }

    // This is a public intake endpoint, not a public CRM data export. Admin
    // reads use the authenticated /admin/clients routes below.
    jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

// Public intake for account registration and password resets. These endpoints
// deliberately return generic responses so they do not disclose account state.
if ($apiPath === '/portal/signup-request' && $method === 'POST') {
    $name = trim((string)($input['name'] ?? ''));
    $email = strtolower(trim((string)($input['email'] ?? '')));
    if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        jsonResponse(['ok' => false, 'error' => 'Enter your name and a valid email address.'], 422);
    }
    $existing = $pdo->prepare("SELECT c.id FROM clients c JOIN client_portal_access a ON a.client_id = c.id WHERE LOWER(TRIM(c.email)) = ?");
    $existing->execute([$email]);
    $pending = $pdo->prepare("SELECT id FROM signup_requests WHERE LOWER(email) = ? AND status = 'pending'");
    $pending->execute([$email]);
    if (!$existing->fetchColumn() && !$pending->fetchColumn()) {
        $requestId = 'signup_' . bin2hex(random_bytes(12));
        $data = [
            'name' => $name,
            'email' => $email,
            'phone' => trim((string)($input['phone'] ?? '')),
            'company' => trim((string)($input['company'] ?? '')),
            'country' => trim((string)($input['country'] ?? '')),
            'country_code' => trim((string)($input['country_code'] ?? $input['countryCode'] ?? '')),
            'message' => trim((string)($input['message'] ?? '')),
        ];
        $pdo->prepare('INSERT INTO signup_requests (id, name, email, request_data, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([$requestId, $name, $email, json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), 'pending', date('c')]);
    }
    jsonResponse(['ok' => true, 'message' => 'If eligible, your request has been received for review.'], 202);
}

if ($apiPath === '/portal/signup/complete' && $method === 'POST') {
    $email = strtolower(trim((string)($input['email'] ?? '')));
    $code = trim((string)($input['verification_code'] ?? $input['code'] ?? ''));
    $password = (string)($input['password'] ?? '');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 8 || strlen($password) > 4096) {
        jsonResponse(['ok' => false, 'error' => 'Enter a valid email address and a password of at least 8 characters.'], 422);
    }
    $request = $pdo->prepare("SELECT * FROM signup_requests WHERE LOWER(email) = ? AND status = 'approved' ORDER BY reviewed_at DESC");
    $request->execute([$email]);
    $signup = $request->fetch();
    if (!$signup || empty($signup['verification_code_hash']) || strtotime((string)$signup['verification_expires_at']) <= time()) {
        jsonResponse(['ok' => false, 'error' => 'The verification code is invalid or expired.'], 400);
    }
    if ((int)$signup['verification_attempts'] >= 5) {
        jsonResponse(['ok' => false, 'error' => 'Too many attempts. Request a new verification code.'], 429);
    }
    if (!password_verify($code, (string)$signup['verification_code_hash'])) {
        $pdo->prepare('UPDATE signup_requests SET verification_attempts = verification_attempts + 1 WHERE id = ?')->execute([$signup['id']]);
        jsonResponse(['ok' => false, 'error' => 'The verification code is invalid or expired.'], 400);
    }
    $passwordHash = password_hash($password, PASSWORD_DEFAULT);
    if ($passwordHash === false) jsonResponse(['ok' => false, 'error' => 'Could not securely save the password.'], 500);
    $encryptedPassword = encryptClientSecret($password);
    $pdo->beginTransaction();
    try {
        $pdo->prepare('UPDATE client_portal_access SET password_hash = ?, admin_view_password_enc = ?, portal_enabled = 1 WHERE client_id = ?')
            ->execute([$passwordHash, $encryptedPassword, $signup['client_id']]);
        $pdo->prepare('UPDATE signup_requests SET verification_code_hash = NULL, verification_expires_at = NULL WHERE id = ?')
            ->execute([$signup['id']]);
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
    jsonResponse(['ok' => true, 'message' => 'Your client account is ready. You can now sign in.']);
}

if ($apiPath === '/portal/password-reset-request' && $method === 'POST') {
    $email = strtolower(trim((string)($input['email'] ?? '')));
    if (filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $client = $pdo->prepare("SELECT c.id FROM clients c JOIN client_portal_access a ON a.client_id = c.id WHERE LOWER(TRIM(c.email)) = ? AND a.status = 'Active' AND a.portal_enabled = 1");
        $client->execute([$email]);
        $matchingAccounts = $client->fetchAll(PDO::FETCH_COLUMN);
        $userId = count($matchingAccounts) === 1 ? $matchingAccounts[0] : null;
        if ($userId) {
            $now = date('c');
            $exists = $pdo->prepare('SELECT user_id FROM password_reset_requests WHERE user_id = ?');
            $exists->execute([$userId]);
            if ($exists->fetchColumn()) {
                $pdo->prepare("UPDATE password_reset_requests SET requested_at = ?, status = 'pending', code_hash = NULL, expires_at = NULL, sent_at = NULL, attempt_count = 0 WHERE user_id = ?")
                    ->execute([$now, $userId]);
            } else {
                $pdo->prepare("INSERT INTO password_reset_requests (user_id, requested_at, status) VALUES (?, ?, 'pending')")
                    ->execute([$userId, $now]);
            }
        }
    }
    jsonResponse(['ok' => true, 'message' => 'If an active account matches that email, a reset request has been recorded.'], 202);
}

if ($apiPath === '/portal/password-reset/complete' && $method === 'POST') {
    $email = strtolower(trim((string)($input['email'] ?? '')));
    $code = trim((string)($input['code'] ?? ''));
    $password = (string)($input['password'] ?? '');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 8 || strlen($password) > 4096) {
        jsonResponse(['ok' => false, 'error' => 'Enter a valid email address and a password of at least 8 characters.'], 422);
    }
    $stmt = $pdo->prepare("SELECT c.id, r.code_hash, r.expires_at, r.attempt_count FROM clients c
        JOIN client_portal_access a ON a.client_id = c.id
        JOIN password_reset_requests r ON r.user_id = c.id
        WHERE LOWER(TRIM(c.email)) = ? AND r.status = 'sent' AND a.status = 'Active' AND a.portal_enabled = 1");
    $stmt->execute([$email]);
    $resetRows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $reset = count($resetRows) === 1 ? $resetRows[0] : null;
    if (!$reset || empty($reset['code_hash']) || strtotime((string)$reset['expires_at']) <= time()) {
        jsonResponse(['ok' => false, 'error' => 'The reset code is invalid or expired.'], 400);
    }
    if ((int)$reset['attempt_count'] >= 5) {
        jsonResponse(['ok' => false, 'error' => 'Too many attempts. Request a new reset code.'], 429);
    }
    if (!password_verify($code, (string)$reset['code_hash'])) {
        $pdo->prepare('UPDATE password_reset_requests SET attempt_count = attempt_count + 1 WHERE user_id = ?')->execute([$reset['id']]);
        jsonResponse(['ok' => false, 'error' => 'The reset code is invalid or expired.'], 400);
    }
    $passwordHash = password_hash($password, PASSWORD_DEFAULT);
    if ($passwordHash === false) jsonResponse(['ok' => false, 'error' => 'Could not securely save the password.'], 500);
    $encryptedPassword = encryptClientSecret($password);
    $pdo->beginTransaction();
    try {
        $pdo->prepare('UPDATE client_portal_access SET password_hash = ?, admin_view_password_enc = ? WHERE client_id = ?')
            ->execute([$passwordHash, $encryptedPassword, $reset['id']]);
        $pdo->prepare('DELETE FROM password_reset_requests WHERE user_id = ?')->execute([$reset['id']]);
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
    jsonResponse(['ok' => true, 'message' => 'Your password has been updated.']);
}

// -----------------------------------------------------------------------------
// 2a. ADMIN CLIENTS (authenticated list, search, create, edit, soft delete)
// -----------------------------------------------------------------------------
$adminClientResourceMatch = [];
$adminClientRestoreMatch = [];
$isAdminClientCollection = $apiPath === '/admin/clients';
$isAdminClientImport = $apiPath === '/admin/clients/import';
$isAdminClientsearch = $apiPath === '/admin/clients/search';
$isAdminClientRestore = preg_match('#^/admin/clients/([^/]+)/restore$#', $apiPath, $adminClientRestoreMatch) === 1;
$isAdminClientResource = preg_match('#^/admin/clients/([^/]+)$#', $apiPath, $adminClientResourceMatch) === 1
    && !in_array($adminClientResourceMatch[1], ['import', 'search', 'assign-bulk', 'bulk-assign', 'bulk-status', 'bin'], true);

if ($isAdminClientCollection || $isAdminClientImport || $isAdminClientsearch || $isAdminClientRestore || $isAdminClientResource) {
    $adminStmt = $pdo->prepare("SELECT role, office_id, team_id, status, name FROM staff_users WHERE id = ?");
    $adminStmt->execute([$adminSession['id']]);
    $admin = $adminStmt->fetch();
    if (!$admin || $admin['status'] !== 'Active') {
        jsonResponse(['ok' => false, 'error' => 'Administrator account is unavailable.'], 401);
    }

    $scope = buildAdminClientscope(
        (string)$admin['role'],
        $admin['office_id'] !== null ? (string)$admin['office_id'] : null,
        $admin['team_id'] !== null ? (string)$admin['team_id'] : null,
        (string)$adminSession['id']
    );
    if ($scope === null) {
        jsonResponse(['ok' => false, 'error' => 'This account cannot access CRM clients.'], 403);
    }
    [$scopeSql, $scopeParams] = $scope;

    if (($isAdminClientCollection && $method === 'GET') || ($isAdminClientsearch && $method === 'GET')) {
        $filters = [];
        $params = $scopeParams;
        if ($scopeSql !== '') $filters[] = $scopeSql;

        $includeDeleted = $_GET['include_deleted'] ?? '';
        if ($includeDeleted === 'only') {
            $filters[] = 'l.deleted_at IS NOT NULL';
        } elseif ($includeDeleted !== '1') {
            $filters[] = 'l.deleted_at IS NULL';
        }

        $search = trim((string)($_GET['search'] ?? $_GET['q'] ?? ''));
        if ($search !== '') {
            $filters[] = "(COALESCE(l.name, '') LIKE ? OR COALESCE(l.email, '') LIKE ? OR COALESCE(l.phone, '') LIKE ? OR COALESCE(l.company, '') LIKE ? OR COALESCE(l.service, '') LIKE ? OR COALESCE(l.message, '') LIKE ?)";
            $needle = '%' . $search . '%';
            array_push($params, $needle, $needle, $needle, $needle, $needle, $needle);
        }
        foreach (['stage' => 'l.stage', 'office_id' => 'l.assigned_office_id', 'team_id' => 'l.assigned_team_id', 'team_leader_id' => 'l.assigned_team_leader_id', 'agent_id' => 'l.assigned_agent_id'] as $queryKey => $column) {
            if (isset($_GET[$queryKey]) && (string)$_GET[$queryKey] !== '') {
                $filters[] = "{$column} = ?";
                $params[] = (string)$_GET[$queryKey];
            }
        }
        $whereSql = $filters ? ' WHERE ' . implode(' AND ', $filters) : '';

        if ($isAdminClientsearch) {
            $q = trim((string)($_GET['q'] ?? ''));
            if ($q === '') jsonResponse(['ok' => true, 'clients' => []]);
            $searchNeedle = '%' . $q . '%';
            $limit = max(1, min(100, (int)($_GET['limit'] ?? 8)));
            $searchFilters = [];
            $searchParams = $scopeParams;
            if ($scopeSql !== '') $searchFilters[] = $scopeSql;
            $searchFilters[] = 'l.deleted_at IS NULL';
            $searchFilters[] = "(COALESCE(l.name, '') LIKE ? OR COALESCE(l.email, '') LIKE ? OR COALESCE(l.phone, '') LIKE ? OR COALESCE(l.company, '') LIKE ?)";
            array_push($searchParams, $searchNeedle, $searchNeedle, $searchNeedle, $searchNeedle);
            $searchSql = ' WHERE ' . implode(' AND ', $searchFilters);
            $stmt = $pdo->prepare("SELECT l.*, staff.name AS assigned_agent_name, COALESCE(access.portal_enabled, 0) AS portal_enabled, access.status AS portal_status FROM clients l LEFT JOIN staff_users staff ON staff.id = l.assigned_agent_id LEFT JOIN client_portal_access access ON access.client_id = l.id{$searchSql} ORDER BY l.created_at DESC LIMIT ?");
            $searchParams[] = $limit;
            $stmt->execute($searchParams);
            jsonResponse(['ok' => true, 'clients' => array_map('normalizeClientRow', $stmt->fetchAll())]);
        }

        $countStmt = $pdo->prepare("SELECT COUNT(*) FROM clients l{$whereSql}");
        $countStmt->execute($params);
        $total = (int)$countStmt->fetchColumn();
        $limit = max(1, min(10000, (int)($_GET['limit'] ?? 500)));
        $offset = max(0, (int)($_GET['offset'] ?? 0));
        $listStmt = $pdo->prepare("SELECT l.*, staff.name AS assigned_agent_name, COALESCE(access.portal_enabled, 0) AS portal_enabled, access.status AS portal_status FROM clients l LEFT JOIN staff_users staff ON staff.id = l.assigned_agent_id LEFT JOIN client_portal_access access ON access.client_id = l.id{$whereSql} ORDER BY l.created_at DESC, l.id DESC LIMIT ? OFFSET ?");
        $listParams = $params;
        $listParams[] = $limit;
        $listParams[] = $offset;
        $listStmt->execute($listParams);
        $rows = array_map('normalizeClientRow', $listStmt->fetchAll());
        jsonResponse([
            'ok' => true,
            'clients' => $rows,
            'total' => $total,
            'limit' => $limit,
            'offset' => $offset,
            'has_more' => $offset + count($rows) < $total,
        ]);
    }

    if ($isAdminClientImport && $method === 'POST') {
        if ($admin['role'] !== 'Super Admin') {
            jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can import clients.'], 403);
        }
        $rows = $input['clients'] ?? null;
        if (!is_array($rows) || count($rows) === 0) {
            jsonResponse(['ok' => false, 'error' => 'At least one client is required.'], 400);
        }
        if (count($rows) > 5000) {
            jsonResponse(['ok' => false, 'error' => 'Import no more than 5,000 clients at a time.'], 400);
        }

        $preparedRows = [];
        $seenEmails = [];
        $seenPhones = [];
        foreach ($rows as $index => $row) {
            if (!is_array($row)) jsonResponse(['ok' => false, 'error' => 'Invalid client data on row ' . ($index + 1) . '.'], 400);
            $firstName = trim((string)($row['first_name'] ?? $row['firstName'] ?? ''));
            $lastName = trim((string)($row['last_name'] ?? $row['lastName'] ?? ''));
            $name = trim((string)($row['name'] ?? '')) ?: trim($firstName . ' ' . $lastName);
            $email = strtolower(trim((string)($row['email'] ?? '')));
            $phone = trim((string)($row['phone'] ?? ''));
            if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                jsonResponse(['ok' => false, 'error' => 'Row ' . ($index + 1) . ' needs a name and a valid email address.'], 400);
            }
            if (isset($seenEmails[$email])) {
                jsonResponse([
                    'ok' => false,
                    'code' => 'DUPLICATE_CLIENT_IDENTIFIER',
                    'field' => 'email',
                    'error' => 'Row ' . ($index + 1) . ' repeats an email address already present in this upload. No rows were imported.',
                ], 409);
            }
            $seenEmails[$email] = $index + 1;
            $normalizedPhone = normalizeClientPhone($phone);
            if ($normalizedPhone !== '' && isset($seenPhones[$normalizedPhone])) {
                jsonResponse([
                    'ok' => false,
                    'code' => 'DUPLICATE_CLIENT_IDENTIFIER',
                    'field' => 'phone',
                    'error' => 'Row ' . ($index + 1) . ' repeats a phone number already present in this upload. No rows were imported.',
                ], 409);
            }
            if ($normalizedPhone !== '') $seenPhones[$normalizedPhone] = $index + 1;
            $assignment = validateClientAssignment($pdo, [
                'office_id' => $row['assigned_office_id'] ?? null,
                'team_id' => $row['assigned_team_id'] ?? null,
                'team_leader_id' => $row['assigned_team_leader_id'] ?? null,
                'agent_id' => $row['assigned_agent_id'] ?? null,
            ]);
            $preparedRows[] = [
                'id' => 'ld_' . bin2hex(random_bytes(8)),
                'first_name' => $firstName,
                'last_name' => $lastName,
                'name' => $name,
                'email' => $email,
                'phone' => $phone,
                'country' => trim((string)($row['country'] ?? 'United Kingdom')) ?: 'United Kingdom',
                'country_code' => trim((string)($row['country_code'] ?? $row['countryCode'] ?? 'GB')) ?: 'GB',
                'stage' => trim((string)($row['stage'] ?? $row['status'] ?? 'New')) ?: 'New',
                'funnel' => trim((string)($row['funnel'] ?? $row['service'] ?? 'General')) ?: 'General',
                'company' => trim((string)($row['company'] ?? '')),
                'service' => trim((string)($row['service'] ?? '')),
                'budget' => trim((string)($row['budget'] ?? '')),
                'timeline' => trim((string)($row['timeline'] ?? '')),
                'message' => trim((string)($row['message'] ?? '')),
                'notes' => trim((string)($row['notes'] ?? '')),
                'initial_portal_password' => trim((string)($row['client_password'] ?? $row['password'] ?? '')),
                'assigned_office_id' => $assignment['office_id'],
                'assigned_team_id' => $assignment['team_id'],
                'assigned_team_leader_id' => $assignment['team_leader_id'],
                'assigned_agent_id' => $assignment['agent_id'],
            ];
            if ($preparedRows[count($preparedRows) - 1]['initial_portal_password'] !== ''
                && strlen($preparedRows[count($preparedRows) - 1]['initial_portal_password']) < 8) {
                jsonResponse(['ok' => false, 'error' => 'Row ' . ($index + 1) . ' has a portal password shorter than 8 characters.'], 422);
            }
        }

        $now = date('c');
        $insertClient = $pdo->prepare("
            INSERT INTO clients (id, first_name, last_name, name, email, phone, country, country_code, stage, status, funnel, company, service, budget, timeline, message, source, notes, assigned_office_id, assigned_team_id, assigned_team_leader_id, assigned_agent_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'csv_import', ?, ?, ?, ?, ?, ?, ?)
        ");
        $importedClients = [];
        $pdo->beginTransaction();
        try {
            [$existingEmails, $existingPhones] = loadClientIdentifierSets($pdo);
            foreach ($preparedRows as $index => $client) {
                $normalizedPhone = normalizeClientPhone($client['phone']);
                $conflict = isset($existingEmails[$client['email']])
                    ? 'email'
                    : ($normalizedPhone !== '' && isset($existingPhones[$normalizedPhone]) ? 'phone' : null);
                if ($conflict !== null) {
                    $pdo->rollBack();
                    jsonResponse([
                        'ok' => false,
                        'code' => 'DUPLICATE_CLIENT_IDENTIFIER',
                        'field' => $conflict,
                        'error' => 'Row ' . ($index + 1) . ' uses an ' . ($conflict === 'email' ? 'email address' : 'existing phone number') . ' already used by a client or client account. No rows were imported.',
                    ], 409);
                }
                $existingEmails[$client['email']] = true;
                if ($normalizedPhone !== '') $existingPhones[$normalizedPhone] = true;
                $insertClient->execute([
                    $client['id'], $client['first_name'], $client['last_name'], $client['name'], $client['email'],
                    $client['phone'], $client['country'], $client['country_code'], $client['stage'], $client['stage'],
                    $client['funnel'], $client['company'], $client['service'], $client['budget'], $client['timeline'],
                    $client['message'], $client['notes'], $client['assigned_office_id'],
                    $client['assigned_team_id'], $client['assigned_team_leader_id'], $client['assigned_agent_id'], $now, $now,
                ]);
                ensurePortalClientAccess(
                    $pdo,
                    $client,
                    $client['initial_portal_password'] !== '' ? $client['initial_portal_password'] : null,
                    $now
                );
                unset($client['initial_portal_password']);
                $client['portal_enabled'] = 1;
                $client['portal_status'] = 'Active';
                $importedClients[] = normalizeClientRow($client + [
                    'status' => $client['stage'],
                    'source' => 'csv_import',
                    'created_at' => $now,
                    'updated_at' => $now,
                    'comment_history' => [],
                    'status_history' => [],
                    'appointments' => [],
                ]);
            }
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
        jsonResponse(['ok' => true, 'imported' => count($importedClients), 'clients' => $importedClients]);
    }

    if ($isAdminClientCollection && $method === 'POST') {
        $actor = requireActiveAdminStaff($pdo, $adminSession);
        if ($actor['role'] !== 'Super Admin' && ($actor['capabilities']['client_upload'] ?? true) === false) {
            jsonResponse(['ok' => false, 'error' => 'Client creation is not enabled for your account.'], 403);
        }
        $firstName = trim((string)($input['first_name'] ?? ''));
        $lastName = trim((string)($input['last_name'] ?? ''));
        $name = trim((string)($input['name'] ?? trim($firstName . ' ' . $lastName)));
        if ($name === '') jsonResponse(['ok' => false, 'error' => 'A client name is required.'], 400);
        if ($firstName === '' && $lastName === '') {
            $parts = preg_split('/\\s+/', $name, 2);
            $firstName = $parts[0] ?? '';
            $lastName = $parts[1] ?? '';
        }
        $email = strtolower(trim((string)($input['email'] ?? '')));
        $phone = trim((string)($input['phone'] ?? ''));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            jsonResponse(['ok' => false, 'error' => 'A valid email address is required to create the client portal.'], 400);
        }
        $initialPortalPassword = trim((string)($input['portal_password'] ?? $input['client_password'] ?? ''));
        if ($initialPortalPassword !== '' && strlen($initialPortalPassword) < 8) {
            jsonResponse(['ok' => false, 'error' => 'Portal password must contain at least 8 characters.'], 422);
        }
        $id = 'ld_' . bin2hex(random_bytes(8));
        $now = date('c');
        $stage = trim((string)($input['stage'] ?? $input['status'] ?? 'New')) ?: 'New';
        $source = trim((string)($input['source'] ?? 'manual_crm_entry'));
        $assignmentInput = [
            'office_id' => $input['assigned_office_id'] ?? null,
            'team_id' => $input['assigned_team_id'] ?? null,
            'team_leader_id' => $input['assigned_team_leader_id'] ?? null,
            'agent_id' => $input['assigned_agent_id'] ?? null,
        ];
        if ($actor['role'] === 'Office Manager' && !array_filter($assignmentInput)) {
            $assignmentInput['office_id'] = $actor['office_id'];
        } elseif ($actor['role'] === 'Team Leader' && !array_filter($assignmentInput)) {
            $assignmentInput['office_id'] = $actor['office_id'];
            $assignmentInput['team_leader_id'] = $actor['id'];
        } elseif ($actor['role'] === 'Agent' && !array_filter($assignmentInput)) {
            $assignmentInput['agent_id'] = $actor['id'];
        }
        $assignment = validateClientAssignment($pdo, $assignmentInput);
        assertCanAssignClient($actor, $assignment, $pdo);
        $stmt = $pdo->prepare("INSERT INTO clients (id, first_name, last_name, name, email, phone, country, country_code, stage, status, funnel, company, service, budget, timeline, message, source, notes, assigned_office_id, assigned_team_id, assigned_team_leader_id, assigned_agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $pdo->beginTransaction();
        try {
            $conflict = findClientIdentifierConflict($pdo, $email, $phone);
            if ($conflict !== null) {
                $pdo->rollBack();
                $identifier = $conflict === 'email' ? 'email address' : 'phone number';
                jsonResponse([
                    'ok' => false,
                    'code' => 'DUPLICATE_CLIENT_IDENTIFIER',
                    'field' => $conflict,
                    'error' => 'A client or client account already uses this ' . $identifier . '.',
                ], 409);
            }
            $stmt->execute([
                $id, $firstName, $lastName, $name, $email, $phone,
                trim((string)($input['country'] ?? 'United Kingdom')),
                trim((string)($input['country_code'] ?? 'GB')),
                $stage, $stage,
                trim((string)($input['funnel'] ?? $input['service'] ?? 'General')),
                trim((string)($input['company'] ?? '')),
                trim((string)($input['service'] ?? '')),
                trim((string)($input['budget'] ?? '')),
                trim((string)($input['timeline'] ?? '')),
                trim((string)($input['message'] ?? '')),
                $source,
                trim((string)($input['notes'] ?? '')),
                $assignment['office_id'],
                $assignment['team_id'],
                $assignment['team_leader_id'],
                $assignment['agent_id'],
                $now, $now,
            ]);
            ensurePortalClientAccess(
                $pdo,
                ['id' => $id],
                $initialPortalPassword !== '' ? $initialPortalPassword : null,
                $now
            );
            if (array_filter($assignment)) saveClientAssignment($pdo, $id, $assignment, $actor);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
        $createdStmt = $pdo->prepare("SELECT l.*, staff.name AS assigned_agent_name, COALESCE(access.portal_enabled, 0) AS portal_enabled, access.status AS portal_status FROM clients l LEFT JOIN staff_users staff ON staff.id = l.assigned_agent_id LEFT JOIN client_portal_access access ON access.client_id = l.id WHERE l.id = ?");
        $createdStmt->execute([$id]);
        jsonResponse(['ok' => true, 'client' => normalizeClientRow($createdStmt->fetch())], 201);
    }

    if ($isAdminClientResource) {
        $clientId = $adminClientResourceMatch[1];
        $clientFilters = ['l.id = ?', 'l.deleted_at IS NULL'];
        $clientParams = [$clientId];
        if ($scopeSql !== '') {
            $clientFilters[] = $scopeSql;
            array_push($clientParams, ...$scopeParams);
        }
        $clientWhere = ' WHERE ' . implode(' AND ', $clientFilters);
        $clientstmt = $pdo->prepare("SELECT l.*, staff.name AS assigned_agent_name, COALESCE(access.portal_enabled, 0) AS portal_enabled, access.status AS portal_status FROM clients l LEFT JOIN staff_users staff ON staff.id = l.assigned_agent_id LEFT JOIN client_portal_access access ON access.client_id = l.id{$clientWhere}");
        $clientstmt->execute($clientParams);
        $existingClient = $clientstmt->fetch();
        if (!$existingClient) jsonResponse(['ok' => false, 'error' => 'Client not found.'], 404);

        if ($method === 'GET') {
            jsonResponse(['ok' => true, 'client' => normalizeClientRow($existingClient)]);
        }
        if ($method === 'PATCH') {
            $allowed = [
                'first_name', 'last_name', 'name', 'email', 'phone', 'country',
                'country_code', 'stage', 'status', 'funnel', 'company', 'service',
                'budget', 'timeline', 'message', 'source', 'notes',
                'assigned_office_id', 'assigned_team_id', 'assigned_team_leader_id', 'assigned_agent_id',
            ];
            $updates = [];
            foreach ($allowed as $field) {
                if (array_key_exists($field, $input)) $updates[$field] = $input[$field];
            }
            $comment = trim((string)($input['comment'] ?? ''));
            if ($comment !== '') {
                $commentHistory = json_decode((string)($existingClient['comment_history'] ?? '[]'), true);
                if (!is_array($commentHistory)) $commentHistory = [];
                $commentHistory[] = [
                    'id' => 'c_' . bin2hex(random_bytes(5)),
                    'by_admin_id' => $adminSession['id'],
                    'by_name' => $admin['name'],
                    'text' => $comment,
                    'created_at' => date('c'),
                ];
                $updates['comment_history'] = json_encode($commentHistory, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            }
            $assignmentKeys = ['assigned_office_id', 'assigned_team_id', 'assigned_team_leader_id', 'assigned_agent_id'];
            $assignmentChanged = false;
            $previousAssignment = clientAssignmentFromRow($existingClient);
            $nextAssignment = $previousAssignment;
            foreach ($assignmentKeys as $field) {
                if (!array_key_exists($field, $updates)) continue;
                $assignmentChanged = true;
                $key = match ($field) {
                    'assigned_office_id' => 'office_id',
                    'assigned_team_id' => 'team_id',
                    'assigned_team_leader_id' => 'team_leader_id',
                    default => 'agent_id',
                };
                $nextAssignment[$key] = $updates[$field];
                unset($updates[$field]);
            }
            if ($assignmentChanged) {
                $assignmentActor = requireActiveAdminStaff($pdo, $adminSession);
                $nextAssignment = validateClientAssignment($pdo, $nextAssignment);
                assertCanAssignClient($assignmentActor, $nextAssignment, $pdo);
                $updates['assigned_office_id'] = $nextAssignment['office_id'];
                $updates['assigned_team_id'] = $nextAssignment['team_id'];
                $updates['assigned_team_leader_id'] = $nextAssignment['team_leader_id'];
                $updates['assigned_agent_id'] = $nextAssignment['agent_id'];
                $updates['assigned_by'] = $assignmentActor['id'];
            }
            if (isset($updates['stage']) && !isset($updates['status'])) $updates['status'] = $updates['stage'];
            if (isset($updates['status']) && !isset($updates['stage'])) $updates['stage'] = $updates['status'];
            if (array_key_exists('email', $updates)) {
                $updates['email'] = strtolower(trim((string)$updates['email']));
                if ($updates['email'] !== '' && !filter_var($updates['email'], FILTER_VALIDATE_EMAIL)) {
                    jsonResponse(['ok' => false, 'error' => 'Enter a valid email address.'], 400);
                }
            }
            if (array_key_exists('phone', $updates)) {
                $updates['phone'] = trim((string)$updates['phone']);
            }
            $emailChanged = array_key_exists('email', $updates)
                && strtolower(trim((string)$updates['email'])) !== strtolower(trim((string)($existingClient['email'] ?? '')));
            $phoneChanged = array_key_exists('phone', $updates)
                && normalizeClientPhone((string)$updates['phone']) !== normalizeClientPhone((string)($existingClient['phone'] ?? ''));
            if ($emailChanged || $phoneChanged) {
                $conflict = findClientIdentifierConflict(
                    $pdo,
                    (string)($updates['email'] ?? $existingClient['email'] ?? ''),
                    (string)($updates['phone'] ?? $existingClient['phone'] ?? ''),
                    $clientId,
                    null,
                    $emailChanged,
                    $phoneChanged
                );
                if ($conflict !== null) {
                    $identifier = $conflict === 'email' ? 'email address' : 'phone number';
                    jsonResponse([
                        'ok' => false,
                        'code' => 'DUPLICATE_CLIENT_IDENTIFIER',
                        'field' => $conflict,
                        'error' => 'Another client or client account already uses this ' . $identifier . '.',
                    ], 409);
                }
            }
            if (isset($updates['first_name']) || isset($updates['last_name'])) {
                $first = (string)($updates['first_name'] ?? $existingClient['first_name'] ?? '');
                $last = (string)($updates['last_name'] ?? $existingClient['last_name'] ?? '');
                $updates['name'] = trim($first . ' ' . $last);
            }
            if (!$updates) jsonResponse(['ok' => false, 'error' => 'No supported client fields were provided.'], 400);

            $oldStage = (string)($existingClient['stage'] ?? '');
            $nextStage = (string)($updates['stage'] ?? $oldStage);
            if ($nextStage !== $oldStage) {
                $history = json_decode((string)($existingClient['status_history'] ?? '[]'), true);
                if (!is_array($history)) $history = [];
                $history[] = [
                    'id' => 'st_' . bin2hex(random_bytes(5)),
                    'from_stage' => $oldStage,
                    'to_stage' => $nextStage,
                    'by_admin_id' => $adminSession['id'],
                    'by_name' => $admin['name'],
                    'created_at' => date('c'),
                ];
                $updates['status_history'] = json_encode($history, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            }
            $updates['updated_at'] = date('c');
            $setSql = implode(', ', array_map(static fn($field) => "{$field} = ?", array_keys($updates)));
            $updateParams = array_values($updates);
            $updateFilters = ['id = ?', 'deleted_at IS NULL'];
            $updateParams[] = $clientId;
            if ($scopeSql !== '') {
                $updateFilters[] = str_replace('l.', '', $scopeSql);
                array_push($updateParams, ...$scopeParams);
            }
            $pdo->beginTransaction();
            try {
                $pdo->prepare("UPDATE clients SET {$setSql} WHERE " . implode(' AND ', $updateFilters))->execute($updateParams);
                if ($assignmentChanged) {
                    $historyId = 'lah_' . bin2hex(random_bytes(10));
                    $pdo->prepare('INSERT INTO client_assignment_history (id, client_id, actor_id, previous_assignment, new_assignment, created_at) VALUES (?, ?, ?, ?, ?, ?)')
                        ->execute([$historyId, $clientId, $assignmentActor['id'], json_encode($previousAssignment), json_encode($nextAssignment), date('c')]);
                }
                $pdo->commit();
            } catch (Throwable $error) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $error;
            }
            $updatedStmt = $pdo->prepare("SELECT l.*, staff.name AS assigned_agent_name FROM clients l LEFT JOIN staff_users staff ON staff.id = l.assigned_agent_id WHERE l.id = ? AND l.deleted_at IS NULL");
            $updatedStmt->execute([$clientId]);
            jsonResponse(['ok' => true, 'client' => normalizeClientRow($updatedStmt->fetch())]);
        }
        if ($method === 'DELETE') {
            $deleteScope = $scopeSql !== '' ? ' AND ' . str_replace('l.', '', $scopeSql) : '';
            if (($_GET['permanent'] ?? '') === '1') {
                $deleteStmt = $pdo->prepare('DELETE FROM clients WHERE id = ?' . $deleteScope);
                $deleteStmt->execute($scopeSql !== '' ? array_merge([$clientId], $scopeParams) : [$clientId]);
                jsonResponse(['ok' => true, 'id' => $clientId, 'deleted' => true]);
            }
            $deleteStmt = $pdo->prepare('UPDATE clients SET deleted_at = ?, updated_at = ? WHERE id = ?' . $deleteScope);
            $now = date('c');
            $deleteStmt->execute($scopeSql !== '' ? array_merge([$now, $now, $clientId], $scopeParams) : [$now, $now, $clientId]);
            jsonResponse(['ok' => true, 'id' => $clientId, 'deleted' => true]);
        }
    }

    if ($isAdminClientRestore && $method === 'POST') {
        $clientId = $adminClientRestoreMatch[1];
        $filters = ['id = ?', 'deleted_at IS NOT NULL'];
        $params = [$clientId];
        if ($scopeSql !== '') {
            $filters[] = str_replace('l.', '', $scopeSql);
            array_push($params, ...$scopeParams);
        }
        $stmt = $pdo->prepare('UPDATE clients SET deleted_at = NULL, updated_at = ? WHERE ' . implode(' AND ', $filters));
        $stmt->execute(array_merge([date('c')], $params));
        if ($stmt->rowCount() === 0) jsonResponse(['ok' => false, 'error' => 'Deleted client not found.'], 404);
        $restoredStmt = $pdo->prepare('SELECT * FROM clients WHERE id = ?');
        $restoredStmt->execute([$clientId]);
        jsonResponse(['ok' => true, 'client' => normalizeClientRow($restoredStmt->fetch())]);
    }
}

if ($apiPath === '/crm/settings') {
    if ($method !== 'GET') {
        jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }
    $record = readPlatformSettingsRecord($pdo);
    jsonResponse([
        'ok' => true,
        'settings' => $record['settings'],
        'site_config' => publicSiteConfig($record['site_config']),
    ]);
}

if ($apiPath === '/admin/site-content') {
    requireAdminCapability($pdo, $adminSession, 'content');
    if ($method !== 'GET') jsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
    $projects = $pdo->query('SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1000')->fetchAll();
    foreach ($projects as &$project) {
        $showcase = json_decode((string)($project['showcase_json'] ?? ''), true);
        if (is_array($showcase)) {
            $project = array_merge($project, $showcase);
        }
        $project['id'] = (int)$project['id'];
        $project['is_published'] = (bool)$project['is_published'];
        $project['published'] = $project['is_published'];
        unset($project['showcase_json']);
    }
    unset($project);
    jsonResponse([
        'ok' => true,
        'projects' => $projects,
        'blogs' => $pdo->query('SELECT * FROM blogs WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1000')->fetchAll(),
        'reviews' => $pdo->query('SELECT * FROM reviews WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1000')->fetchAll(),
        'backlinks' => $pdo->query('SELECT * FROM backlinks WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1000')->fetchAll(),
    ]);
}

if ($apiPath === '/admin/site-content/action' && $method === 'POST') {
    requireAdminCapability($pdo, $adminSession, 'content');
    $action = (string)($input['action'] ?? '');
    $record = is_array($input['record'] ?? null) ? $input['record'] : $input;
    $actions = [
        'save_project' => ['project', false, false],
        'update_project' => ['project', false, false],
        'save_showcase_project' => ['project', true, false],
        'delete_project' => ['project', false, true],
        'save_blog' => ['blog', false, false],
        'update_blog' => ['blog', false, false],
        'delete_blog' => ['blog', false, true],
        'save_review' => ['review', false, false],
        'update_review' => ['review', false, false],
        'delete_review' => ['review', false, true],
        'add_backlink' => ['backlink', false, false],
        'update_backlink' => ['backlink', false, false],
        'delete_backlink' => ['backlink', false, true],
    ];
    if (!isset($actions[$action])) jsonResponse(['ok' => false, 'error' => 'Unsupported site content action.'], 400);
    [$type, $showcase, $delete] = $actions[$action];
    $id = filter_var($record['id'] ?? null, FILTER_VALIDATE_INT);
    if ($delete) {
        if (!$id || $id < 1) jsonResponse(['ok' => false, 'error' => 'A valid record ID is required.'], 422);
        $table = ['project' => 'projects', 'blog' => 'blogs', 'review' => 'reviews', 'backlink' => 'backlinks'][$type];
        $stmt = $pdo->prepare("UPDATE {$table} SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL");
        $stmt->execute([date('c'), $id]);
        if ($stmt->rowCount() === 0) jsonResponse(['ok' => false, 'error' => 'Record not found.'], 404);
        jsonResponse(['ok' => true, 'archived' => true, 'id' => (int)$id]);
    }
    $recordId = storeSiteContentRecord($pdo, $type, $record, $showcase);
    jsonResponse(['ok' => true, 'id' => $recordId], $id ? 200 : 201);
}

if ($apiPath === '/admin/site-content/import-local' && $method === 'POST') {
    requireAdminCapability($pdo, $adminSession, 'content');
    $collections = [
        'blogs' => 'blog',
        'reviews' => 'review',
        'projects' => 'project',
        'backlinks' => 'backlink',
        'showcaseProjects' => 'showcase_project',
        'enquiries' => 'enquiry',
    ];
    $pdo->beginTransaction();
    $imported = 0;
    $skipped = 0;
    try {
        foreach ($collections as $field => $type) {
            $records = $input[$field] ?? [];
            if (!is_array($records)) continue;
            foreach (array_slice($records, 0, 1000) as $index => $record) {
                if (!is_array($record)) { $skipped++; continue; }
                $legacyId = trim((string)($record['id'] ?? hash('sha256', json_encode($record, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE))));
                $sourceKey = $field . ':' . hash('sha256', $legacyId);
                $exists = $pdo->prepare('SELECT record_id FROM site_content_imports WHERE source_key = ?');
                $exists->execute([$sourceKey]);
                if ($exists->fetchColumn()) { $skipped++; continue; }
                if ($type === 'enquiry') {
                    $clientId = importLegacySiteEnquiry($pdo, $record);
                    if ($clientId === null) { $skipped++; continue; }
                    $pdo->prepare('INSERT INTO site_content_imports (source_key, record_type, record_id, imported_at) VALUES (?, ?, ?, ?)')
                        ->execute([$sourceKey, 'client', $clientId, date('c')]);
                } else {
                    $contentType = $type === 'showcase_project' ? 'project' : $type;
                    unset($record['id']);
                    try {
                        $recordId = storeSiteContentRecord($pdo, $contentType, $record, $type === 'showcase_project');
                    } catch (InvalidArgumentException $error) {
                        $skipped++;
                        continue;
                    }
                    $pdo->prepare('INSERT INTO site_content_imports (source_key, record_type, record_id, imported_at) VALUES (?, ?, ?, ?)')
                        ->execute([$sourceKey, $contentType, (string)$recordId, date('c')]);
                }
                $imported++;
            }
        }
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
    jsonResponse(['ok' => true, 'imported' => $imported, 'skipped' => $skipped]);
}
