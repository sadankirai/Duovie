# ADR-0004: SignalR for realtime application communication

**Status:** Accepted

## Context

The two participants need authorized, low-latency coordination around rooms and WebRTC setup.

## Decision

ASP.NET Core SignalR handles room presence, realtime text chat, WebRTC offer/answer signaling, ICE candidate exchange, and relevant connection events for the initial architecture.

## Consequences

SignalR carries application/realtime events, not normal media. Initial chat history is not persisted; authorization and reconnect behavior need dedicated tests.
