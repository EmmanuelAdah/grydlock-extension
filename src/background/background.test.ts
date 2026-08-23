import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as resolveModule from '../intercept/resolveOutcome'
import {
  MAX_NETWORK_PASSPHRASE_LENGTH,
  MAX_REQUEST_ID_LENGTH,
  MAX_XDR_LENGTH,
} from './messageValidation'

const mockAddListener = vi.fn()
const mockGetURL = vi.fn((path: string) => `chrome-extension://test-id/${path}`)
const mockWindowsCreate = vi.fn()
const mockSetBadgeText = vi.fn()
const mockSetBadgeBackgroundColor = vi.fn()
const mockLocalGet = vi.fn()
const mockLocalSet = vi.fn()
const mockLocalRemove = vi.fn()
const mockSessionGet = vi.fn()
const mockSessionSet = vi.fn()
const mockPermissionContains = vi.fn()
const mockPermissionRemoved = vi.fn()
const mockPermissionAdded = vi.fn()
const mockTabUpdated = vi.fn()
const mockTabRemoved = vi.fn()

const originalChrome = globalThis.chrome

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('background message listener', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    mockLocalGet.mockResolvedValue({})
    mockLocalSet.mockResolvedValue(undefined)
    mockLocalRemove.mockResolvedValue(undefined)
    mockSessionGet.mockResolvedValue({})
    mockSessionSet.mockResolvedValue(undefined)
    mockPermissionContains.mockResolvedValue(true)
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener: mockAddListener },
        getURL: mockGetURL,
      },
      windows: { create: mockWindowsCreate },
      action: {
        setBadgeText: mockSetBadgeText,
        setBadgeBackgroundColor: mockSetBadgeBackgroundColor,
      },
      storage: {
        local: { get: mockLocalGet, set: mockLocalSet, remove: mockLocalRemove },
        session: { get: mockSessionGet, set: mockSessionSet },
      },
      permissions: {
        contains: mockPermissionContains,
        onRemoved: { addListener: mockPermissionRemoved },
        onAdded: { addListener: mockPermissionAdded },
      },
      tabs: {
        onUpdated: { addListener: mockTabUpdated },
        onRemoved: { addListener: mockTabRemoved },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
  })

  afterEach(() => {
    globalThis.chrome = originalChrome
    vi.resetModules() // clear the internal pendingDecisions map for the next test
  })

  it('handles SIGN_REQUEST to SIGN_OUTCOME round trip and explicitly tests pendingDecisions lifecycle', async () => {
    // Intercept resolveOutcome to control when it finishes and observe requestDecision
    vi.spyOn(resolveModule, 'resolveOutcome').mockImplementation(async (_xdr, deps) => {
      // We must await it to test the round trip!
      const decision = await deps.requestDecision({
        destinations: [{ destination: 'GDEST' }],
        scores: [{ destination: 'GDEST', score: 42 }],
        worstScore: 42,
      })
      return decision === 'proceed' ? 'allow' : 'cancel'
    })

    await import('./background')

    const listener = mockAddListener.mock.calls[0][0]
    const sendResponse = vi.fn()

    // 1. Send SIGN_REQUEST
    const returnsTrue = listener(
      { type: 'SIGN_REQUEST', requestId: 'req-1', xdr: 'test' },
      {},
      sendResponse,
    )
    expect(returnsTrue).toBe(true)

    // Wait for resolveOutcome to get called and hit `requestDecision`
    await flushPromises()

    // Verify it called chrome.windows.create with the URL
    const popupUrl = mockWindowsCreate.mock.calls[0][0].url as string
    expect(popupUrl).toContain('mode=intercept')
    expect(popupUrl).toContain('requestId=req-1')
    expect(popupUrl).toContain('destination=GDEST')
    expect(popupUrl).toContain('score=42')

    // Verify badge was set to '!' and color matching score 42 (elevated -> '#a86300')
    expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '!' })
    expect(mockSetBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#a86300' })

    // At this point, pendingDecisions has 'req-1'.
    // We send a DECISION_MADE message to resolve it.
    listener({ type: 'DECISION_MADE', requestId: 'req-1', decision: 'proceed' }, {}, vi.fn())

    // Wait for the Promise chain to resolve
    await flushPromises()

    // Verify round trip completion
    expect(sendResponse).toHaveBeenCalledWith({
      type: 'SIGN_OUTCOME',
      requestId: 'req-1',
      outcome: 'allow',
    })

    // Verify badge text cleared when pending decisions are resolved
    expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '' })

    // Verify delete: sending another DECISION_MADE shouldn't crash or re-resolve anything
    // If pendingDecisions was not deleted, it would try to resolve a completed promise (which is safe in JS, but we want to ensure no crash)
    expect(() => {
      listener({ type: 'DECISION_MADE', requestId: 'req-1', decision: 'cancel' }, {}, vi.fn())
    }).not.toThrow()
  })

  it('safely handles unknown/out-of-order DECISION_MADE messages', async () => {
    await import('./background')
    const listener = mockAddListener.mock.calls[0][0]

    // Send DECISION_MADE without any pending SIGN_REQUEST
    // It should silently no-op at `resolve?.(...)`
    expect(() => {
      listener({ type: 'DECISION_MADE', requestId: 'unknown-id', decision: 'proceed' }, {}, vi.fn())
    }).not.toThrow()
  })

  it('rejects malformed and oversized sign requests before any side effect', async () => {
    const resolveOutcome = vi.spyOn(resolveModule, 'resolveOutcome')
    const { pendingDecisions } = await import('./background')
    const listener = mockAddListener.mock.calls[0][0]
    const sendResponse = vi.fn()
    const invalidMessages: unknown[] = [
      null,
      'SIGN_REQUEST',
      { type: 'SIGN_REQUEST' },
      { type: 'SIGN_REQUEST', requestId: 'req-1' },
      { type: 'SIGN_REQUEST', requestId: 1, xdr: 'AAAAAg==' },
      { type: 'SIGN_REQUEST', requestId: 'req-1', xdr: 1 },
      {
        type: 'SIGN_REQUEST',
        requestId: 'req-1',
        xdr: 'AAAAAg==',
        networkPassphrase: 1,
      },
      {
        type: 'SIGN_REQUEST',
        requestId: 'r'.repeat(MAX_REQUEST_ID_LENGTH + 1),
        xdr: 'AAAAAg==',
      },
      {
        type: 'SIGN_REQUEST',
        requestId: 'req-1',
        xdr: 'A'.repeat(MAX_XDR_LENGTH + 1),
      },
      {
        type: 'SIGN_REQUEST',
        requestId: 'req-1',
        xdr: 'AAAAAg==',
        networkPassphrase: 'n'.repeat(MAX_NETWORK_PASSPHRASE_LENGTH + 1),
      },
    ]

    for (const message of invalidMessages) {
      expect(listener(message, {}, sendResponse)).toBeUndefined()
    }

    expect(resolveOutcome).not.toHaveBeenCalled()
    expect(mockWindowsCreate).not.toHaveBeenCalled()
    expect(mockSetBadgeText).not.toHaveBeenCalled()
    expect(mockSetBadgeBackgroundColor).not.toHaveBeenCalled()
    expect(sendResponse).not.toHaveBeenCalled()
    expect(pendingDecisions.size).toBe(0)
  })

  it('never resolves pending state for an invalid decision message', async () => {
    const { pendingDecisions } = await import('./background')
    const listener = mockAddListener.mock.calls[0][0]
    const resolvePending = vi.fn()
    pendingDecisions.set('req-1', resolvePending)

    const invalidDecisions: unknown[] = [
      { type: 'DECISION_MADE', requestId: 'req-1' },
      { type: 'DECISION_MADE', requestId: 'req-1', decision: 'allow' },
      { type: 'DECISION_MADE', requestId: 'req-1', decision: 1 },
      { type: 'DECISION_MADE', requestId: 1, decision: 'proceed' },
      {
        type: 'DECISION_MADE',
        requestId: 'r'.repeat(MAX_REQUEST_ID_LENGTH + 1),
        decision: 'cancel',
      },
    ]

    for (const message of invalidDecisions) {
      expect(listener(message, {}, vi.fn())).toBeUndefined()
    }

    expect(resolvePending).not.toHaveBeenCalled()
    expect(pendingDecisions.has('req-1')).toBe(true)

    listener({ type: 'DECISION_MADE', requestId: 'req-1', decision: 'cancel' }, {}, vi.fn())
    expect(resolvePending).toHaveBeenCalledOnce()
    expect(resolvePending).toHaveBeenCalledWith('cancel')
  })

  it('requires a fresh successful non-financial handshake before reporting protected', async () => {
    await import('./background')
    const listener = mockAddListener.mock.calls[0][0]
    const sender = {
      tab: { id: 9, url: 'https://wallet.example/' },
      frameId: 0,
      url: 'https://wallet.example/',
    }
    const respondToHandshake = vi.fn()

    expect(
      listener(
        {
          type: 'PROTECTION_HANDSHAKE',
          nonce: 'nonce-1',
          adapter: 'freighter',
          protocolVersion: 1,
        },
        sender,
        respondToHandshake,
      ),
    ).toBe(true)
    await flushPromises()
    expect(respondToHandshake).toHaveBeenCalledWith({ accepted: true })

    listener(
      {
        type: 'PROTECTION_HANDSHAKE_ACK',
        nonce: 'nonce-1',
        adapter: 'freighter',
        protocolVersion: 1,
      },
      sender,
      vi.fn(),
    )
    await flushPromises()
    const respondToStatus = vi.fn()
    listener({ type: 'GET_PROTECTION_STATUS', tabId: 9 }, {}, respondToStatus)
    await flushPromises()
    expect(respondToStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'protected', adapter: 'freighter' }),
    )
  })

  it('fails closed for missing bridges and revoked site access', async () => {
    await import('./background')
    const listener = mockAddListener.mock.calls[0][0]
    const missingBridge = vi.fn()
    listener({ type: 'GET_PROTECTION_STATUS', tabId: 44 }, {}, missingBridge)
    await flushPromises()
    expect(missingBridge).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'bridge-unavailable' }),
    )

    mockPermissionContains.mockResolvedValue(false)
    const denied = vi.fn()
    const sender = {
      tab: { id: 45, url: 'https://denied.example/' },
      frameId: 0,
      url: 'https://denied.example/',
    }
    listener(
      { type: 'PROTECTION_HANDSHAKE', nonce: 'nonce-2', adapter: 'freighter', protocolVersion: 1 },
      sender,
      denied,
    )
    await flushPromises()
    expect(denied).toHaveBeenCalledWith({ accepted: false })
    const status = vi.fn()
    listener({ type: 'GET_PROTECTION_STATUS', tabId: 45 }, {}, status)
    await flushPromises()
    expect(status).toHaveBeenCalledWith(expect.objectContaining({ status: 'permission-denied' }))
  })

  it('distinguishes an injected bridge with no health result from a missing bridge', async () => {
    await import('./background')
    const listener = mockAddListener.mock.calls[0][0]
    const sender = {
      tab: { id: 46, url: 'https://wallet.example/' },
      frameId: 0,
      url: 'https://wallet.example/',
      documentId: 'document-46',
    }
    listener({ type: 'PROTECTION_BRIDGE_ONLINE', protocolVersion: 1 }, sender, vi.fn())
    await flushPromises()

    const status = vi.fn()
    listener({ type: 'GET_PROTECTION_STATUS', tabId: 46 }, {}, status)
    await flushPromises()
    expect(status).toHaveBeenCalledWith(expect.objectContaining({ status: 'unknown' }))
  })

  it('does not accept a handshake acknowledgement from a different document, tab, or frame', async () => {
    await import('./background')
    const listener = mockAddListener.mock.calls[0][0]
    const sender = {
      tab: { id: 51, url: 'https://wallet.example/' },
      frameId: 2,
      url: 'https://wallet.example/',
      documentId: 'document-a',
    }

    listener(
      {
        type: 'PROTECTION_HANDSHAKE',
        nonce: 'nonce-boundary',
        adapter: 'freighter',
        protocolVersion: 1,
      },
      sender,
      vi.fn(),
    )
    await flushPromises()
    listener(
      {
        type: 'PROTECTION_HANDSHAKE_ACK',
        nonce: 'nonce-boundary',
        adapter: 'freighter',
        protocolVersion: 1,
      },
      {
        tab: { id: 51, url: 'https://wallet.example/' },
        frameId: 2,
        url: 'https://wallet.example/',
        documentId: 'document-b',
      },
      vi.fn(),
    )
    await flushPromises()

    const response = vi.fn()
    listener({ type: 'GET_PROTECTION_STATUS', tabId: 51 }, {}, response)
    await flushPromises()
    expect(response).toHaveBeenCalledWith(expect.objectContaining({ status: 'unknown' }))
  })

  it('invalidates only the revoked site and requires a fresh handshake after restoration', async () => {
    await import('./background')
    const listener = mockAddListener.mock.calls[0][0]
    const sender = {
      tab: { id: 52, url: 'https://wallet.example/' },
      frameId: 0,
      url: 'https://wallet.example/',
      documentId: 'document-52',
    }

    listener(
      {
        type: 'PROTECTION_HANDSHAKE',
        nonce: 'permission-nonce',
        adapter: 'freighter',
        protocolVersion: 1,
      },
      sender,
      vi.fn(),
    )
    await flushPromises()
    listener(
      {
        type: 'PROTECTION_HANDSHAKE_ACK',
        nonce: 'permission-nonce',
        adapter: 'freighter',
        protocolVersion: 1,
      },
      sender,
      vi.fn(),
    )
    await flushPromises()

    mockPermissionContains.mockResolvedValue(false)
    mockPermissionRemoved.mock.calls[0][0]({ origins: ['https://wallet.example/*'] })
    await flushPromises()
    const denied = vi.fn()
    listener({ type: 'GET_PROTECTION_STATUS', tabId: 52 }, {}, denied)
    await flushPromises()
    expect(denied).toHaveBeenCalledWith(expect.objectContaining({ status: 'permission-denied' }))

    mockPermissionContains.mockResolvedValue(true)
    mockPermissionAdded.mock.calls[0][0]({ origins: ['https://wallet.example/*'] })
    await flushPromises()
    const restored = vi.fn()
    listener({ type: 'GET_PROTECTION_STATUS', tabId: 52 }, {}, restored)
    await flushPromises()
    expect(restored).toHaveBeenCalledWith(expect.objectContaining({ status: 'stale' }))

    listener(
      {
        type: 'PROTECTION_HANDSHAKE',
        nonce: 'restored-nonce',
        adapter: 'freighter',
        protocolVersion: 1,
      },
      sender,
      vi.fn(),
    )
    await flushPromises()
    listener(
      {
        type: 'PROTECTION_HANDSHAKE_ACK',
        nonce: 'restored-nonce',
        adapter: 'freighter',
        protocolVersion: 1,
      },
      sender,
      vi.fn(),
    )
    await flushPromises()
    const fresh = vi.fn()
    listener({ type: 'GET_PROTECTION_STATUS', tabId: 52 }, {}, fresh)
    await flushPromises()
    expect(fresh).toHaveBeenCalledWith(expect.objectContaining({ status: 'protected' }))
  })

  it('marks restored worker state stale until a new handshake completes', async () => {
    mockSessionGet.mockResolvedValue({
      protectionStateV1: [
        {
          tabId: 54,
          frameId: 0,
          adapter: 'freighter',
          status: 'protected',
          protocolVersion: 1,
          checkedAt: Date.now(),
        },
      ],
    })
    await import('./background')
    const listener = mockAddListener.mock.calls[0][0]
    const status = vi.fn()
    listener({ type: 'GET_PROTECTION_STATUS', tabId: 54 }, {}, status)
    await flushPromises()
    expect(status).toHaveBeenCalledWith(expect.objectContaining({ status: 'stale' }))
  })

  it('keeps a known unsupported adapter non-protective until navigation resets the document', async () => {
    await import('./background')
    const listener = mockAddListener.mock.calls[0][0]
    const sender = {
      tab: { id: 53, url: 'https://wallet.example/' },
      frameId: 0,
      url: 'https://wallet.example/',
    }

    listener(
      {
        type: 'PROTECTION_ADAPTER_STATUS',
        adapter: 'albedo-popup',
        status: 'unsupported',
        protocolVersion: 1,
      },
      sender,
      vi.fn(),
    )
    await flushPromises()
    listener(
      {
        type: 'PROTECTION_HANDSHAKE',
        nonce: 'nonce-unsupported',
        adapter: 'albedo-popup',
        protocolVersion: 1,
      },
      sender,
      vi.fn(),
    )
    await flushPromises()
    listener(
      {
        type: 'PROTECTION_HANDSHAKE_ACK',
        nonce: 'nonce-unsupported',
        adapter: 'albedo-popup',
        protocolVersion: 1,
      },
      sender,
      vi.fn(),
    )
    await flushPromises()

    const response = vi.fn()
    listener({ type: 'GET_PROTECTION_STATUS', tabId: 53 }, {}, response)
    await flushPromises()
    expect(response).toHaveBeenCalledWith(expect.objectContaining({ status: 'unsupported' }))
  })
})
