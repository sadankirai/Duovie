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

WebRTC, presence, recovery state, and screen-share activity remain ephemeral. Refresh restores only the server-validated participant session and reconnects the Hub; automatic runtime orchestration then creates a fresh peer when both participants are online. Capture remains an explicit Host action and is never automatically restored.

Host-only publication and two-person capacity are server/realtime authorization concerns, not UI conventions. Consult the accepted ADRs before changing these boundaries.

## Future quality model

The MVP should later observe WebRTC stats such as RTT, packet loss, bitrate, frame statistics, ICE state, and selected candidate pair to provide a simple health indicator. Adaptive quality may follow real-world validation; no resolution or FPS guarantee is made.
