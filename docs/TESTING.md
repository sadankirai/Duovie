# Testing strategy

## Planned test pyramid

- **Unit tests:** domain rules and application behavior, especially capacity, roles, lifecycle validation, and authorization decisions.
- **Integration tests:** HTTP and realtime authorization where practical, persistence/configuration boundaries, and future endpoints such as protected TURN credential issuance.
- **Frontend tests:** Vitest and React Testing Library are planned for UI and feature behavior.
- **Browser tests:** Playwright is planned later for cross-browser workflows.

Important future cases include rejection of a third participant; blocked Guest Host-only actions; incorrect joins to expired/closed rooms; invalid participant sessions; and protection against anonymous TURN-credential abuse when authorization is required.

Room persistence integration tests use Testcontainers with an isolated PostgreSQL 18 container. Docker must be running for `dotnet test backend/Duovie.sln`; the tests do not use `.env`, developer database credentials, or existing local database state.

## WebRTC validation

WebRTC cannot be trusted through unit tests alone. Browser and network combinations are not automated yet. Later real-browser validation should cover Chrome ↔ Chrome, Chrome ↔ Edge, Edge ↔ Chrome, Safari ↔ Chrome, Chrome ↔ Safari, and Safari ↔ Safari; same and different networks, hotspots, forced TURN, interruption/recovery, and long sessions.

Screen-capture and captured-audio behavior must be manually validated per browser and operating system. Capability differences should be handled gracefully rather than assumed away.
