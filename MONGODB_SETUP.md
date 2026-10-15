# MongoDB configuration

The CRM server reads `MONGODB_URI` and `MONGODB_DATABASE` at runtime. MongoDB
credentials must be provided separately to each development, CI, and deployment
environment; they are intentionally not stored in Git, so cloning or downloading
the repository does not copy the credential.

## Local development

1. Copy `.env.example` to `.env`.
2. Set `MONGODB_URI` in `.env` to the MongoDB connection string for this
   environment. Keep the value private.
3. Keep `.env` out of Git. The repository `.gitignore` already ignores it.
4. Start the server with `npm run dev`.

`MONGODB_DATABASE` defaults to `codex_dynamics` if it is not set.

## GitHub Actions

Add `MONGODB_URI` as an Actions secret in the repository, organization, or
GitHub environment settings. Map it into only the jobs that need database
access, for example:

```yaml
env:
  MONGODB_URI: ${{ secrets.MONGODB_URI }}
  MONGODB_DATABASE: codex_dynamics
```

Do not put the URI in workflow YAML, build arguments, logs, or client-prefixed
variables such as `VITE_MONGODB_URI`.

## Hosted runtime

Add `MONGODB_URI` as a server-side runtime secret in the hosting provider's
environment-variable settings, and add `MONGODB_DATABASE` if a non-default
database is required. Configure it for every deployment environment (such as
preview and production), then redeploy or restart the server so it takes effect.
Do not rely on a build-time-only variable for a long-running server.

Each fresh clone or new environment must be granted the secret through its
secret manager. This is required by design: a repository cannot safely carry a
private credential to arbitrary machines without committing the credential.
