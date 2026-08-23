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

Each reconnect is a new authenticated Hub connection: the client resubmits the Room Id and participant credential, and the server revalidates the session and Room before restoring trusted identity, groups, presence, and a fresh snapshot. The final live connection disconnecting emits offline immediately; another live duplicate prevents a false offline transition, and no reconnect grace timer is used. Established connections are not continuously revalidated as time advances, but reconnect fails after session expiry or Room closure/expiry. Chat and signaling remain ephemeral and are never replayed after reconnect.

## Stage 4 peer development harness

Start PostgreSQL and the API as described above with the `https` launch profile. The repository uses `https://127.0.0.1:7245` for this local profile. In another terminal, start Vite so its same-origin development proxy can forward both HTTP API traffic and Room Hub WebSockets. The proxy accepts only the local development certificate; this does not alter production TLS behavior. If that port is unavailable, override both the API launch URL and the proxy's `DUOVIE_API_ORIGIN` locally.

```sh
dotnet run --project backend/src/Duovie.Api --launch-profile https
```

```sh
cd frontend
npm run dev
```

Open `/dev/peer` in two current desktop browser tabs. In the Host tab, create a Room and copy only its displayed Room ID. In the Guest tab, enter that Room ID and join. Both actions connect their server-issued participant session to the Room Hub. The opaque participant credential is held in memory only; it is never displayed, copied, or persisted. SignalR client logging starts at Warning so its successful WebSocket URL information message cannot place the conventional `access_token` query value in the browser console.

After both roles show online, the Host can select **Start P2P**. The Host creates one trackless, `sendonly` video transceiver and a real browser Offer; the Guest applies it and creates the Answer; and both browsers relay real ICE candidates through SignalR. The status panel distinguishes Hub connectivity from WebRTC connection, ICE, gathering, and signaling state.

One negotiation attempt is active at a time. Setup or signaling failure disposes that peer and requires the explicit **Reset Peer** action before retry. Reset Peer clears queued ICE and creates no replacement automatically; it preserves the Room session and connected Hub, so both tabs can reset and the Host can start a fresh generation without recreating the Room. Duplicate or wrong-state SDP fails safely. Generation guards prevent callbacks and async continuations owned by an old peer from sending for a replacement peer. The Stage 4 one-negotiation protocol has no negotiation identifier, so both participants must reset before a deliberate retry; multi-negotiation generation identifiers belong to a later design if renegotiation is introduced.

Peer `failed` or `closed` state disposes the active peer and requires Reset Peer. `disconnected` remains visible and may recover naturally; Stage 4 adds no timer, ICE restart, automatic renegotiation, or automatic peer retry. A final logical offline presence event for the opposite role resets the peer, while Stage 3 duplicate-connection presence semantics prevent a non-final disconnect from causing teardown.

An unexpected or harness-requested Hub disconnect permanently closes its peer controller and clears pending ICE. **Reconnect Hub** is explicit rather than automatic and installs a fresh controller after the server revalidates the retained participant session. The Room ID and opaque credential remain only in that tab's memory while this reconnect option is shown. **Reset Session**, refresh, teardown, or session replacement stops the Hub and removes that in-memory session and credential.

This harness proves only the trackless peer transport foundation. It does not request camera, microphone, or screen permission and carries no media. The Host sender track remains `null`; no data channel is created. `iceServers` is intentionally empty, so same-machine connectivity is the Stage 4 target; STUN/TURN, NAT reliability, and ICE restart belong to Stage 6.

### Stage 4 browser verification

Task 4.2 verification on 2026-08-23 had only the Codex in-app browser automation surface available. That real browser surface completed Host-to-Guest same-machine P2P three times: initial connection, peer-only reset/retry in the same Room, and explicit Guest Hub disconnect/reconnect followed by a fresh connection. Each final peer state was `connected`, ICE was `connected`, signaling was `stable`, the Host sender track was `null`, no permission prompt appeared, and the corrected console contained no warning, error, credential, SDP, or ICE payload.

| Matrix case | Result |
| --- | --- |
| Codex in-app browser Host -> Codex in-app browser Guest | EXECUTED — connected; peer reset/retry and Hub disconnect/reconnect passed. This is recorded separately and is not labeled Chrome. |
| Chrome Host -> Chrome Guest | NOT EXECUTED — Chrome was not exposed to this automation environment. |
| Edge Host -> Edge Guest | NOT EXECUTED — Edge was not exposed to this automation environment. |
| Safari Host -> Safari Guest | NOT EXECUTED — Safari was not exposed to this automation environment. |
| Chrome Host -> Safari Guest | NOT EXECUTED — Chrome and Safari were not exposed to this automation environment. |
| Safari Host -> Chrome Guest | NOT EXECUTED — Safari and Chrome were not exposed to this automation environment. |

For each unexecuted row, run the same short human check: open `/dev/peer` in a Host tab in the browser before the arrow and a Guest tab in the browser after it; create and join one Room; confirm both roles online; select Start P2P; record connection, ICE, and signaling states plus console warnings/errors and permission prompts; select Reset Peer in both tabs and retry; then disconnect the Guest Hub, confirm Host peer cleanup, reconnect it explicitly, and establish a fresh peer. The expected final states are `connected` / `connected` / `stable`, Host sender track `null`, no permission prompt, and no sensitive console output.

## Database migrations

Restore the repository-pinned EF Core tool before creating or applying migrations:

```sh
dotnet tool restore
dotnet ef migrations add <MigrationName> --project backend/src/Duovie.Infrastructure --startup-project backend/src/Duovie.Api --output-dir Persistence/Migrations
dotnet ef database update --project backend/src/Duovie.Infrastructure --startup-project backend/src/Duovie.Api
```

EF Core tooling uses an Infrastructure-only design-time context factory, so `migrations add` and `migrations has-pending-model-changes` need no application configuration and do not connect to a database. `database update` uses `ConnectionStrings__DefaultConnection` when it is supplied; it does not require `ParticipantSessions__Lifetime`. Migrations are applied explicitly; the API does not migrate the database automatically at startup.
