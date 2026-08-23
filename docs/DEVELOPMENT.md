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

Docker Compose provides the local PostgreSQL runtime. The API connects to it when `ConnectionStrings:DefaultConnection` is provided. Copy the safe development template and start the service:

```sh
cp .env.example .env
docker compose up -d
docker compose ps
```

Check startup output with `docker compose logs --no-color postgres`, then stop the local service with `docker compose down`. Its named Docker volume preserves data between normal stops. To intentionally reset local database data, run `docker compose down --volumes`; this permanently deletes the local PostgreSQL data volume.

When running the API locally, provide its required database connection string, participant-session lifetime, and Room lifetime through the standard configuration keys. Both lifetimes are positive .NET `TimeSpan` values; their deployment values are explicit operational policies rather than application defaults. Do not commit the database credential:

```sh
export ConnectionStrings__DefaultConnection='Host=127.0.0.1;Port=5433;Database=duovie;Username=duovie;Password=<your-local-password>'
export ParticipantSessions__Lifetime='<positive-TimeSpan>'
export Rooms__Lifetime='<positive-TimeSpan>'
dotnet run --project backend/src/Duovie.Api
```

The API exposes `GET /health/live` for process liveness and `GET /health/ready` for database readiness. Liveness does not require PostgreSQL; readiness reports unhealthy when the configured database cannot be reached.

## Room HTTP API

- `POST /api/rooms` creates a Room using the server-configured `Rooms:Lifetime` and returns the server-generated Host participant session.
- `POST /api/rooms/{roomId}/join` joins an available Room and returns the server-generated Guest participant session.

These endpoints accept no participant identity, role, or credential input. Successful responses include a bearer-style participant credential in the response body and use `Cache-Control: no-store`; clients must treat that credential as sensitive. A Room Id identifies the Room but grants no participant or Host authority. Room closure is not exposed because the canonical product rules do not yet define who may close a Room.

## Room realtime presence

`/hubs/room` is the SignalR endpoint for authorized Room presence. Clients provide the intended Room Id as connection metadata and use SignalR's conventional access-token transport for the existing participant credential. SignalR may send that credential as a bearer header or as its standard `access_token` query value for browser WebSocket and Server-Sent Events transports; it is accepted only by the Room Hub, never persisted or logged, and is not a JWT. HTTPS is mandatory for production credential transport. Duovie suppresses only the default ASP.NET Core Hosting Information-level request URL logs that could expose query tokens; production reverse proxies and hosting-platform access logs must likewise be configured not to record sensitive query values.

The Hub validates the credential against the intended Room before deriving the trusted participant identity, adding its Room-scoped group membership, or publishing presence. It rejects missing, malformed, expired, wrong-Room, closed-Room, and expired-Room connections without broadcasting credentials or persistence data. Presence is an API-runtime-only, single-instance registry: multiple live connections for one participant remain one logical online presence until the final connection disconnects. It is not persisted and will require coordinated presence/backplane design before multi-instance deployment.

The same trusted Hub identity authorizes ephemeral Room chat. Clients send plain text only; the server trims only its outer whitespace, rejects empty input, and enforces a 2,000 UTF-16-character maximum after trimming. The server generates the message identifier, sender identity, role, and UTC timestamp. Message contents must not be logged. Messages are neither stored nor replayed to later connections. The future React client must render this plain-text payload as text rather than injected HTML.

The authenticated Room Hub also relays ephemeral WebRTC signaling: the Host sends Offers to the Guest, the Guest sends Answers to the Host, and both roles exchange ICE candidates. Sender identity and the opposite-role destination are derived by the server from the trusted connection; clients cannot select either. SDP and ICE content are bounded, are not persisted or replayed, and must not be logged because candidates may disclose network information. This relay creates no peer connection and carries no media; browser `RTCPeerConnection` work begins in Stage 4.

## Database migrations

Restore the repository-pinned EF Core tool before creating or applying migrations:

```sh
dotnet tool restore
dotnet ef migrations add <MigrationName> --project backend/src/Duovie.Infrastructure --startup-project backend/src/Duovie.Api --output-dir Persistence/Migrations
dotnet ef database update --project backend/src/Duovie.Infrastructure --startup-project backend/src/Duovie.Api
```

EF Core tooling uses an Infrastructure-only design-time context factory, so `migrations add` and `migrations has-pending-model-changes` need no application configuration and do not connect to a database. `database update` uses `ConnectionStrings__DefaultConnection` when it is supplied; it does not require `ParticipantSessions__Lifetime`. Migrations are applied explicitly; the API does not migrate the database automatically at startup.
