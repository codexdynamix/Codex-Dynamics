<?php
declare(strict_types=1);

putenv('API_STORAGE=mongodb');
putenv('MONGODB_URI=mongodb://localhost');
putenv('MONGODB_DATABASE=codex_dynamics_migration');

$_SERVER['REQUEST_METHOD'] = $argv[1] ?? 'GET';
$_SERVER['REQUEST_URI'] = '/api' . ($argv[2] ?? '/admin/me');
$_SERVER['HTTP_HOST'] = 'localhost';
$_SERVER['SCRIPT_NAME'] = '/api/index.php';
if (isset($argv[3])) {
    $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $argv[3];
}

require dirname(__DIR__) . '/index.php';
