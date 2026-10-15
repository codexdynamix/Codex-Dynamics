# Codex Dynamics - Hostinger Shared Hosting Deployment Guide (PHP + MongoDB)

This guide walks you through deploying Codex Dynamics with **PHP 8.0+** and **MongoDB (Atlas)** on Hostinger Shared Hosting.

---

## 1. Enable MongoDB Extension in Hostinger hPanel

1. Log into your **Hostinger hPanel** (https://hpanel.hostinger.com).
2. Go to **Websites** → click **Manage** next to your domain.
3. In the left menu, search for or click **PHP Configuration** (under *Advanced*).
4. Select **PHP 8.1** or **PHP 8.2** (recommended).
5. Switch to the **PHP Extensions** tab.
6. Scroll down to find **`mongodb`** and check the box to enable it.
7. Click **Save** at the bottom of the page.

---

## 2. Configure MongoDB Atlas Connection

1. Set `MONGODB_URI` and `MONGODB_DATABASE` in your hosting environment. MongoDB connection details should not be committed to `config.php`.
   ```php
   return [
       'mongodb_uri' => getenv('MONGODB_URI') ?: '',
       'mongodb_database' => getenv('MONGODB_DATABASE') ?: 'codex_dynamics',
       'admin_email' => 'admin@codexdynamics.com',
       'admin_password' => 'Codex2025!',
   ];
   ```
   Requests fail with `503 Service Unavailable` when MongoDB is not configured or cannot be reached; the API does not serve fallback data.
2. In MongoDB Atlas, ensure your **Network Access** IP Access List allows connections from Hostinger (or `0.0.0.0/0` with strong database user credentials).

---

## 3. Build & Upload to Hostinger

1. Run the production build command on your machine:
   ```bash
   npm run build
   ```
2. In Hostinger hPanel, open **File Manager** and open the **`public_html`** directory.
3. Upload all files from `dist/` directly into `public_html/`.
4. Upload the `public/api/` folder so it sits at `public_html/api/`.

Your file structure in Hostinger `public_html` will look like:
```
public_html/
├── assets/
├── favicon.svg
├── index.html
├── api/
│   ├── .htaccess
│   ├── config.php
│   └── index.php
```

---

## 4. Verify Your Deployment

Open your browser and visit:
* `https://yourdomain.com/api/healthz`
It will return:
```json
{
  "ok": true,
  "storage": "mongodb",
  "database": "codex_dynamics",
  "php_mongodb_extension": true,
  "connected": true
}
```

* `https://yourdomain.com/` — Live Agency Website
* `https://yourdomain.com/admin` — Admin CRM Backoffice
* `https://yourdomain.com/portal` — Client Portal
