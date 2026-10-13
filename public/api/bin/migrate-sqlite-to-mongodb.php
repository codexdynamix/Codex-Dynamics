<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/vendor/autoload.php';
require dirname(__DIR__) . '/lib/mongodb-migration.php';

use MongoDB\BSON\Binary;
use MongoDB\Client;

const MIGRATION_SOURCE = 'codex-dynamics-sqlite-v1';
const MIGRATION_BATCH_SIZE = 250;

function migrationUsage(): void
{
    fwrite(STDERR, "Usage: php public/api/bin/migrate-sqlite-to-mongodb.php [--dry-run|--apply]\n");
    fwrite(STDERR, "Set MONGODB_URI; optionally set MONGODB_DATABASE and CODEX_SQLITE_PATH.\n");
    exit(2);
}

function sourceSqlitePath(): string
{
    $configuredPath = getenv('CODEX_SQLITE_PATH');
    if (is_string($configuredPath) && $configuredPath !== '') {
        return $configuredPath;
    }

    return dirname(__DIR__, 3) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'codex.sqlite';
}

function quoteSqliteIdentifier(string $identifier): string
{
    return migrationQuoteSqliteIdentifier($identifier);
}

function migrationDocumentId(string $table, array $row, array $primaryKeyColumns): string
{
    $key = [];
    foreach ($primaryKeyColumns as $column) {
        $key[$column] = $row[$column];
    }

    if ($primaryKeyColumns === []) {
        $key = ['rowid' => $row['__codex_legacy_rowid']];
    } elseif (array_filter($key, static fn(mixed $value): bool => $value === null) !== []) {
        $key['rowid'] = $row['__codex_legacy_rowid'];
    }

    return 'sqlite:' . hash('sha256', $table . "\0" . serialize($key));
}

function makeMongoSafeRow(array $row): array
{
    unset($row['__codex_legacy_rowid']);
    foreach ($row as $column => $value) {
        if (is_string($value) && preg_match('//u', $value) !== 1) {
            $row[$column] = new Binary($value, Binary::TYPE_GENERIC);
        }
    }

    return $row;
}

function tablePrimaryKeyColumns(PDO $source, string $table): array
{
    $statement = $source->query('PRAGMA table_info(' . quoteSqliteIdentifier($table) . ')');
    $columns = $statement->fetchAll(PDO::FETCH_ASSOC);
    usort($columns, static fn(array $a, array $b): int => (int)$a['pk'] <=> (int)$b['pk']);

    return array_values(array_map(
        static fn(array $column): string => (string)$column['name'],
        array_filter($columns, static fn(array $column): bool => (int)$column['pk'] > 0),
    ));
}

function sourceTables(PDO $source): array
{
    $statement = $source->query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );

    return array_values(array_map('strval', $statement->fetchAll(PDO::FETCH_COLUMN)));
}

function main(array $arguments): int
{
    $mode = 'dry-run';
    foreach (array_slice($arguments, 1) as $argument) {
        if ($argument === '--apply') {
            $mode = 'apply';
        } elseif ($argument === '--dry-run') {
            $mode = 'dry-run';
        } else {
            migrationUsage();
        }
    }

    $sqlitePath = sourceSqlitePath();
    if (!is_file($sqlitePath)) {
        throw new RuntimeException('The configured SQLite source file does not exist: ' . $sqlitePath);
    }

    $source = new PDO('sqlite:' . $sqlitePath, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $source->exec('PRAGMA query_only = ON');
    $source->beginTransaction();
    $tables = sourceTables($source);
    if ($tables === []) {
        throw new RuntimeException('The SQLite source contains no user tables.');
    }

    $databaseName = trim((string)(getenv('MONGODB_DATABASE') ?: 'codex_dynamics_migration'));
    if (!preg_match('/^[A-Za-z0-9_-]{1,63}$/', $databaseName)) {
        throw new RuntimeException('MONGODB_DATABASE must be a valid short database name.');
    }

    $database = null;
    if ($mode === 'apply') {
        $uri = getenv('MONGODB_URI');
        if (!is_string($uri) || trim($uri) === '') {
            throw new RuntimeException('MONGODB_URI is required; provide it through the server environment.');
        }
        $database = (new Client($uri))->selectDatabase($databaseName);
    }
    $totals = ['tables' => count($tables), 'rows' => 0, 'written' => 0];
    fwrite(STDOUT, 'Mode: ' . $mode . PHP_EOL);
    fwrite(STDOUT, 'SQLite source: ' . $sqlitePath . PHP_EOL);
    fwrite(STDOUT, 'MongoDB destination database: ' . $databaseName . PHP_EOL);

    foreach ($tables as $table) {
        $collection = $database?->selectCollection('legacy_' . $table);
        $primaryKeyColumns = tablePrimaryKeyColumns($source, $table);
        $uniqueIndexes = migrationSqliteUniqueIndexes($source, $table);
        $quotedTable = quoteSqliteIdentifier($table);
        $rowidSelect = 'rowid AS "__codex_legacy_rowid", ';
        $statement = $source->query('SELECT ' . $rowidSelect . '* FROM ' . $quotedTable);
        $expectedRows = (int)$source->query('SELECT COUNT(*) FROM ' . $quotedTable)->fetchColumn();
        $tableRows = 0;
        $tableWritten = 0;
        $operations = [];

        while (($row = $statement->fetch(PDO::FETCH_ASSOC)) !== false) {
            $documentId = migrationDocumentId($table, $row, $primaryKeyColumns);
            migrationValidateUniqueIndexValues($row, $uniqueIndexes, $table);
            $document = makeMongoSafeRow($row);
            $document['_id'] = $documentId;
            $document['_migration_source'] = MIGRATION_SOURCE;
            $insertDocument = $document;
            unset($insertDocument['_id']);
            $operations[] = [
                'updateOne' => [
                    ['_id' => $documentId],
                    ['$setOnInsert' => $insertDocument],
                    ['upsert' => true],
                ],
            ];
            $tableRows++;

            if ($mode === 'apply' && count($operations) >= MIGRATION_BATCH_SIZE) {
                $collection?->bulkWrite($operations, ['ordered' => true]);
                $tableWritten += count($operations);
                $operations = [];
            }
        }

        if ($mode === 'apply' && $operations !== []) {
            $collection?->bulkWrite($operations, ['ordered' => true]);
            $tableWritten += count($operations);
        }

        if ($tableRows !== $expectedRows) {
            throw new RuntimeException('Source row count changed while reading table ' . $table . '.');
        }

        if ($mode === 'apply') {
            foreach ($uniqueIndexes as $uniqueIndex) {
                $indexKeys = array_fill_keys($uniqueIndex['columns'], 1);
                $collection?->createIndex($indexKeys, migrationMongoUniqueIndexOptions($uniqueIndex));
            }
            $storedRows = $collection?->countDocuments(['_migration_source' => MIGRATION_SOURCE]);
            if ($storedRows !== $expectedRows) {
                throw new RuntimeException(
                    'Verification failed for table ' . $table . ': expected ' . $expectedRows
                    . ' migrated rows, found ' . $storedRows . '.',
                );
            }
        }

        $totals['rows'] += $tableRows;
        $totals['written'] += $tableWritten;
        fwrite(
            STDOUT,
            sprintf(
                "%s: %d source rows%s\n",
                $table,
                $tableRows,
                ', ' . count($uniqueIndexes) . ' unique constraints'
                . ($mode === 'apply' ? ', ' . $tableWritten . ' insert-only upsert operations verified' : ''),
            ),
        );
    }

    $source->commit();
    fwrite(
        STDOUT,
        sprintf(
            "Complete: %d tables, %d source rows%s.\n",
            $totals['tables'],
            $totals['rows'],
            $mode === 'apply' ? ', ' . $totals['written'] . ' insert-only upsert operations verified' : ' (dry run only)',
        ),
    );
    if ($mode === 'dry-run') {
        fwrite(STDOUT, "No MongoDB documents were written. Re-run with --apply to copy into staging collections.\n");
    } else {
        fwrite(STDOUT, "The SQLite source was not modified or deleted. Existing MongoDB documents were neither overwritten nor pruned.\n");
    }

    return 0;
}

try {
    exit(main($argv));
} catch (Throwable $exception) {
    fwrite(STDERR, 'Migration failed: ' . $exception->getMessage() . PHP_EOL);
    exit(1);
}
