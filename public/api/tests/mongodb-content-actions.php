<?php
declare(strict_types=1);

require dirname(__DIR__) . '/lib/mongodb.php';
require dirname(__DIR__) . '/lib/core.php';

function expectContentSame(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException($message);
    }
}

function expectContentTrue(bool $actual, string $message): void
{
    if (!$actual) {
        throw new RuntimeException($message);
    }
}

$apiPath = '/__test__';
$method = 'GET';
$input = [];
$pdo = null;
$adminSession = null;
$_SERVER['REQUEST_METHOD'] = 'GET';
require dirname(__DIR__) . '/routes/03-crm-actions.php';
require dirname(__DIR__) . '/routes/04-admin-client-search.php';

expectContentSame(
    ['$or' => [['id' => 12], ['id' => '12']]],
    mongoContentIdFilter(12),
    'Content updates must match imported integer and string IDs without using _id.',
);
expectContentSame(
    'hello-world-42-',
    mongoContentSlugFromTitle('Hello World 42!'),
    'Blog slug generation must preserve the existing title-to-slug behavior.',
);
expectContentSame(
    ['settings' => ['platformName' => 'Codex'], 'site_config' => ['hero' => 'Welcome'], 'updated_at' => 'now'],
    mongoContentPlatformSettingsRecord([
        'settings_json' => '{"platformName":"Codex"}',
        'site_config_json' => '{"hero":"Welcome"}',
        'updated_at' => 'now',
    ]),
    'MongoDB platform settings must preserve the JSON-string record shape.',
);
expectContentSame(
    ['settings' => [], 'site_config' => null, 'updated_at' => null],
    mongoContentPlatformSettingsRecord(null),
    'Missing platform settings must return the established empty response shape.',
);
expectContentSame(
    ['settings' => ['platformName' => 'Codex'], 'site_config' => null, 'updated_at' => null],
    mongoContentPlatformSettingsRecord(['settings_json' => ['platformName' => 'Codex']]),
    'Already-decoded imported settings must be accepted.',
);
expectContentSame(
    ['homepage' => ['headline' => 'Preserve this']],
    mongoContentNextSiteConfig(
        ['site_config' => ['homepage' => ['headline' => 'Preserve this']]],
        null,
        false,
    ),
    'Updating platform settings without site_config must preserve the current site configuration.',
);
expectContentSame(
    null,
    mongoContentNextSiteConfig(
        ['site_config' => ['homepage' => ['headline' => 'Replace this']]],
        null,
        true,
    ),
    'An explicit null site_config must clear the current site configuration.',
);
expectContentTrue(
    mongoContentSuperAdminIsActive(['status' => 'Active', 'role' => 'Super Admin']),
    'An active, non-deleted Super Admin must pass the MongoDB content role check.',
);
expectContentSame(
    false,
    mongoContentSuperAdminIsActive(['status' => 'Active', 'role' => 'Agent']),
    'Non-super-admin staff must not pass the MongoDB content role check.',
);
expectContentSame(
    false,
    mongoContentSuperAdminIsActive(['status' => 'Active', 'role' => 'Super Admin', 'deleted_at' => 'now']),
    'Deleted Super Admin accounts must not pass the MongoDB content role check.',
);
expectContentSame(
    false,
    mongoContentIsDuplicateKey(new RuntimeException('unrelated failure')),
    'Unrelated storage failures must not be reported as slug conflicts.',
);
expectContentTrue(
    mongoContentIsDuplicateKey(new RuntimeException('duplicate', 11000)),
    'MongoDB duplicate-key errors must be recognizable for a 409 response.',
);

fwrite(STDOUT, "MongoDB content-action helper tests passed.\n");
