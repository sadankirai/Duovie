import { describe, expect, it } from 'vitest'
import { resolveDevIceTransportPolicy } from './iceTransportPolicy'

describe('resolveDevIceTransportPolicy', () => {
  it('defaults to "all" in a development build with no override configured', () => {
    expect(resolveDevIceTransportPolicy(true, undefined)).toBe('all')
  })

  it('defaults to "all" in a development build with an unrecognized value', () => {
    expect(resolveDevIceTransportPolicy(true, 'not-a-real-policy')).toBe('all')
  })

  it('resolves to "relay" only in a development build with the explicit override', () => {
    expect(resolveDevIceTransportPolicy(true, 'relay')).toBe('relay')
  })

  it('never resolves to "relay" outside a development build, even with the override set', () => {
    expect(resolveDevIceTransportPolicy(false, 'relay')).toBe('all')
  })

  it('always resolves to "all" in a production build regardless of input', () => {
    expect(resolveDevIceTransportPolicy(false, undefined)).toBe('all')
    expect(resolveDevIceTransportPolicy(false, 'not-a-real-policy')).toBe('all')
  })
})
