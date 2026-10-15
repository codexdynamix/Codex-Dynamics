<?php
return [
    'mongodb_uri' => getenv('MONGODB_URI') ?: '',
    'mongodb_database' => 'codex_dynamics',
    'admin_email' => 'admin@codexdynamics.com',
    'admin_password' => 'Codex2025!',
    'cors_allowed_origins' => '*',
];
