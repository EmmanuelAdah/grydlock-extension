import { describe, expect, it } from 'vitest'
import { ADAPTER_CAPABILITIES, UNSUPPORTED_ROUTES, capabilityFor } from './capabilities'

describe('adapter capability registry', () => {
  it('defines each executable adapter exactly once and classifies uncovered Albedo paths', () => {
    expect(ADAPTER_CAPABILITIES.map((entry) => entry.adapter)).toEqual([
      'freighter',
      'albedo-popup',
    ])
    expect(capabilityFor('albedo-popup').exclusions).toEqual([
      'albedo-implicit',
      'albedo-pay-without-xdr',
      'albedo-sep-0007',
    ])
    expect(Object.values(UNSUPPORTED_ROUTES).every((value) => value.length > 0)).toBe(true)
  })
})
