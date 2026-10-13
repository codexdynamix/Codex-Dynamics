<?php
declare(strict_types=1);

require dirname(__DIR__) . '/lib/mongodb-migration.php';

function migrationExpect(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function migrationExpectFailure(callable $operation, string $expectedText): void
{
    try {
        $operation();
    } catch (RuntimeException $error) {
        if (str_contains($error->getMessage(), $expectedText)) return;
        throw new RuntimeException('Unexpected migration-index validation error.', 0, $error);
    }
    throw new RuntimeException('Expected migration-index validation to fail.');
}

$source = new PDO('sqlite::memory:', null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);
$source->exec(
    'CREATE TABLE accounts ('
    . 'id TEXT PRIMARY KEY,'
    . 'email TEXT NOT NULL UNIQUE,'
    . 'workspace_id TEXT,'
    . 'external_id VARCHAR(64),'
    . 'UNIQUE (workspace_id, external_id)'
    . ')',
);

$definitions = migrationSqliteUniqueIndexes($source, 'accounts');
$byColumns = [];
foreach ($definitions as $definition) {
    $byColumns[implode(',', $definition['columns'])] = $definition;
}
migrationExpect(count($byColumns) === 3, 'Every SQLite primary/unique key must be discovered.');
migrationExpect(
    $byColumns['email']['nullable_columns'] === [],
    'A NOT NULL email index must remain a full unique MongoDB index.',
);
migrationExpect(
    $byColumns['id']['nullable_columns'] === ['id'],
    'Nullable SQLite primary-key compatibility must allow multiple null IDs.',
);
migrationExpect(
    $byColumns['workspace_id,external_id']['nullable_columns'] === ['workspace_id', 'external_id'],
    'Nullable composite keys must allow SQL-compatible null values.',
);

$emailOptions = migrationMongoUniqueIndexOptions($byColumns['email']);
migrationExpect($emailOptions['unique'] === true, 'MongoDB indexes must enforce uniqueness.');
migrationExpect(!isset($emailOptions['partialFilterExpression']), 'NOT NULL unique indexes must not be partial.');
$compositeOptions = migrationMongoUniqueIndexOptions($byColumns['workspace_id,external_id']);
migrationExpect(
    $compositeOptions['partialFilterExpression'] === ['$and' => [
        ['workspace_id' => ['$type' => 'string']],
        ['external_id' => ['$type' => 'string']],
    ]],
    'Nullable composite unique indexes must index only rows with every nullable key populated.',
);

migrationValidateUniqueIndexValues(
    ['id' => null, 'email' => 'account@example.com', 'workspace_id' => null, 'external_id' => null],
    $definitions,
    'accounts',
);
migrationExpectFailure(
    static fn() => migrationValidateUniqueIndexValues(
        ['id' => 'id-1', 'email' => "\xFF", 'workspace_id' => null, 'external_id' => null],
        $definitions,
        'accounts',
    ),
    'invalid UTF-8',
);

$source->exec('CREATE TABLE partial_keys (value TEXT)');
$source->exec('CREATE UNIQUE INDEX partial_keys_value ON partial_keys(value) WHERE value IS NOT NULL');
migrationExpectFailure(
    static fn() => migrationSqliteUniqueIndexes($source, 'partial_keys'),
    'partial unique index',
);

$source->exec('CREATE TABLE expression_keys (value TEXT)');
$source->exec('CREATE UNIQUE INDEX expression_keys_lower ON expression_keys(lower(value))');
migrationExpectFailure(
    static fn() => migrationSqliteUniqueIndexes($source, 'expression_keys'),
    'expression unique index',
);

$source->exec('CREATE TABLE collated_keys (value TEXT COLLATE NOCASE UNIQUE)');
migrationExpectFailure(
    static fn() => migrationSqliteUniqueIndexes($source, 'collated_keys'),
    'non-binary unique-index collation',
);

$source->exec('CREATE TABLE integer_keys (id INTEGER PRIMARY KEY, value TEXT)');
$integerIndexes = migrationSqliteUniqueIndexes($source, 'integer_keys');
migrationExpect(
    count($integerIndexes) === 1
        && $integerIndexes[0]['columns'] === ['id']
        && $integerIndexes[0]['nullable_columns'] === []
        && $integerIndexes[0]['integer_columns'] === ['id'],
    'SQLite INTEGER PRIMARY KEY rowids must be recreated as non-null MongoDB unique indexes.',
);
migrationValidateUniqueIndexValues(['id' => 7], $integerIndexes, 'integer_keys');

fwrite(STDOUT, "MongoDB migration-index validation passed.\n");
