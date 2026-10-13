# MongoDB data migration

The API currently uses PDO with SQLite or MySQL. Installing the MongoDB PHP
library or pinging Atlas does not change the API's persistence. The importer in
`bin/migrate-sqlite-to-mongodb.php` copies SQLite rows into isolated staging
collections; it does not switch API routes to MongoDB.

## Requirements

- PHP 8.1+ CLI with `pdo_sqlite` and the MongoDB extension enabled.
- The Composer dependencies from this directory installed (`composer install`).
- A MongoDB Atlas URI supplied only as the server-side `MONGODB_URI` environment
  variable. Never put it in source control or a browser-visible variable.
- The SQLite database that should be migrated. By default this is
  `data/codex.sqlite` at the repository root. Set `CODEX_SQLITE_PATH` to select
  a different source file.

The destination database defaults to `codex_dynamics_migration` to avoid
touching application collections. The API's MongoDB reader uses the same
default. Set `MONGODB_DATABASE` explicitly in the server environment to
override it.

## Run and verify

From the repository root, first run the read-only inventory:

```sh
php public/api/bin/migrate-sqlite-to-mongodb.php --dry-run
```

Review the table and row counts. Then run the import:

```sh
php public/api/bin/migrate-sqlite-to-mongodb.php --apply
```

The importer creates one `legacy_<table>` collection per SQLite table and
preserves row fields. Each row gets a deterministic `_id`; small ordered
`$setOnInsert` batches make repeat runs non-destructive: an existing document
is never overwritten or pruned. SQLite primary/unique constraints are recreated
as MongoDB unique indexes, including partial indexes for nullable text keys so
multiple SQL `NULL` values remain valid. Expression, partial, non-text, invalid
UTF-8 unique keys, and non-binary collations are rejected rather than silently
weakening the source constraint. A changed source row with the same key is left
unchanged, so use a fresh staging database for a new snapshot rather than
expecting the importer to synchronize edits or deletions. Each table is checked
against its SQLite row count after import. Non-UTF-8 text values are stored as
BSON binary values. The SQLite source is never modified or deleted, and dry-run
mode never writes to MongoDB.

## Application cutover status

`API_STORAGE` is unset by default, so PDO remains the default. With
`API_STORAGE=mongodb`, the router dispatches the currently converted operations
to MongoDB using the imported `legacy_<table>` collections:

- `GET /public/content` and `GET /content` read projects, blogs, and reviews.
- `POST /admin/login`, `GET /admin/me`, and `POST /admin/logout` authenticate
  staff and validate/revoke staff sessions.
- `POST /portal/login` and `POST /portal/logout` authenticate clients and
  validate/revoke portal sessions.
- Public newsletter and inquiry intake, selected CRM project/blog/site-content
  actions, and platform-settings reads/writes.
- Admin client search (`GET /admin/users`) and client appointments
  (`GET|POST /admin/users/{id}/appointments`), scoped to the authenticated
  staff member's role and client assignments.
- Staff self-service password changes and the MongoDB Hostinger Mail
  integration, mailbox-assignment, and client mailbox routes. These dispatch
  through the Mongo-specific handler after the router validates the matching
  admin or portal session.
- Client portal dashboard/profile/ticket operations, selected notification,
  office/team/staff/audit reads and single-record actions, and selected project,
  chat, webhook, and staff-note operations.
- `GET /healthz` verifies the configured MongoDB connection and reports MongoDB
  persistence.

Auth/session lookups use the preserved row fields (`id`, `user_id`, `client_id`,
`token_hash`, and `expires_at`), not the imported document `_id`. Responses
allow-list account fields and never return password data or Mongo metadata.
Mongo session cookies retain the existing HttpOnly, SameSite, expiry, and
cookie-origin CSRF behavior. Client impersonation and operations that have not
been converted return HTTP 501 in Mongo mode. They are not allowed to fall
through to SQL handlers with Mongo-issued sessions or read/write a separate SQL
database by accident. Some multi-document operations remain intentionally
unsupported until their SQL transaction and uniqueness behavior can be
preserved.

Mongo connection/storage errors on migrated requests return a generic HTTP 503
response without exposing connection details. This is a deliberately partial
route migration, not a completed application-wide storage switch. The current
route tests do not exercise a live Atlas deployment. Do not enable MongoDB mode
for production traffic or remove the existing SQL database until every
required operation has been converted and tested against a representative
Atlas dataset. The staging collections are a migration copy, not a drop-in
replacement for the API's SQL tables.

The local `--dry-run` inventory only describes the SQLite file selected by
`CODEX_SQLITE_PATH` (or the repository's `data/codex.sqlite`). Confirm that it
is the authoritative source and review its row counts before using `--apply`;
an empty or preview SQLite database is not evidence that production data has
been migrated. The PHP MongoDB extension, server-side `MONGODB_URI`, and an
explicit production `MONGODB_DATABASE` are required for an actual Atlas import
and health check.

In production, set `MONGODB_DATABASE` explicitly; the migration database name
is only a local/development default.
