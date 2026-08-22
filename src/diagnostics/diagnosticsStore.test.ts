import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DIAGNOSTICS_STORAGE_KEY,
  clearDiagnostics,
  exportDiagnostics,
  recordDiagnosticEvent,
  resetDiagnosticsWriteQueueForTest,
} from './diagnosticsStore'

const originalChrome = globalThis.chrome

describe('diagnostics storage integration', () => {
  const get = vi.fn()
  const set = vi.fn()
  const remove = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    resetDiagnosticsWriteQueueForTest()
    get.mockResolvedValue({})
    set.mockResolvedValue(undefined)
    remove.mockResolvedValue(undefined)
    globalThis.chrome = {
      storage: { local: { get, set, remove } },
      runtime: { getManifest: () => ({ version: '0.1.0' }) },
    } as unknown as typeof chrome
  })

  afterEach(() => {
    globalThis.chrome = originalChrome
  })

  it('serializes closed-set counter writes without affecting unrelated storage', async () => {
    await Promise.all([
      recordDiagnosticEvent('protection.handshake.success'),
      recordDiagnosticEvent('protection.handshake.success'),
    ])

    expect(set).toHaveBeenCalledTimes(2)
    expect(Object.keys(set.mock.calls[0][0])).toEqual([DIAGNOSTICS_STORAGE_KEY])
  })

  it('clears diagnostics only, preserving history and trusted-address policy keys', async () => {
    await clearDiagnostics()
    expect(remove).toHaveBeenCalledWith(DIAGNOSTICS_STORAGE_KEY)
    expect(remove).not.toHaveBeenCalledWith('decisionHistory')
    expect(remove).not.toHaveBeenCalledWith('trustedAddresses')
  })

  it('exports only the redacted report shape', async () => {
    const report = await exportDiagnostics({
      interception: 'unknown',
      bridge: 'unknown',
      background: 'ok',
      oracle: 'unknown',
      storage: 'ok',
    })
    const serialized = JSON.stringify(report)
    expect(serialized).not.toMatch(/https?:\/\/|requestId|AAAA|G[A-Z2-7]{54}/)
    expect(report.environment.extensionVersion).toBe('0.1.0')
  })
})
