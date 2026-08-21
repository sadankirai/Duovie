# ADR-0002: Host-only screen share

**Status:** Accepted

## Context

The Host initiates the private watch session. Guest media publication would violate the intended room model and cannot be prevented reliably by UI alone.

## Decision

Only the Host may publish screen media. Application and realtime authorization enforce this rule.

## Consequences

Guest sharing controls may be absent from the UI, but authorization must independently reject Guest publication attempts. Supported capture targets and audio remain browser/platform-dependent.
