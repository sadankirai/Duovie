# Development conventions

- Use .NET 10 for backend work and Node.js 24 for frontend work; respect the repository pins in `global.json` and `.nvmrc`.
- Use dependency injection and preserve the Domain → Application → Infrastructure/API boundary. Prefer small, coherent changes.
- Use async APIs and cancellation where appropriate. Persist backend timestamps in UTC.
- Keep nullable/reference safety enabled and take warnings seriously. Follow normal C# and TypeScript conventions rather than inventing unnecessary local naming rules.
- Store configuration in settings/environment mechanisms appropriate to the environment. Never commit secrets, including TURN credentials.
- Organize frontend implementation by feature. Do not over-engineer state management before it is needed.
- Add or update relevant tests with behavior changes. Run relevant formatting, lint, build, and test checks before completion; do not report checks as passed unless run.
- Review migrations before accepting them when persistence work begins.
- New dependencies need a clear justification; architectural changes require explicit approval and an ADR update/new ADR as appropriate.

## Local PostgreSQL

Docker Compose provides the local PostgreSQL runtime; it is not connected to the application until Stage 1. Copy the safe development template and start the service:

```sh
cp .env.example .env
docker compose up -d
docker compose ps
```

Check startup output with `docker compose logs --no-color postgres`, then stop the local service with `docker compose down`. Its named Docker volume preserves data between normal stops. To intentionally reset local database data, run `docker compose down --volumes`; this permanently deletes the local PostgreSQL data volume.
