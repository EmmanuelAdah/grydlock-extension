import { describe, expect, it } from 'vitest'
import {
  PROTECTION_FRESHNESS_MS,
  PROTECTION_PROTOCOL_VERSION,
  snapshotForRecord,
  snapshotForRecords,
  staleRecords,
  validateProtectionRecord,
} from './protectionState'

const NOW = 1_700_000_000_000

describe('protection state', () => {
  const protectedRecord = {
    tabId: 3,
    frameId: 0,
    adapter: 'freighter' as const,
    status: 'protected' as const,
    protocolVersion: PROTECTION_PROTOCOL_VERSION,
    checkedAt: NOW,
  }

  it('requires a recent matching-protocol handshake before reporting protected', () => {
    expect(snapshotForRecord(protectedRecord, NOW).status).toBe('protected')
    expect(snapshotForRecord(protectedRecord, NOW + PROTECTION_FRESHNESS_MS + 1).status).toBe(
      'stale',
    )
    expect(snapshotForRecord({ ...protectedRecord, protocolVersion: 0 }, NOW).status).toBe(
      'adapter-incompatible',
    )
  })

  it('uses bridge-unavailable when no content-script record exists', () => {
    expect(snapshotForRecord(undefined, NOW)).toMatchObject({
      status: 'bridge-unavailable',
      adapter: null,
    })
  })

  it('marks successful records stale after a worker restart', () => {
    expect(
      staleRecords([protectedRecord, { ...protectedRecord, status: 'permission-denied' }]),
    ).toEqual([
      { ...protectedRecord, status: 'stale' },
      { ...protectedRecord, status: 'permission-denied' },
    ])
  })

  it('fails closed when a tab has both a healthy heartbeat and a known incompatible route', () => {
    expect(
      snapshotForRecords(
        [protectedRecord, { ...protectedRecord, adapter: 'albedo-popup', status: 'unsupported' }],
        NOW,
      ),
    ).toMatchObject({ status: 'unsupported', adapter: 'albedo-popup' })
  })

  it('rejects malformed or non-finite persisted records', () => {
    expect(validateProtectionRecord({ ...protectedRecord, checkedAt: Number.NaN })).toBeNull()
    expect(validateProtectionRecord({ ...protectedRecord, adapter: 'unknown' })).toBeNull()
    expect(validateProtectionRecord(protectedRecord)).toEqual(protectedRecord)
  })
})
