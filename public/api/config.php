<?php
/**
 * Runtime configuration for the Hostinger API.
 * Set MONGODB_URI in the hosting environment; credentials do not belong here.
 */

return [
    'mongodb_uri' => getenv('MONGODB_URI') ?: '',
    'mongodb_database' => getenv('MONGODB_DATABASE') ?: 'codex_dynamics',
    'admin_email' => getenv('ADMIN_EMAIL') ?: 'admin@codexdynamics.com',
    'admin_password' => getenv('ADMIN_PASSWORD') ?: 'Codex2025!',
    'cors_allowed_origins' => getenv('CORS_ALLOWED_ORIGINS') ?: '*',
];
