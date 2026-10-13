<?php
/** MongoDB connection helpers used while API route groups are migrated from PDO. */

declare(strict_types=1);

use MongoDB\Client;
use MongoDB\Collection;
use MongoDB\Database;
use MongoDB\Model\BSONDocument;

function mongoConfiguration(): array {
    $uri = getenv('MONGODB_URI');
    if (!is_string($uri) || trim($uri) === '') {
        throw new RuntimeException('MongoDB is not configured. Set the server-side MONGODB_URI environment variable.');
    }

    $configuredDatabaseName = getenv('MONGODB_DATABASE');
    if (getenv('NODE_ENV') === 'production'
        && (!is_string($configuredDatabaseName) || trim($configuredDatabaseName) === '')) {
        throw new RuntimeException('MONGODB_DATABASE must be explicitly configured in production.');
    }
    $databaseName = trim((string)($configuredDatabaseName ?: 'codex_dynamics_migration'));
    if (!preg_match('/^[A-Za-z0-9_-]{1,63}$/', $databaseName)) {
        throw new RuntimeException('MONGODB_DATABASE must be a valid short database name.');
    }

    return [$uri, $databaseName];
}

function isMongoStorageEnabled(): bool {
    return getenv('API_STORAGE') === 'mongodb';
}

function isMongoPublicContentEnabled(): bool {
    return isMongoStorageEnabled();
}

function getMongoDatabase(): Database {
    static $database = null;
    if ($database instanceof Database) {
        return $database;
    }

    [$uri, $databaseName] = mongoConfiguration();
    $autoload = dirname(__DIR__) . '/vendor/autoload.php';
    if (!is_file($autoload)) {
        throw new RuntimeException('MongoDB dependencies are missing. Run Composer install for the API.');
    }
    require_once $autoload;

    if (!extension_loaded('mongodb')) {
        throw new RuntimeException('The PHP MongoDB extension is required to use MongoDB persistence.');
    }

    $client = new Client($uri, [], ['serverSelectionTimeoutMS' => 5000]);
    $database = $client->selectDatabase($databaseName);
    return $database;
}

function getMongoCollection(string $name): Collection {
    if (!preg_match('/^[A-Za-z][A-Za-z0-9_]{0,119}$/', $name)) {
        throw new InvalidArgumentException('Invalid MongoDB collection name.');
    }

    return getMongoDatabase()->selectCollection($name);
}

function mongoCollectionName(string $table): string {
    if (!preg_match('/^[A-Za-z][A-Za-z0-9_]{0,119}$/', $table)) {
        throw new InvalidArgumentException('Invalid MongoDB collection name.');
    }

    return 'legacy_' . $table;
}

function mongoDocumentToArray(mixed $document): ?array {
    if ($document === null) {
        return null;
    }
    if ($document instanceof BSONDocument) {
        return $document->getArrayCopy();
    }
    if (is_object($document)) {
        return (array)$document;
    }
    return is_array($document) ? $document : null;
}

function mongoFindOne(string $table, array $filter): ?array {
    return mongoDocumentToArray(
        getMongoCollection(mongoCollectionName($table))->findOne($filter),
    );
}

function mongoFindMany(string $table, array $filter = [], array $options = []): array {
    $documents = getMongoCollection(mongoCollectionName($table))->find($filter, $options);
    $rows = [];
    foreach ($documents as $document) {
        $row = mongoDocumentToArray($document);
        if ($row !== null) {
            $rows[] = $row;
        }
    }
    return $rows;
}

function mongoInsert(string $table, array $document): void {
    if (!isset($document['_id'])) {
        if (isset($document['id'])) {
            $document['_id'] = (string)$document['id'];
        } elseif (isset($document['token_hash'])) {
            $document['_id'] = (string)$document['token_hash'];
        } else {
            throw new InvalidArgumentException('MongoDB inserts require a stable id or token_hash.');
        }
    }

    getMongoCollection(mongoCollectionName($table))->insertOne($document);
}

function mongoUpsert(string $table, array $filter, array $updates): void {
    getMongoCollection(mongoCollectionName($table))->updateOne(
        $filter,
        ['$set' => $updates],
        ['upsert' => true],
    );
}

function mongoDelete(string $table, array $filter): int {
    return getMongoCollection(mongoCollectionName($table))->deleteMany($filter)->getDeletedCount();
}

function mongoWithTransaction(callable $operation): mixed {
    $session = getMongoDatabase()->getManager()->startSession();
    $session->startTransaction();
    try {
        $result = $operation($session);
        $session->commitTransaction();
        return $result;
    } catch (Throwable $error) {
        if ($session->isInTransaction()) {
            try {
                $session->abortTransaction();
            } catch (Throwable $abortError) {
                error_log('MongoDB transaction abort failed: ' . $abortError->getMessage());
            }
        }
        throw $error;
    } finally {
        $session->endSession();
    }
}

function verifyMongoConnection(): void {
    getMongoDatabase()->command(['ping' => 1]);
}
