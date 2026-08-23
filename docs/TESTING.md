# Testing strategy

## Planned test pyramid

- **Unit tests:** domain rules and application behavior, especially capacity, roles, lifecycle validation, and authorization decisions.
- **Integration tests:** HTTP and realtime authorization where practical, persistence/configuration boundaries, and future endpoints such as protected TURN credential issuance.
- **Frontend tests:** Vitest and React Testing Library are planned for UI and feature behavior.
- **Browser tests:** Playwright Chromium runs the real frontend, API, PostgreSQL persistence, SignalR, and same-machine WebRTC flow. Broader browser/network coverage remains later work.

Important future cases include rejection of a third participant; blocked Guest Host-only actions; incorrect joins to expired/closed rooms; invalid participant sessions; and protection against anonymous TURN-credential abuse when authorization is required.

Stage 6.1 added integration coverage for `GET /api/rooms/{roomId}/ice-servers`: the same missing/malformed/unknown/expired/wrong-Room/closed-Room rejection matrix as the session-resume endpoint, `Cache-Control: no-store`, no participant credential or Cloudflare long-lived secret echoed in the response, no database mutation, and TURN-disabled local mode working without any Cloudflare secret. A separate `CloudflareTurnCredentialProvider` test suite uses a fake `HttpMessageHandler` (never the real Cloudflare service) to prove the configured `Authorization` header and TTL are sent, a valid response maps to the provider-neutral shape, malformed/failed provider responses degrade to an empty result without throwing, and no token/credential/raw response body is ever logged. A hanging fake handler with a short (millisecond-scale) `HttpClient.Timeout` proves the provider degrades quickly rather than blocking Room Hub startup, that the timeout warning never contains the API token, that a genuinely cancelled request propagates instead of being logged as a misleading provider failure, and (via `IceServerProvisioningServiceTests`) that configured baseline STUN still comes back when TURN credential generation times out—all without any test waiting real wall-clock seconds.

Room persistence integration tests use Testcontainers with an isolated PostgreSQL 18 container. Docker must be running for `dotnet test backend/Duovie.sln`; the tests do not use `.env`, developer database credentials, or existing local database state.

## Browser E2E

Install only Playwright's required Chromium once, then run the complete E2E workflow from `frontend/`:

```sh
npx playwright install chromium
npm run test:e2e
```

The command starts a dedicated `duovie-e2e` PostgreSQL 18 container from `docker-compose.e2e.yml`, backed by container `tmpfs` rather than the development volume; builds the backend; applies existing migrations to the isolated E2E database; starts the real HTTPS API and Vite proxy through Playwright `webServer`; runs Chromium; and removes the E2E container/network in a `finally` cleanup. It never runs `docker compose down -v` and does not read, reset, or delete the normal development database. If the runner is forcibly terminated, clean up only its isolated resources with `docker compose -p duovie-e2e -f docker-compose.e2e.yml down`.

Host, Guest, and unauthenticated/capacity-check participants use separate BrowserContexts; Duplicate Tab behavior is not used. The current scenario verifies Room URL safety, no inherited authority, automatic Host-initiated P2P, connected/connected/stable peer states, bounded fresh-peer recovery through a diagnostic disruption, Host/Guest refresh continuity, third-participant rejection, Reset Session, and Back/Forward runtime teardown. The test does not select or fake the operating-system display picker.

## WebRTC validation

WebRTC cannot be trusted through unit tests alone. Playwright now covers real same-machine Chromium P2P with separate authority contexts, but later real-browser validation should still cover Chrome ↔ Chrome, Chrome ↔ Edge, Edge ↔ Chrome, Safari ↔ Chrome, Chrome ↔ Safari, and Safari ↔ Safari; same and different networks, hotspots, forced TURN, interruption/recovery, and long sessions.

The real `getDisplayMedia` picker and visible captured-content quality remain manual browser/operating-system smoke boundaries. Stage 5.1's Chrome-on-macOS acceptance remains canonical. Audio is deferred; capability differences must be handled gracefully rather than assumed away.

Stage 6.1 added frontend coverage for ICE server provisioning: the API client sends the participant credential only in `Authorization` and never persists a returned TURN credential; `RoomRuntime` fetches ICE configuration once per session before the Hub connects (so no presence race can create a peer with a stale empty list), passes the same in-memory configuration to `WebRtcPeerController` for Host and Guest peer creation and for every fresh peer created during bounded automatic recovery, falls back to an empty configuration without failing the Room session when the fetch fails, and fetches fresh configuration again for a new `RoomRuntime` instance (refresh/replacement). The Playwright E2E suite runs with Cloudflare TURN explicitly disabled and no STUN configured, so it continues to prove only real same-machine host-candidate P2P; it does not and cannot prove TURN relay behavior.

Stage 6.2 added a development/test-only `iceTransportPolicy` seam (`resolveDevIceTransportPolicy`, `VITE_DUOVIE_DEV_ICE_TRANSPORT_POLICY=relay`) with automated coverage proving: it resolves to `"all"` by default and for any unrecognized value; it resolves to `"relay"` only when both `import.meta.env.DEV` is true and the override is exactly `"relay"`; a non-development build (the value used when running the real production build) always yields `"all"` regardless of the override; the resolved value is threaded through `RoomRuntime`/`WebRtcPeerController` into `RTCPeerConnection` for Host and Guest peer creation and stays the same configured value across bounded automatic peer recovery and automatic Hub reconnect; and configured `iceServers` remain unaffected by the policy. Separately, direct inspection of the built production bundle (both with and without the override environment variable set at build time) confirmed the `import.meta.env.DEV` check is hardcoded `false` in the compiled call site, so a production build cannot be made to force relay under any circumstance.

That seam was then used for a real, manually run, same-machine acceptance check with real Cloudflare TURN credentials configured on the backend: forcing `iceTransportPolicy: "relay"` produced a succeeded relay↔relay candidate pair over `turn:turn.cloudflare.com:3478?transport=udp` carrying real traffic, with `connected`/`connected`/`stable` states and additional TURN/TCP and TURNS/443 relay candidates also gathered as fallback transports; a `stun:*:53` attempt timed out, which is expected and does not indicate a TURN failure since the primary UDP/3478 relay path succeeded. Combined with the existing normal-mode (`iceTransportPolicy: "all"`) same-machine E2E proof of direct P2P, Duovie now has evidence that both the direct-P2P path and the real Cloudflare TURN relay path work. This remains a same-machine check, not a substitute for real cross-network/different-device TURN acceptance (one participant on ordinary Wi-Fi, the other on a separately networked connection such as cellular/mobile hotspot, using normal production-style `iceTransportPolicy: "all"` with automatic direct-or-TURN selection, confirming Host screen video actually reaches the Guest), which remains the final Stage 6 milestone.
