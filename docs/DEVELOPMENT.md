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
- `GET /api/rooms/{roomId}/session` validates an existing opaque participant credential from `Authorization: Bearer <credential>` and returns the canonical server-derived Room and participant identity without echoing the credential.

Create and Join accept no participant identity, role, or credential input. Their successful responses include a bearer-style participant credential in the response body. Resume accepts no client role or participant identity and revalidates credential expiry, Room binding, current Room availability, and the participant's canonical role/identity before restoring a session. Missing, malformed, unknown, expired, wrong-Room, and unavailable-Room credentials receive the same non-leaking authentication failure. All three responses use `Cache-Control: no-store`. A Room Id identifies the Room but grants no participant or Host authority. Room closure is not exposed because the canonical product rules do not yet define who may close a Room.

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

Open `/dev/peer` in two current desktop browser tabs. Creating or joining moves that tab to `/dev/peer/{roomId}`. This URL contains only the Room locator: it can be shared with the other participant but grants no authority. A tab that opens it without a matching valid participant credential sees a Room-bound Join flow and does not inherit Host or Guest identity.

For same-tab refresh continuity, the accountless MVP stores only a schema version and the short-lived opaque participant credential in `sessionStorage`, keyed by Room Id. It does not store trusted role, participant Id, SDP, ICE, WebRTC/media state, chat, presence, share state, or SignalR state, and it never places the credential in the path, query, fragment, or History state. On refresh, the frontend sends the credential only in the resume endpoint's bearer header; role, participant Id, and Room binding come exclusively from the validated server response. Malformed or unusable stored values are cleared and fail back to unauthenticated Join. `sessionStorage` is a tab/browser-session MVP tradeoff, not a future account or durable authentication design; `localStorage` and cookies are intentionally not used for this credential flow.

A successful refresh restore reconnects the Room Hub and presence but creates a clean peer state. `RTCPeerConnection`, media tracks/streams, signaling, and screen-share activity are never serialized or automatically resumed; the Host explicitly starts P2P and sharing again. Browser Back/Forward navigation disposes the old runtime before applying the selected Room route, and stale restore results cannot populate a newer route. **Reset Session** stops peer/Hub activity and local capture, removes the current Room credential from `sessionStorage`, clears in-memory authority, and returns the tab to `/dev/peer` without deleting the persisted Room.

After both roles show online, the Host can select **Start P2P**. The Host creates one trackless, `sendonly` video transceiver and a real browser Offer; the Guest applies it and creates the Answer; and both browsers relay real ICE candidates through SignalR. The status panel distinguishes Hub connectivity from WebRTC connection, ICE, gathering, and signaling state.

One negotiation attempt is active at a time. Setup or signaling failure disposes that peer and requires the explicit **Reset Peer** action before retry. Reset Peer clears queued ICE and creates no replacement automatically; it preserves the Room session and connected Hub, so both tabs can reset and the Host can start a fresh generation without recreating the Room. Duplicate or wrong-state SDP fails safely. Generation guards prevent callbacks and async continuations owned by an old peer from sending for a replacement peer. The Stage 4 one-negotiation protocol has no negotiation identifier, so both participants must reset before a deliberate retry; multi-negotiation generation identifiers belong to a later design if renegotiation is introduced.

Peer `failed` or `closed` state disposes the active peer and requires Reset Peer. `disconnected` remains visible and may recover naturally; Stage 4 adds no timer, ICE restart, automatic renegotiation, or automatic peer retry. A final logical offline presence event for the opposite role resets the peer, while Stage 3 duplicate-connection presence semantics prevent a non-final disconnect from causing teardown.

An unexpected or harness-requested Hub disconnect permanently closes its peer controller and clears pending ICE. **Reconnect Hub** is explicit rather than automatic and installs a fresh controller for the already server-validated in-memory participant session. The Room Id and opaque credential remain scoped to that tab while this reconnect option is shown. **Reset Session**, teardown, or session replacement stops the Hub and removes the in-memory session; Reset Session also clears the Room-bound `sessionStorage` credential. A page refresh instead uses the server-validated continuity flow described above.

Stage 4 established the trackless peer transport foundation. Stage 5.1 adds Host-only display video: after P2P reaches `connected` / `stable`, the Host explicitly selects **Share Screen** and the browser-owned picker chooses a tab, window, or screen. The controller requests `getDisplayMedia({ video: true, audio: false })` and attaches the selected video track to the existing negotiated `sendonly` sender with `replaceTrack`; normal share start and stop do not renegotiate. The Guest wraps the received video track in a browser-local `MediaStream` when necessary and renders it through the development harness `<video>` element. Media remains browser-to-browser and never enters SignalR or the backend.

**Stop Sharing** and the browser-native sharing indicator both detach the track with `replaceTrack(null)` while keeping the peer available for another share. Chrome may keep the Guest receiver track live and retain its final frame after the Host detaches, without firing a corresponding remote `mute` or `ended` event. Duovie therefore sends a minimal, ephemeral `RoomScreenShareStateChanged` control-plane event from the authenticated Host to the trusted Guest role group. That event controls whether the development harness presents the retained stream as live; the underlying receiver remains reusable for a later `replaceTrack`, and media itself remains P2P. The state is not persisted or replayed and contains no media.

Peer failure, peer reset, Hub/session teardown, opposite-participant offline cleanup, and page teardown stop any owned capture track. When the Hub is still usable, active Host cleanup also sends the Guest an inactive state; a disconnected Hub instead relies on the existing trusted offline/reset lifecycle. Permission cancellation and attachment failure leave a healthy peer retryable and expose no browser-sensitive error detail. Display/system/tab audio, camera, microphone, data channels, and STUN/TURN are not included. Some DRM/HDCP-protected services or browser surfaces may block capture or produce a black frame; Duovie does not attempt to bypass browser, OS, or content-protection policy. `iceServers` remains empty until Stage 6.

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

### Stage 5.1 display-capture verification

Real Chrome-on-macOS human acceptance passed on 2026-08-23. The Host and Guest created and joined the same Room, both authorized Room Hub connections were connected, and both WebRTC peers reached `connected` / `connected` / `stable`. The Host used Chrome's real `getDisplayMedia` picker to select a browser tab; its video sender became attached and screen-share state active. The Guest received and visibly rendered changing video. Media remained browser-to-browser through WebRTC, and no audio was captured or sent.

Duovie **Stop Sharing** returned the Host sender to `null` and sharing state to inactive, stopped Chrome's sharing indicator, and preserved the connected P2P peer; the Guest immediately stopped representing the retained stream as active sharing. Repeat sharing on the same Room and negotiated peer connection resumed live Guest video without a new Room or renegotiation.

Chrome's native **Stop sharing / Paylaşmayı durdur** control was also verified after the share-state correction. The Host detected the local capture track ending, detached its sender, became inactive, and kept P2P connected. The trusted, ephemeral Host `active=false` SignalR lifecycle event reached the Guest, which immediately changed to not sharing; the retained receiver/`MediaStream` remained reusable, while its frozen final frame was hidden and not represented as live media. Chrome does not reliably emit remote `RTCRtpReceiver` track `mute` or `ended` events when the Host removes its sender with `replaceTrack(null)`, so this lifecycle event is authoritative only for UI/activity state. SignalR carries no video, the share state is not persisted, and video remains P2P WebRTC.

While sharing, **Reset Peer** stopped Host capture, removed Chrome's sharing indicator, reset the Host peer, and cleared the Guest's active-share representation. Recovery then passed: the Guest reset its failed old peer, the Host started a fresh P2P attempt, both peers returned to `connected` / `connected` / `stable`, and the Host shared successfully again. API runtime logs showed successful startup, Room create/join, participant-session persistence, and Room Hub negotiation/connections, with no application exception, HTTP 500, database error, or exposed credential value in the reviewed logs.

This completes Task 5.1 Chrome-on-macOS verification only. It does not claim Edge, Safari, mobile, audio sharing, STUN/TURN reliability, or Stage 5 completion.

## Database migrations

Restore the repository-pinned EF Core tool before creating or applying migrations:

```sh
dotnet tool restore
dotnet ef migrations add <MigrationName> --project backend/src/Duovie.Infrastructure --startup-project backend/src/Duovie.Api --output-dir Persistence/Migrations
dotnet ef database update --project backend/src/Duovie.Infrastructure --startup-project backend/src/Duovie.Api
```

EF Core tooling uses an Infrastructure-only design-time context factory, so `migrations add` and `migrations has-pending-model-changes` need no application configuration and do not connect to a database. `database update` uses `ConnectionStrings__DefaultConnection` when it is supplied; it does not require `ParticipantSessions__Lifetime`. Migrations are applied explicitly; the API does not migrate the database automatically at startup.
