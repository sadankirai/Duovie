/**
 * Development/test-only forced-relay seam for proving real TURN relay connectivity.
 * Production builds must always use "all": `isDevBuild` is passed the literal
 * `import.meta.env.DEV` expression at the call site so Vite's dead-code elimination
 * removes the "relay" branch entirely from production bundles, not just at runtime.
 */
export function resolveDevIceTransportPolicy(
  isDevBuild: boolean,
  configuredPolicy: string | undefined,
): RTCIceTransportPolicy {
  return isDevBuild && configuredPolicy === 'relay' ? 'relay' : 'all'
}
