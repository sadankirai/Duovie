# Testing strategy

## Planned test pyramid

- **Unit tests:** domain rules and application behavior, especially capacity, roles, lifecycle validation, and authorization decisions.
- **Integration tests:** HTTP and realtime authorization where practical, persistence/configuration boundaries, and future endpoints such as protected TURN credential issuance.
- **Frontend tests:** Vitest and React Testing Library are planned for UI and feature behavior.
- **Browser tests:** Playwright Chromium runs the real frontend, API, PostgreSQL persistence, SignalR, and same-machine WebRTC flow. Broader browser/network coverage remains later work.

Important future cases include rejection of a third participant; blocked Guest Host-only actions; incorrect joins to expired/closed rooms; invalid participant sessions; and protection against anonymous TURN-credential abuse when authorization is required.

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
