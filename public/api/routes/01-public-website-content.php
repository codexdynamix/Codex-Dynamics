<?php
/** Route group: PUBLIC WEBSITE CONTENT (Live projects, client reviews, published blogs) (included by index.php in order; uses its request globals). */

declare(strict_types=1);

function mongoPublicContentQueries(): array {
    return [
        'projects' => [
            ['is_published' => 1, 'deleted_at' => null],
            ['sort' => ['id' => -1]],
        ],
        'blogs' => [
            ['status' => 'published', 'deleted_at' => null],
            ['sort' => ['id' => -1]],
        ],
        'reviews' => [
            ['is_published' => 1, 'deleted_at' => null],
            ['sort' => ['id' => -1]],
        ],
    ];
}

function normalizeMongoPublicProjects(array $projects): array {
    foreach ($projects as &$project) {
        $showcase = json_decode((string)($project['showcase_json'] ?? ''), true);
        if (is_array($showcase)) $project = array_merge($project, $showcase);
        $project['id'] = (int)$project['id'];
        $project['is_published'] = true;
        $project['published'] = true;
        unset($project['showcase_json'], $project['_id'], $project['_migration_source']);
    }
    unset($project);
    return $projects;
}

function normalizeMongoPublicContentRows(array $rows): array {
    foreach ($rows as &$row) {
        unset($row['_id'], $row['_migration_source']);
    }
    unset($row);
    return $rows;
}

function getMongoPublicContent(): array {
    $queries = mongoPublicContentQueries();
    return [
        'ok' => true,
        'projects' => normalizeMongoPublicProjects(
            mongoFindMany('projects', $queries['projects'][0], $queries['projects'][1]),
        ),
        'blogs' => normalizeMongoPublicContentRows(
            mongoFindMany('blogs', $queries['blogs'][0], $queries['blogs'][1]),
        ),
        'reviews' => normalizeMongoPublicContentRows(
            mongoFindMany('reviews', $queries['reviews'][0], $queries['reviews'][1]),
        ),
    ];
}

// -----------------------------------------------------------------------------
// 1. PUBLIC WEBSITE CONTENT (Live projects, client reviews, published blogs)
// -----------------------------------------------------------------------------
if ($apiPath === '/public/content' || $apiPath === '/content') {
    if (isMongoPublicContentEnabled()) {
        jsonResponse(getMongoPublicContent());
    }

    $projects = $pdo->query("SELECT * FROM projects WHERE is_published = 1 AND deleted_at IS NULL ORDER BY id DESC")->fetchAll();
    foreach ($projects as &$project) {
        $showcase = json_decode((string)($project['showcase_json'] ?? ''), true);
        if (is_array($showcase)) $project = array_merge($project, $showcase);
        $project['id'] = (int)$project['id'];
        $project['is_published'] = true;
        $project['published'] = true;
        unset($project['showcase_json']);
    }
    unset($project);
    $blogs = $pdo->query("SELECT * FROM blogs WHERE status = 'published' AND deleted_at IS NULL ORDER BY id DESC")->fetchAll();
    $reviews = $pdo->query("SELECT * FROM reviews WHERE is_published = 1 AND deleted_at IS NULL ORDER BY id DESC")->fetchAll();
    jsonResponse([
        'ok' => true,
        'projects' => $projects,
        'blogs' => $blogs,
        'reviews' => $reviews,
    ]);
}
