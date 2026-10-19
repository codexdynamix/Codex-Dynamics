<?php

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}

$apiRoot = dirname(__DIR__);
$autoload = $apiRoot . '/vendor/autoload.php';
if (!is_file($autoload)) {
    fwrite(STDERR, "MongoDB Composer dependencies are missing.\n");
    exit(1);
}
require_once $autoload;

$configFile = $apiRoot . '/config.php';
$config = is_file($configFile) ? require $configFile : [];
$uri = (string)($config['mongodb_uri'] ?? getenv('MONGODB_URI') ?: '');
$databaseName = (string)($config['mongodb_database'] ?? getenv('MONGODB_DATABASE') ?: 'codex_dynamics');
if (!str_starts_with($uri, 'mongodb://') && !str_starts_with($uri, 'mongodb+srv://')) {
    fwrite(STDERR, "MONGODB_URI is not configured for this PHP CLI environment.\n");
    exit(1);
}
if (!extension_loaded('mongodb') || !class_exists('MongoDB\\Client')) {
    fwrite(STDERR, "The MongoDB PHP extension and Composer library are required.\n");
    exit(1);
}

try {
    $client = new MongoDB\Client($uri, [], ['serverSelectionTimeoutMS' => 4000]);
    $clients = $client->selectDatabase($databaseName)->selectCollection('clients');

    $binResult = $clients->updateMany(
        ['is_bin' => ['$ne' => true]],
        ['$set' => ['is_bin' => false]]
    );
    $missingDeletedAtResult = $clients->updateMany(
        ['deleted_at' => ['$exists' => false]],
        ['$set' => ['deleted_at' => null]]
    );
    $emptyDeletedAtResult = $clients->updateMany(
        ['deleted_at' => ''],
        ['$set' => ['deleted_at' => null]]
    );
    $indexName = $clients->createIndex(
        ['is_bin' => 1, 'deleted_at' => 1, '_id' => -1],
        ['name' => 'clients_visibility_sort']
    );

    printf(
        "Client visibility normalized: %d is_bin values, %d missing deleted_at values, %d empty deleted_at values. Index ensured: %s\n",
        $binResult->getModifiedCount(),
        $missingDeletedAtResult->getModifiedCount(),
        $emptyDeletedAtResult->getModifiedCount(),
        $indexName
    );
} catch (Throwable $error) {
    fwrite(STDERR, "Client optimization maintenance failed. Verify MongoDB connectivity and permissions, then retry.\n");
    exit(1);
}
