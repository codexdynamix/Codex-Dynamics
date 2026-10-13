<?php
/**
 * Codex Dynamics - MongoDB Configuration for Hostinger Shared Hosting
 *
 * 1. Enable 'mongodb' in Hostinger hPanel -> Advanced -> PHP Configuration -> PHP Extensions
 * 2. MongoDB Atlas cluster credentials configured below.
 */

return [
    // MongoDB Atlas URI
    'mongodb_uri' => 'mongodb+srv://codexdynamics:Qwerty100@cluster0.6shrdkk.mongodb.net/?appName=Cluster0',

    // Database name in MongoDB
    'mongodb_database' => 'codex_dynamics',

    // Default Super Admin credentials for bootstrap
    'admin_email' => 'admin@codexdynamics.com',
    'admin_password' => 'admin123',

    // Allowed CORS Origins
    'cors_allowed_origins' => '*',
];
