# ADR-0005: No normal media through the backend

**Status:** Accepted

## Context

Routing normal shared media through the application service would add cost, operational complexity, privacy exposure, and latency without serving the P2P-first product direction.

## Decision

The Duovie backend does not proxy, transcode, record, or normally relay shared media.

## Consequences

Normal media uses WebRTC peer connections, with TURN fallback when necessary. API and SignalR designs must not become an accidental media path, and Duovie must not record media.
