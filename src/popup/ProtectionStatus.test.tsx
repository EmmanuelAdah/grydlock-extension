import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import ProtectionStatusPanel from './ProtectionStatus'

expect.extend(toHaveNoViolations)

const originalChrome = globalThis.chrome

describe('ProtectionStatusPanel', () => {
  beforeEach(() => {
    globalThis.chrome = {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 7 }]) },
      runtime: {
        sendMessage: vi.fn((_message, callback) =>
          callback({
            status: 'bridge-unavailable',
            adapter: null,
            checkedAt: null,
            freshUntil: null,
          }),
        ),
      },
    } as unknown as typeof chrome
  })

  afterEach(() => {
    globalThis.chrome = originalChrome
  })

  it('never presents a missing bridge as healthy', async () => {
    render(<ProtectionStatusPanel />)
    expect(await screen.findByRole('heading', { name: /bridge unavailable/i })).toBeInTheDocument()
    expect(screen.getByText(/do not assume signing requests are reviewed/i)).toBeInTheDocument()
  })

  it('fails closed when the worker does not answer the status query', async () => {
    globalThis.chrome.runtime.sendMessage = vi.fn((_message, callback) =>
      callback(undefined),
    ) as typeof chrome.runtime.sendMessage
    render(<ProtectionStatusPanel />)
    expect(
      await screen.findByRole('heading', { name: /worker status unavailable/i }),
    ).toBeInTheDocument()
  })

  it('exposes a protection failure accessibly', async () => {
    const { container } = render(<ProtectionStatusPanel />)
    await screen.findByRole('heading', { name: /bridge unavailable/i })
    expect(await axe(container)).toHaveNoViolations()
  })
})
