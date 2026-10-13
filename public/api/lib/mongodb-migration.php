<?php
declare(strict_types=1);

function migrationQuoteSqliteIdentifier(string $identifier): string
{
    return '"' . str_replace('"', '""', $identifier) . '"';
}

function migrationSqliteUniqueIndexes(PDO $source, string $table): array
{
    $quotedTable = migrationQuoteSqliteIdentifier($table);
    $columns = [];
    foreach ($source->query('PRAGMA table_info(' . $quotedTable . ')') as $column) {
        $columns[(string)$column['name']] = $column;
    }

    $definitions = [];
    foreach ($source->query('PRAGMA index_list(' . $quotedTable . ')') as $index) {
        if ((int)$index['unique'] !== 1) continue;
        if ((int)($index['partial'] ?? 0) === 1) {
            throw new RuntimeException('Cannot preserve partial unique index ' . $index['name'] . ' on table ' . $table . '.');
        }

        $quotedIndex = migrationQuoteSqliteIdentifier((string)$index['name']);
        $indexColumns = [];
        $nullableColumns = [];
        foreach ($source->query('PRAGMA index_xinfo(' . $quotedIndex . ')') as $key) {
            if ((int)($key['key'] ?? 1) !== 1) continue;
            $name = $key['name'] ?? null;
            if (!is_string($name) || $name === '' || (int)($key['cid'] ?? -1) < 0) {
                throw new RuntimeException('Cannot preserve expression unique index ' . $index['name'] . ' on table ' . $table . '.');
            }
            if (strtoupper((string)($key['coll'] ?? 'BINARY')) !== 'BINARY') {
                throw new RuntimeException('Cannot preserve non-binary unique-index collation ' . $index['name'] . ' on table ' . $table . '.');
            }
            $column = $columns[$name] ?? null;
            if (!is_array($column)) {
                throw new RuntimeException('Unique index ' . $index['name'] . ' refers to an unknown column.');
            }
            $declaredType = strtoupper((string)($column['type'] ?? ''));
            if ($declaredType !== '' && !str_contains($declaredType, 'CHAR')
                && !str_contains($declaredType, 'CLOB') && !str_contains($declaredType, 'TEXT')) {
                throw new RuntimeException('Cannot safely preserve unique index ' . $index['name'] . ' with non-text key columns.');
            }
            $indexColumns[] = $name;
            if ((int)($column['notnull'] ?? 0) === 0) {
                $nullableColumns[] = $name;
            }
        }
        if ($indexColumns === []) {
            throw new RuntimeException('Unique index ' . $index['name'] . ' has no supported columns.');
        }

        $definitions[] = [
            'source_name' => (string)$index['name'],
            'columns' => $indexColumns,
            'nullable_columns' => $nullableColumns,
            'integer_columns' => [],
        ];
    }

    $primaryColumns = [];
    foreach ($columns as $column) {
        if ((int)($column['pk'] ?? 0) > 0) {
            $primaryColumns[(int)$column['pk']] = (string)$column['name'];
        }
    }
    ksort($primaryColumns);
    $primaryColumns = array_values($primaryColumns);
    if ($primaryColumns !== []) {
        $primarySignature = $primaryColumns;
        sort($primarySignature);
        $hasPrimaryIndex = false;
        foreach ($definitions as $definition) {
            $signature = $definition['columns'];
            sort($signature);
            if ($signature === $primarySignature) {
                $hasPrimaryIndex = true;
                break;
            }
        }
        if (!$hasPrimaryIndex) {
            $nullableColumns = [];
            $integerColumns = [];
            foreach ($primaryColumns as $name) {
                $column = $columns[$name];
                $isIntegerRowId = count($primaryColumns) === 1
                    && strtoupper(trim((string)($column['type'] ?? ''))) === 'INTEGER';
                if ($isIntegerRowId) {
                    $integerColumns[] = $name;
                }
                if (!$isIntegerRowId && (int)($column['notnull'] ?? 0) === 0) {
                    $nullableColumns[] = $name;
                }
            }
            $definitions[] = [
                'source_name' => 'PRIMARY KEY',
                'columns' => $primaryColumns,
                'nullable_columns' => $nullableColumns,
                'integer_columns' => $integerColumns,
            ];
        }
    }

    return $definitions;
}

function migrationMongoUniqueIndexOptions(array $definition): array
{
    $columns = $definition['columns'] ?? [];
    if (!is_array($columns) || $columns === []) {
        throw new InvalidArgumentException('A MongoDB unique index requires at least one column.');
    }
    foreach ($columns as $column) {
        if (!is_string($column) || !preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $column)) {
            throw new InvalidArgumentException('A MongoDB unique index contains an invalid column name.');
        }
    }

    $options = [
        'unique' => true,
        'name' => 'sql_unique_' . substr(hash('sha256', implode("\0", $columns)), 0, 24),
    ];
    $nullableColumns = $definition['nullable_columns'] ?? [];
    if (is_array($nullableColumns) && $nullableColumns !== []) {
        $conditions = [];
        foreach ($nullableColumns as $column) {
            if (!in_array($column, $columns, true)) {
                throw new InvalidArgumentException('A nullable unique-index column is not part of its index.');
            }
            $conditions[] = [$column => ['$type' => 'string']];
        }
        $options['partialFilterExpression'] = count($conditions) === 1
            ? $conditions[0]
            : ['$and' => $conditions];
    }

    return $options;
}

function migrationValidateUniqueIndexValues(array $row, array $definitions, string $table): void
{
    foreach ($definitions as $definition) {
        foreach ($definition['columns'] as $column) {
            $value = $row[$column] ?? null;
            $isIntegerKey = in_array($column, $definition['integer_columns'] ?? [], true);
            $isValid = $isIntegerKey
                ? is_int($value)
                : is_string($value) && preg_match('//u', $value) === 1;
            if ($value !== null && !$isValid) {
                throw new RuntimeException(
                    'Cannot preserve unique index ' . $definition['source_name'] . ' on table ' . $table
                    . ' because a key contains a non-text or invalid UTF-8 value.',
                );
            }
        }
    }
}
