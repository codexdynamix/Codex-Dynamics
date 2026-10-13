<?php
/**
 * Local preview router for the PHP built-in server.
 * Sends /api/* to the Hostinger-style front controller and leaves
 * real files alone. The Vite dev server owns the public website.
 */
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if (str_starts_with($path, '/api')) {
    require __DIR__ . '/api/index.php';
    return true;
}
return false;
