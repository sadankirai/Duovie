# Product

## Purpose

Duovie is a private two-person Movie Date / Watch Together platform. A Host creates a private room and shares an invite link with one Guest. The Host may share supported browser-tab, window, or entire-screen content; the Guest watches it and both can use realtime text chat. Duovie is not a public broadcasting platform.

## Hard invariants

- A room has exactly one Host and at most one Guest: maximum capacity is two participants.
- A third participant is rejected server-side. Client-side checks alone are insufficient.
- Only the Host may publish screen media, enforced by application/realtime authorization—not only hidden UI.
- WebRTC is the primary, P2P-first media technology. STUN/ICE supports NAT traversal; TURN is fallback only.
- The application API must not normally proxy, transcode, record, or relay media.
- SignalR handles room presence, text chat, WebRTC offer/answer signaling, ICE candidates, and relevant connection events.
- Initial chat history is not persisted.
- A room URL or code alone never grants Host permission; MVP participant sessions are short-lived and must support a later move to accounts.

## Room lifecycle

`Created / Waiting → Guest joins → Ready → Host starts sharing → Streaming → Host stops sharing → Ready → Closed / Expired`

Transitions must be explicit and validated. A temporary Host disconnection does not automatically destroy a room; reconnect/grace behavior will be finalized through later testing, without arbitrary timeout values now.

## Room URL and browser-session continuity

An active participant should have a Room-specific browser URL. The Room identifier in that URL is a shareable locator only: it never grants Host, Guest, or participant authority and must never contain a participant credential. Refreshing the Room URL should preserve a still-valid short-lived participant session after server-side credential validation; opening the same URL without valid participant authority must instead present a safe Join flow subject to the normal Room rules.

The accountless MVP may keep the opaque participant credential in tab-scoped browser-session storage to support same-tab refresh, but it must not trust stored role or participant identity. This is an MVP continuity tradeoff, not the future account/authentication architecture. Realtime connections and WebRTC media state remain ephemeral and are re-established rather than serialized across refresh.

## Browser and protected-media boundaries

Initial desktop support targets Chrome, Edge, and Safari. Screen-capture and captured-audio support vary by browser and operating system, especially on Safari. Future implementation must detect capabilities and degrade gracefully. Firefox may be evaluated later; mobile browsers are outside MVP scope.

Duovie must never bypass DRM, HDCP, browser content protection, or protected-media restrictions. Blocked capture is a platform limitation, not a condition to circumvent.

## MVP and exclusions

The MVP validates a stable private two-person watch session: room creation/invitation, one Guest, realtime chat, Host-only sharing, P2P connectivity with TURN fallback, and basic connection health/recovery. Stability takes precedence over headline resolution or FPS promises.

Excluded unless a later approved decision introduces them: camera, microphone/voice chat, Guest playback controls, remote input, browser extension, streaming-service synchronization, accounts, subscriptions/plans/payments/Stripe, social features, mobile apps, recording, and DRM bypassing.

Post-MVP candidates include voice/video, Guest playback commands, extension or synchronized-playback research, accounts/profiles/history, subscriptions, broader browser support, and mobile.

## Privacy and security principles

Duovie does not record media; normal media does not pass through the API; and initial chat is not stored. Do not log TURN secrets or sensitive WebRTC/session material unnecessarily. Future work must use high-entropy room codes, server-validated Host authority and capacity, rate limits, bounded inputs/chat rates, HTTPS, and restricted production CORS.
