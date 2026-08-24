# Architecture

## Technology baseline

Backend: .NET 10 LTS (SDK pinned to 10.0.400), ASP.NET Core Web API with controllers where appropriate, C#, SignalR, dependency injection, EF Core 10, PostgreSQL, and xUnit. Frontend: React, TypeScript, Vite, Node.js 24, modern browser/WebRTC APIs, and the SignalR JavaScript client. Tailwind CSS is optional. Frontend and backend are separate applications; Razor Views are not the primary frontend.

## Planned backend shape

```text
backend/
├── Duovie.sln
├── src/
│   ├── Duovie.Domain/          business concepts and invariants
│   ├── Duovie.Application/     use cases and abstractions
│   ├── Duovie.Infrastructure/  EF Core, PostgreSQL, configuration/integrations
│   └── Duovie.Api/             controllers, hubs, middleware, runtime concerns
└── tests/
    ├── Duovie.UnitTests/
    └── Duovie.IntegrationTests/
```

Dependencies point inward. Domain contains concepts such as rooms, status, roles, and capacity rules, and does not depend on EF Core, PostgreSQL, SignalR, HTTP, ASP.NET Core, React, or a TURN vendor. Application contains use cases (for example create/join/close room and access validation). Infrastructure implements persistence, configuration-backed services, technical integrations, and eventual TURN credential issuance. API owns delivery concerns: controllers, SignalR hubs, authorization/session handling, rate limiting, health checks, and registrations.

## Planned frontend shape

```text
frontend/src/
├── features/     # room, chat, streaming, connection
├── components/
├── hooks/
├── services/
└── pages/
```

Organize primarily by feature. Avoid premature state-management complexity.

Room runtime lifecycle policy is feature-local and separate from rendering and WebRTC mechanics. The React Room screen projects `RoomRuntime` state and invokes product actions; `RoomRuntime` owns presence-driven negotiation, bounded fresh-peer recovery, and Hub/peer ownership; `RoomHubClient` owns SignalR transport; and `WebRtcPeerController` owns browser WebRTC and media operations. The Host is the only Offer initiator, preventing glare. A small trusted recovery-request event lets either failed peer ask the opposite runtime to replace its peer while the Host remains the deterministic initiator.

## Realtime and media boundaries

SignalR transports application events: presence, chat, offers/answers, ICE candidates, and connection events. WebRTC transports normal shared media directly peer-to-peer whenever possible. STUN/ICE facilitates connection establishment; TURN is only a fallback. TURN credentials must be server-issued and short-lived when needed—never permanent browser-exposed secrets. The backend must not proxy, transcode, record, or normally relay media.

### ICE server provisioning (Stage 6.1)

A provider-neutral `IIceServerProvisioningService`/`IceServerDescriptor` abstraction lives in Application; it knows nothing about Cloudflare or HTTP. Infrastructure implements it: `IceServerProvisioningService` combines configured baseline STUN (`IceServerOptions`, empty by default) with short-lived TURN entries from `CloudflareTurnCredentialProvider`, which holds the only reference to the long-lived Cloudflare TURN key/API token (`CloudflareTurnOptions`) and validates the provider's response into the provider-neutral shape before returning it—never the raw payload. Validation checks URL scheme (`stun:`/`turn:`/`turns:`), collection size, and required username/credential when a `turn:`/`turns:` URL is present; it does not strip individual provider-returned URLs by transport (UDP/TCP/TLS) or port—Duovie uses trickle ICE, so offering every valid candidate the provider returns is preferable to guessing which one a given network allows.

A TURN provider failure—network error, non-2xx, malformed response, **or the outbound Cloudflare call exceeding its explicit `HttpClient.Timeout` (5 seconds by default)**—degrades to baseline-only and is logged as a warning without the token, credentials, or raw response body; it never throws into the request pipeline and never blocks Room Hub startup for more than that bounded timeout. A genuinely cancelled request (the Room HTTP request itself aborting) is distinguished from that timeout and propagates normally instead of being logged as a misleading provider failure. `CloudflareTurn:Enabled=true` without `KeyId`/`ApiToken` fails fast at startup like other required configuration.

The participant-authenticated `GET /api/rooms/{roomId}/ice-servers` endpoint reuses the exact session/Room validation `GET /api/rooms/{roomId}/session` already performs (opaque bearer credential, expiry, Room binding, Room availability, server-derived role) before calling the provisioning service and returning `Cache-Control: no-store`. It never echoes the participant credential or Cloudflare's long-lived secret; only the short-lived TURN username/credential the browser needs reaches the response, because WebRTC requires it there.

On the frontend, `RoomRuntime` fetches ICE configuration once per participant session—before the Hub connects, so no presence-triggered peer creation can race ahead with a stale empty list—and keeps the result only in memory for that instance's lifetime; it is never written to `sessionStorage`/`localStorage`. A fetch failure falls back to an empty/baseline configuration rather than failing the Room session. Every `createPeer()` call (initial negotiation, offer handling, and bounded peer recovery) passes the same in-memory list into `WebRtcPeerController`, which threads it straight through to `new RTCPeerConnection({ iceServers, iceTransportPolicy })`; refresh and complete `RoomRuntime` replacement each obtain a fresh fetch, matching how the participant session itself is re-validated rather than restored from storage.

### Development-only forced-relay seam (Stage 6.2)

`RoomRuntimeDependencies.iceTransportPolicy` is always `"all"` in production. `resolveDevIceTransportPolicy(isDevBuild, configuredPolicy)` (`frontend/src/features/peer/iceTransportPolicy.ts`) resolves to `"relay"` only when both the literal `import.meta.env.DEV` (checked at the call site, so Vite's build-mode replacement applies) is true and `VITE_DUOVIE_DEV_ICE_TRANSPORT_POLICY` is exactly `"relay"`; otherwise it is `"all"`. There is no query-string, Room URL, or storage-based switch, no UI control, and no change to participant authority or to the peer/Hub recovery architecture—only the same static configuration value already threaded alongside `iceServers` gains one more field. Direct inspection of the built production bundle, with and without the override variable set at build time, confirmed the `import.meta.env.DEV` check compiles to a hardcoded `false` at the call site, so a production build cannot honor the override under any circumstance.

This seam was used for a real, manually run, same-machine Cloudflare TURN relay acceptance check with real backend Cloudflare TURN credentials configured: forcing `iceTransportPolicy: "relay"` produced a succeeded relay↔relay candidate pair over `turn:turn.cloudflare.com:3478?transport=udp` carrying real traffic, with `connected`/`connected`/`stable` peer states; additional TURN/TCP and TURNS/443 relay candidates were also gathered as fallback transports, and a `stun:*:53` attempt timing out is expected (not a TURN failure) since the primary UDP/3478 relay path succeeded. Production always uses `"all"`, direct P2P remains preferred, and TURN remains fallback only.

Real cross-network/different-device acceptance under normal `iceTransportPolicy: "all"` has since also passed — a Mac Host on ordinary Wi-Fi and a phone Guest on a cellular network reached a `connected`/`completed` `srflx ↔ srflx` selected pair automatically, with Host screen video reaching the Guest and Cloudflare relay candidates gathered but unused. Combined with the forced-relay result above, both the direct cross-network P2P path and the real Cloudflare TURN relay path are proven, and Stage 6 is complete.

WebRTC, presence, recovery state, and screen-share activity remain ephemeral. Refresh restores only the server-validated participant session and reconnects the Hub; automatic runtime orchestration then creates a fresh peer when both participants are online. Capture remains an explicit Host action and is never automatically restored.

Host-only publication and two-person capacity are server/realtime authorization concerns, not UI conventions. Consult the accepted ADRs before changing these boundaries.

## WebRTC quality telemetry (Stage 7.1)

Ownership mirrors the existing WebRTC layering exactly: `WebRtcPeerController.getQualitySnapshot()` calls `RTCPeerConnection.getStats()` on the current peer and hands the raw `RTCStatsReport` to a pure function, `computeQualitySnapshot` (`frontend/src/features/peer/qualitySnapshot.ts`), which normalizes it into a small typed `QualitySnapshot`—React never parses `RTCStatsReport`, and `RoomRuntime` never touches raw browser stats. `RoomRuntime` owns polling lifecycle at the same level it owns peer lifecycle: once a peer's `onStatusChanged` callback first reports `connected`/`connected`/`stable`, `RoomRuntime` starts a self-rescheduling poll (via the same `dependencies.schedule` seam used by peer/Hub recovery) at a conservative ~2 second cadence (`qualityPollIntervalMilliseconds`), guarded by the same peer identity/generation check used by every other async peer callback in the class. `disposePeer()`—the single teardown path already used for counterpart-offline, peer failure, Hub disconnect, diagnostics restart, and `stop()`—cancels the poll and clears the projected snapshot, so a fresh peer always starts a fresh telemetry baseline and no stale/duplicate polling loop can survive a peer or Hub replacement.

`computeQualitySnapshot` resolves the selected ICE candidate pair through the modern `transport.selectedCandidatePairId` relationship (falling back to an explicitly `selected`/`nominated`+`succeeded` pair only if no transport stat is available—never just the first `succeeded` pair seen), and reports only `candidateType` (`host`/`srflx`/`relay`/`prflx`), transport/relay protocol, RTT, and available bitrate for that pair. Outbound (Host sender) and inbound (Guest receiver) video metrics—bitrate, packet loss, jitter, FPS, codec, encode time, quality-limitation reason—are computed with interval (not lifetime) deltas between polls; a first sample, a zero/negative elapsed interval, or a counter reset (current < previous, e.g. after a peer replacement) all safely resolve to `null` rather than a negative or `NaN`/`Infinity` value. Every field independently degrades to `null` when the browser doesn't provide it, so Chrome/Safari/Edge differences and malformed stats can never throw. The normalized snapshot never includes IP addresses, raw ICE candidate strings, TURN username/credential, or raw SDP—only candidate type, protocol, and quality numbers; a `getStats()` failure (or a peer replaced/closed mid-call) resolves to `null` rather than affecting peer health, renegotiation, Hub recovery, or capture, and nothing here is logged or persisted (memory-only, matching the existing ICE-configuration and participant-credential storage policy).

The development diagnostics UI renders `RoomRuntimeSnapshot.qualitySnapshot` as a read-only "Connection Quality" panel (selected ICE path, transport, RTT, and role-appropriate sender/receiver metrics, `—` when unavailable)—observability only. No automatic bitrate/resolution/FPS adaptation exists yet; that remains a later Stage 7.2 decision to be informed by real-world metrics, not implemented speculatively here.
