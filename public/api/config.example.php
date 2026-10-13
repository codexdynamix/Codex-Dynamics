<?php
/**
 * Codex Dynamics - Database & Hostinger Shared Hosting Configuration
 * 
 * If using Hostinger MySQL / MariaDB, rename or copy this file to:
 *   config.php
 * and fill in your database details below.
 * 
 * If config.php is not present, Codex Dynamics automatically uses zero-config
 * SQLite stored safely in public/api/data/codex.sqlite.
 * Configure SESSION_SECRET as a stable server environment variable (at least
 * 32 characters). It encrypts credentials, including recoverable portal
 * passwords shown only in authorized CRM client-security profiles.
 */

return [
    // Hostinger MySQL Host (typically 'localhost' or '127.0.0.1' on Hostinger cPanel/hPanel)
    'db_host' => 'localhost',

    // Hostinger Database Name (e.g. 'u123456789_codex')
    'db_name' => 'codex_dynamics',

    // Hostinger Database Username (e.g. 'u123456789_admin')
    'db_user' => 'codex_user',

    // Hostinger Database Password
    'db_pass' => 'your_strong_password_here',

    // Optional first Super Admin, created on first request if this email doesn't exist yet.
    // Existing accounts are never changed. Remove these lines after the first login.
    // 'admin_email' => 'admin@example.com',
    // 'admin_password' => 'change-me',
];
