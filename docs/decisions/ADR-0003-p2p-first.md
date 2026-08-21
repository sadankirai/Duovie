# ADR-0003: P2P-first media

**Status:** Accepted

## Context

Duovie is a private two-person platform that prioritizes privacy and efficient direct delivery.

## Decision

Use WebRTC media directly peer-to-peer whenever possible. Use STUN/ICE for traversal and TURN only when direct connectivity is unavailable.

## Consequences

Network testing must include TURN fallback. TURN credentials must be short-lived and server-issued when required; direct connectivity cannot be assumed in every environment.
