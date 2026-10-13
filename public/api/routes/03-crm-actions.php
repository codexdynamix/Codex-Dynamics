<?php
/** Route group: CRM ACTIONS (Blog save/toggle, Project save/toggle/hide, Image uploads) (included by index.php in order; uses its request globals). */

declare(strict_types=1);

function mongoContentIdFilter(int $id): array {
    return ['$or' => [['id' => $id], ['id' => (string)$id]]];
}

function mongoContentSlugFromTitle(string $title): string {
    return strtolower((string)preg_replace('/[^a-zA-Z0-9]+/', '-', $title));
}

function mongoContentIsDuplicateKey(Throwable $error): bool {
    return (int)$error->getCode() === 11000 || str_contains($error->getMessage(), 'E11000');
}

function mongoContentJsonArray(mixed $value, ?array $fallback = null): ?array {
    if (is_array($value)) return $value;
    if (!is_string($value) || $value === '') return $fallback;
    $decoded = json_decode($value, true);
    return is_array($decoded) ? $decoded : $fallback;
}

function mongoContentPlatformSettingsRecord(?array $row): array {
    return [
        'settings' => mongoContentJsonArray($row['settings_json'] ?? null, []) ?? [],
        'site_config' => mongoContentJsonArray($row['site_config_json'] ?? null),
        'updated_at' => $row['updated_at'] ?? null,
    ];
}

function mongoContentNextSiteConfig(array $current, ?array $siteConfig, bool $siteConfigProvided): ?array {
    return $siteConfigProvided ? $siteConfig : $current['site_config'];
}

function mongoContentSuperAdminIsActive(?array $staff): bool {
    return $staff !== null
        && ($staff['status'] ?? null) === 'Active'
        && empty($staff['deleted_at'])
        && ($staff['role'] ?? null) === 'Super Admin';
}

function mongoContentRequireSuperAdmin(): string {
    $session = findMongoSession('admin_sessions', 'user_id');
    if (!$session) {
        jsonResponse(['ok' => false, 'error' => 'Authentication required.'], 401);
    }
    $staff = mongoFindOne('staff_users', ['id' => $session['id']]);
    if (!$staff || ($staff['status'] ?? null) !== 'Active' || !empty($staff['deleted_at'])) {
        jsonResponse(['ok' => false, 'error' => 'Administrator account is unavailable.'], 401);
    }
    if (($staff['role'] ?? null) !== 'Super Admin') {
        jsonResponse(['ok' => false, 'error' => 'Only a Super Admin can perform this action.'], 403);
    }
    return (string)$session['id'];
}

function mongoContentNextIntegerId(string $table): int {
    $collection = getMongoCollection(mongoCollectionName($table));
    $counterId = 'legacy_' . $table;
    $counterCollection = getMongoCollection('application_counters');

    // Seed only when needed, so IDs imported from the SQL tables remain the
    // lower bound. The counter update itself is atomic; it is not a transaction
    // with the later content insert, so failed inserts can leave harmless gaps.
    $counter = $counterCollection->findOne(['_id' => $counterId]);
    if ($counter === null) {
        $maxId = 0;
        foreach ($collection->find([], ['projection' => ['id' => 1]]) as $document) {
            $row = mongoDocumentToArray($document);
            $value = $row['id'] ?? null;
            if ((is_int($value) || (is_string($value) && ctype_digit($value)))
                && (int)$value > $maxId) {
                $maxId = (int)$value;
            }
        }
        try {
            $counterCollection->updateOne(
                ['_id' => $counterId],
                ['$max' => ['sequence' => $maxId]],
                ['upsert' => true],
            );
        } catch (Throwable $error) {
            // Another request may have created the same counter concurrently.
            if (!mongoContentIsDuplicateKey($error)) throw $error;
        }
    }

    $next = $counterCollection->findOneAndUpdate(
        ['_id' => $counterId],
        ['$inc' => ['sequence' => 1]],
        ['returnDocument' => \MongoDB\Operation\FindOneAndUpdate::RETURN_DOCUMENT_AFTER],
    );
    $row = mongoDocumentToArray($next);
    if (!is_array($row) || !isset($row['sequence'])) {
        throw new RuntimeException('Could not allocate a content ID.');
    }
    return (int)$row['sequence'];
}

function mongoContentSavePlatformSettings(
    array $settings,
    ?array $siteConfig,
    string $actorId,
    bool $siteConfigProvided = true
): array {
    $collection = getMongoCollection(mongoCollectionName('platform_settings'));
    $currentRow = $collection->findOne(['id' => 'global']);
    $current = mongoContentPlatformSettingsRecord(mongoDocumentToArray($currentRow));
    $nextSettings = array_merge($current['settings'], $settings);
    $nextSiteConfig = mongoContentNextSiteConfig($current, $siteConfig, $siteConfigProvided);
    $settingsJson = json_encode($nextSettings, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $siteConfigJson = $nextSiteConfig === null
        ? null
        : json_encode($nextSiteConfig, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($settingsJson === false || ($nextSiteConfig !== null && $siteConfigJson === false)) {
        throw new RuntimeException('Settings could not be encoded.');
    }
    if (strlen($settingsJson) + strlen((string)$siteConfigJson) > 1_000_000) {
        throw new LengthException('Settings payload is too large.');
    }

    $now = date('c');
    $collection->updateOne(
        ['id' => 'global'],
        ['$set' => [
            'settings_json' => $settingsJson,
            'site_config_json' => $siteConfigJson,
            'updated_by' => $actorId,
            'updated_at' => $now,
        ]],
        ['upsert' => true],
    );
    return [
        'settings' => $nextSettings,
        'site_config' => $nextSiteConfig,
        'updated_at' => $now,
    ];
}

// -----------------------------------------------------------------------------
// 3. CRM ACTIONS (Blog save/toggle, Project save/toggle/hide, Image uploads)
// -----------------------------------------------------------------------------
if ($apiPath === '/crm/action') {
    $action = $input['action'] ?? '';
    $mongoStorage = isMongoStorageEnabled();
    $contentActorId = null;
    $contentAdmin = null;
    $protectedContentActions = [
        'save_site_content', 'toggle_project', 'save_project', 'delete_project',
        'save_blog', 'update_blog', 'delete_blog',
    ];
    if ($mongoStorage && $action === 'upload_image') {
        jsonResponse(['ok' => false, 'error' => 'Image uploads are not supported in MongoDB mode.'], 501);
    }
    if (in_array($action, $protectedContentActions, true)) {
        if ($mongoStorage) {
            $contentActorId = mongoContentRequireSuperAdmin();
        } else {
            $contentAdmin = findSession($pdo, 'admin_sessions', 'user_id');
            requireSuperAdmin($pdo, $contentAdmin);
        }
    }
    if ($action === 'save_site_content') {
        $siteConfig = $input['payload']['config'] ?? $input['site_config'] ?? null;
        if (!is_array($siteConfig)) {
            jsonResponse(['ok' => false, 'error' => 'A site configuration object is required.'], 400);
        }
        try {
            $record = $mongoStorage
                ? mongoContentSavePlatformSettings([], $siteConfig, (string)$contentActorId)
                : savePlatformSettingsRecord($pdo, [], $siteConfig, (string)$contentAdmin['id']);
        } catch (LengthException $error) {
            jsonResponse(['ok' => false, 'error' => $error->getMessage()], 413);
        }
        jsonResponse(['ok' => true, 'site_config' => $record['site_config']]);
    }

    // Upload picture
    if ($action === 'upload_image') {
        $name = preg_replace('/[^a-zA-Z0-9_\.-]/', '_', $input['name'] ?? 'image.png');
        $dataUri = $input['data'] ?? '';
        if (preg_match('/^data:image\/(\w+);base64,/', $dataUri, $matches)) {
            $ext = $matches[1];
            $base64 = substr($dataUri, strpos($dataUri, ',') + 1);
            $decoded = base64_decode($base64);
            $uploadsDir = __DIR__ . '/../uploads';
            if (!is_dir($uploadsDir)) @mkdir($uploadsDir, 0755, true);
            $filename = time() . '_' . $name;
            file_put_contents("{$uploadsDir}/{$filename}", $decoded);
            jsonResponse(['ok' => true, 'url' => "/uploads/{$filename}"]);
        }
        jsonResponse(['ok' => false, 'error' => 'Invalid image payload'], 400);
    }

    // Toggle project visibility (Hide/Show on site)
    if ($action === 'toggle_project') {
        $id = (int)($input['id'] ?? 0);
        $isPublished = !empty($input['is_published']) ? 1 : 0;
        if ($mongoStorage) {
            getMongoCollection(mongoCollectionName('projects'))->updateOne(
                mongoContentIdFilter($id),
                ['$set' => ['is_published' => $isPublished]],
            );
        } else {
            $pdo->prepare("UPDATE projects SET is_published = ? WHERE id = ?")->execute([$isPublished, $id]);
        }
        jsonResponse(['ok' => true, 'id' => $id, 'is_published' => (bool)$isPublished]);
    }

    // Save project
    if ($action === 'save_project') {
        $title = trim($input['title'] ?? '');
        $siteName = trim($input['site_name'] ?? '');
        $siteUrl = trim($input['site_url'] ?? '');
        $desc = trim($input['description'] ?? '');
        $cat = trim($input['category'] ?? 'Websites & Web Apps');
        $img = trim($input['image_url'] ?? '');
        $pub = isset($input['is_published']) ? ($input['is_published'] ? 1 : 0) : 1;
        $now = date('c');

        if ($mongoStorage) {
            $id = mongoContentNextIntegerId('projects');
            getMongoCollection(mongoCollectionName('projects'))->insertOne([
                'id' => $id,
                'title' => $title,
                'site_name' => $siteName,
                'site_url' => $siteUrl,
                'description' => $desc,
                'category' => $cat,
                'image_url' => $img,
                'is_published' => $pub,
                'created_at' => $now,
            ]);
        } else {
            $stmt = $pdo->prepare("
                INSERT INTO projects (title, site_name, site_url, description, category, image_url, is_published, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ");
            $stmt->execute([$title, $siteName, $siteUrl, $desc, $cat, $img, $pub, $now]);
            $id = (int)$pdo->lastInsertId();
        }
        jsonResponse(['ok' => true, 'id' => $id]);
    }

    // Delete project
    if ($action === 'delete_project') {
        $id = (int)($input['id'] ?? 0);
        if ($mongoStorage) {
            getMongoCollection(mongoCollectionName('projects'))->deleteMany(mongoContentIdFilter($id));
        } else {
            $pdo->prepare("DELETE FROM projects WHERE id = ?")->execute([$id]);
        }
        jsonResponse(['ok' => true]);
    }

    // Save blog post (WordPress-like)
    if ($action === 'save_blog' || $action === 'update_blog') {
        $title = trim($input['title'] ?? 'Untitled Article');
        $slug = trim($input['slug'] ?? mongoContentSlugFromTitle($title));
        $content = $input['content'] ?? '';
        $excerpt = $input['excerpt'] ?? substr(strip_tags($content), 0, 160);
        $category = $input['category'] ?? 'Engineering';
        $status = $input['status'] ?? 'published';
        $img = $input['featured_image'] ?? '';
        $meta = $input['meta_description'] ?? $excerpt;
        $readingTime = max(1, (int)round(str_word_count(strip_tags($content)) / 200));
        $now = date('c');

        if ($mongoStorage) {
            $collection = getMongoCollection(mongoCollectionName('blogs'));
            try {
                $collection->createIndex(
                    ['slug' => 1],
                    [
                        'unique' => true,
                        'name' => 'unique_content_slug',
                        'partialFilterExpression' => ['slug' => ['$type' => 'string']],
                    ],
                );
                if (!empty($input['id'])) {
                    $id = (int)$input['id'];
                    $collection->updateOne(
                        mongoContentIdFilter($id),
                        ['$set' => [
                            'title' => $title,
                            'slug' => $slug,
                            'content' => $content,
                            'excerpt' => $excerpt,
                            'category' => $category,
                            'status' => $status,
                            'featured_image' => $img,
                            'meta_description' => $meta,
                            'reading_time' => $readingTime,
                            'updated_at' => $now,
                        ]],
                    );
                } else {
                    $id = mongoContentNextIntegerId('blogs');
                    $collection->insertOne([
                        'id' => $id,
                        'title' => $title,
                        'slug' => $slug,
                        'content' => $content,
                        'excerpt' => $excerpt,
                        'category' => $category,
                        'author' => 'Codex Team',
                        'status' => $status,
                        'featured_image' => $img,
                        'meta_description' => $meta,
                        'reading_time' => $readingTime,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]);
                }
            } catch (Throwable $error) {
                if (mongoContentIsDuplicateKey($error)) {
                    jsonResponse(['ok' => false, 'error' => 'That blog URL is already in use.'], 409);
                }
                throw $error;
            }
            jsonResponse(['ok' => true, 'id' => $id]);
        }

        if (!empty($input['id'])) {
            $stmt = $pdo->prepare("
                UPDATE blogs
                SET title = ?, slug = ?, content = ?, excerpt = ?, category = ?, status = ?, featured_image = ?, meta_description = ?, reading_time = ?, updated_at = ?
                WHERE id = ?
            ");
            $stmt->execute([$title, $slug, $content, $excerpt, $category, $status, $img, $meta, $readingTime, $now, (int)$input['id']]);
            jsonResponse(['ok' => true, 'id' => (int)$input['id']]);
        } else {
            $stmt = $pdo->prepare("
                INSERT INTO blogs (title, slug, content, excerpt, category, author, status, featured_image, meta_description, reading_time, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'Codex Team', ?, ?, ?, ?, ?, ?)
            ");
            $stmt->execute([$title, $slug, $content, $excerpt, $category, $status, $img, $meta, $readingTime, $now, $now]);
            jsonResponse(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
        }
    }

    // Delete blog post
    if ($action === 'delete_blog') {
        $id = (int)($input['id'] ?? 0);
        if ($mongoStorage) {
            getMongoCollection(mongoCollectionName('blogs'))->deleteMany(mongoContentIdFilter($id));
        } else {
            $pdo->prepare("DELETE FROM blogs WHERE id = ?")->execute([$id]);
        }
        jsonResponse(['ok' => true]);
    }

    jsonResponse(['ok' => false, 'error' => 'Unknown CRM action.'], 400);
}
