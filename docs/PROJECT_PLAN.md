# Project plan

This roadmap distinguishes the MVP from future work. Each stage requires validation before advancement; details may be refined without changing the hard invariants in [Product](PRODUCT.md) or accepted [ADRs](decisions/).

## Stage 0 — Repository & AI Foundation

**Status:** Foundation verification completed (Task 0.2D).

**Objective:** establish a reproducible, governed starting point.  
**Scope:** project documentation, AI guidance, repository conventions, then later backend/frontend scaffolds, test projects, and Docker development foundation.  
**Non-goal:** application features.  
**Deliverables:** source-of-truth docs (Task 0.1), followed by scoped scaffold tasks.  
**Exit criteria:** documentation is internally consistent; later scaffold work can proceed without inventing product or architecture decisions.

Task 0.1 is documentation only. It does not create applications, packages, Docker, projects, database migrations, or feature code.

## Stage 1 — Backend Foundation

**Status:** Backend foundation verification completed (Task 1.3).

**Objective:** establish the layered backend runtime.  
**Scope:** DI, EF Core, PostgreSQL, configuration, error handling, and health checks.  
**Non-goal:** room/realtime/media features.  
**Deliverables:** validated backend structure and foundation services.  
**Exit criteria:** backend builds, foundational integration checks pass, and configuration/secrets boundaries are clear.

## Stage 2 — Room System

**Status:** Room system verification completed (Task 2.6).

**Objective:** implement private two-person room access.  
**Scope:** create/join/close rooms, Host/Guest sessions, server-side capacity, lifecycle, expiration/closing rules.  
**Non-goal:** media sharing.  
**Deliverables:** secure room workflows and tests.  
**Exit criteria:** third participants and unauthorized Host actions are rejected server-side.

## Stage 3 — SignalR & Realtime Chat

**Status:** Realtime communication verification completed (Task 3.4).

**Objective:** establish realtime room communication.  
**Scope:** hub infrastructure, presence, chat, join/leave events, reconnect behavior.  
**Non-goal:** persisted chat history.  
**Deliverables:** authorized realtime flows and tests.  
**Exit criteria:** two authorized participants can communicate and lifecycle events behave correctly.

## Stage 4 — WebRTC Peer Connection

**Status:** Peer connection lifecycle and supported-environment verification completed (Task 4.2).

**Objective:** prove peer connectivity before capture.  
**Scope:** negotiation, offers/answers, ICE candidates, connection lifecycle, cleanup.  
**Non-goal:** production screen sharing.  
**Deliverables:** a tested peer-connection baseline.  
**Exit criteria:** peers connect and clean up reliably in supported test environments.

## Stage 5 — Host-Only Screen Sharing

**Status:** Task 5.1 Host-only screen video sharing and the Room URL/refresh-continuity checkpoint are complete. Stage 5 is not complete. Automatic Room Runtime Orchestration and the browser E2E foundation are the current architectural checkpoint before Stage 6.

**Objective:** deliver authorized supported-content sharing.  
**Scope:** `getDisplayMedia`, Host-only authorization, browser tab/window/screen video where supported, Guest playback, automatic Host-initiated peer orchestration, and unsupported-capability handling.
**Non-goal:** DRM circumvention or universal audio support.  
**Deliverables:** Host sharing and Guest viewing flow.  
**Exit criteria:** Guests cannot publish and capability limitations are communicated gracefully.

Captured display/tab/system audio is intentionally deferred until later browser-media polish. The sequence after the current orchestration/E2E checkpoint is STUN/TURN real-network reliability, stability and quality, a functional product Room, professional UI based on the approved design direction, later audio/browser-media polish, security hardening, and deployment.

## Stage 6 — STUN / TURN Reliability

**Status:** Task 6.1 ICE/STUN/TURN reliability foundation is complete: a provider-neutral
backend abstraction, a Cloudflare Realtime TURN implementation that issues short-lived
credentials from a server-only long-lived secret, the participant-authenticated
`GET /api/rooms/{roomId}/ice-servers` endpoint, and RoomRuntime/WebRtcPeerController
in-memory ICE integration on the frontend. Configured STUN and Cloudflare TURN both stay
off by default so local development and the Playwright E2E suite never depend on external
network access. Real cross-network/different-device TURN acceptance (selected candidate
type, forced-relay validation) has not been performed and is deferred to a separate manual
milestone; Stage 6 is not complete until that acceptance happens.

**Objective:** make connectivity resilient across networks.  
**Scope:** STUN, TURN fallback, short-lived server-issued credentials, ICE restart/failure handling, different-network tests.  
**Non-goal:** exposing permanent TURN credentials.  
**Deliverables:** fallback connectivity design and validation.  
**Exit criteria:** TURN-forced and cross-network scenarios have been tested.

## Stage 7 — Stability & Stream Quality

**Objective:** prioritize reliable sessions.  
**Scope:** WebRTC statistics, health model, quality monitoring, recovery, long-session testing, and adaptive-quality research/implementation when justified.  
**Non-goal:** unverified resolution/FPS guarantees.  
**Deliverables:** health indicator and stability evidence.  
**Exit criteria:** recovery and long-session behavior meet validated product expectations.

## Stage 8 — Professional Product UI

**Objective:** provide cohesive desktop product experience.  
**Scope:** landing, create-date flow, waiting room, Movie Date room, chat, stream/error states, unsupported-browser/capability states, responsive desktop UX.  
**Non-goal:** mobile application.  
**Deliverables:** polished end-to-end UI.  
**Exit criteria:** MVP user journey is clear and accessible on supported desktops.

## Stage 9 — Security Hardening

**Objective:** harden public-facing behavior.  
**Scope:** authorization review, rate limits, session security, enumeration resistance, TURN abuse prevention, headers, dependency review, security integration tests.  
**Deliverables:** security review findings and mitigations.  
**Exit criteria:** high-risk room, session, and TURN paths are validated.

## Stage 10 — Deployment

**Objective:** operate the MVP safely in production.  
**Scope:** frontend/backend/PostgreSQL deployment, chosen DNS/TLS and TURN integration, monitoring/logging, production configuration.  
**Deliverables:** deployment runbook and production environment.  
**Exit criteria:** HTTPS production workflow, monitoring, and configuration are verified.

## MVP completion

The MVP is complete only when a Host can create a private room, invite one Guest, chat in realtime, share supported content for the Guest to watch, connect P2P with TURN fallback when needed, and use basic health/recovery behavior.

## Post-MVP backlog

Potential—not committed—work: microphone/voice chat, camera, Guest play/pause/seek commands, browser extension, synchronized streaming-service playback, accounts, profiles/friends, Movie Date history, subscriptions, Free/Premium plans, expanded browsers, and mobile support. These items are not silently promoted into MVP scope.
