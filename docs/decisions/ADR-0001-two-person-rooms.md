# ADR-0001: Two-person rooms

**Status:** Accepted

## Context

Duovie is designed for private one-to-one watch sessions, not public broadcasting. Capacity and role rules must remain secure even when clients are malicious or stale.

## Decision

Every room has exactly one Host and at most one Guest, for a maximum of two participants. The server/realtime layer rejects a third participant.

## Consequences

Room membership and capacity must be authoritative server-side. UI capacity indicators are convenience only; tests must cover third-participant rejection.
