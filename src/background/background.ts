import { getScore } from '../adapter/oracleAdapter'
import { extractDestination } from '../decode/decodeTransaction'
import {
  clearDiagnostics,
  exportDiagnostics,
  recordDiagnosticEvent,
} from '../diagnostics/diagnosticsStore'
import { resolveOutcome } from '../intercept/resolveOutcome'
import type {
  Decision,
  RuntimeSignOutcomeMessage,
  RuntimeProtectionStatusQueryMessage,
} from '../intercept/protocol'
import { recordDecision } from '../lib/history'
import { tierForScore } from '../lib/tiers'
import {
  isRuntimeDecisionMadeMessage,
  isRuntimeProtectionAdapterStatusMessage,
  isRuntimeProtectionBridgeOnlineMessage,
  isRuntimeProtectionHandshakeAckMessage,
  isRuntimeProtectionHandshakeMessage,
  isRuntimeSignRequestMessage,
} from './messageValidation'
import {
  PROTECTION_PROTOCOL_VERSION,
  recordKey,
  snapshotForRecords,
  staleRecords,
  validateProtectionRecord,
  type ProtectionAdapter,
  type ProtectionRecord,
  type ProtectionSnapshot,
} from '../protection/protectionState'

export const DEFAULT_TIMEOUT_MS = 60_000
export const PROTECTION_STORAGE_KEY = 'protectionStateV1'
const HANDSHAKE_TTL_MS = 5_000
const MAX_PENDING_HANDSHAKES = 100

interface PendingInfo {
  destinations: { destination: string; asset?: string }[]
  scores: Array<{ destination: string; asset?: string; score: number }>
  worstScore: number
}

export const pendingDecisions = new Map<string, (decision: Decision) => void>()

const protectionRecords = new Map<string, ProtectionRecord>()
const bridgeContexts = new Map<string, { origin: string; documentId?: string }>()
const pendingHandshakes = new Map<
  string,
  {
    tabId: number
    frameId: number
    adapter: ProtectionAdapter
    origin: string
    documentId?: string
    expiresAt: number
  }
>()

function diagnosticsHealth() {
  const statuses = [...protectionRecords.values()].map((record) => record.status)
  return {
    interception: statuses.includes('protected')
      ? 'ok'
      : statuses.includes('stale')
        ? 'degraded'
        : 'unknown',
    bridge: bridgeContexts.size > 0 ? 'ok' : 'unknown',
    background: 'ok',
    oracle: 'unknown',
    storage: 'ok',
  } as const
}

function persistProtectionRecords(): void {
  const session = chrome.storage?.session
  if (!session) return
  void session.set({ [PROTECTION_STORAGE_KEY]: [...protectionRecords.values()] }).catch(() => {
    void recordDiagnosticEvent('storage.write_failure').catch(() => {})
  })
}

function setProtectionRecord(record: ProtectionRecord): void {
  protectionRecords.set(recordKey(record.tabId, record.frameId, record.adapter), record)
  persistProtectionRecords()
}

function clearPendingHandshakes(tabId?: number): void {
  for (const [nonce, pending] of pendingHandshakes) {
    if (tabId === undefined || pending.tabId === tabId) pendingHandshakes.delete(nonce)
  }
}

function clearBridgeContexts(tabId?: number): void {
  for (const key of bridgeContexts.keys()) {
    if (tabId === undefined || key.startsWith(`${tabId}:`)) bridgeContexts.delete(key)
  }
}

function discardExpiredHandshakes(now: number): void {
  for (const [nonce, pending] of pendingHandshakes) {
    if (pending.expiresAt < now) pendingHandshakes.delete(nonce)
  }
}

async function restoreProtectionRecords(): Promise<void> {
  const session = chrome.storage?.session
  if (!session) return
  try {
    const stored = await session.get(PROTECTION_STORAGE_KEY)
    const values = Array.isArray(stored[PROTECTION_STORAGE_KEY])
      ? stored[PROTECTION_STORAGE_KEY]
      : []
    for (const record of staleRecords(
      values.map(validateProtectionRecord).filter(Boolean) as ProtectionRecord[],
    )) {
      protectionRecords.set(recordKey(record.tabId, record.frameId, record.adapter), record)
    }
    persistProtectionRecords()
  } catch {
    void recordDiagnosticEvent('storage.write_failure').catch(() => {})
  }
}

function senderLocation(sender: chrome.runtime.MessageSender): {
  tabId: number
  frameId: number
} | null {
  const tabId = sender.tab?.id
  if (!Number.isInteger(tabId)) return null
  return { tabId: tabId as number, frameId: sender.frameId ?? 0 }
}

function senderOrigin(sender: chrome.runtime.MessageSender): string | null {
  const candidate = sender.url ?? sender.tab?.url
  if (!candidate) return null
  try {
    const parsed = new URL(candidate)
    return parsed.origin === 'null' ? null : parsed.origin
  } catch {
    return null
  }
}

function permissionPatternForOrigin(origin: string): string | null {
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return `${parsed.protocol}//${parsed.hostname}/*`
  } catch {
    return null
  }
}

function rememberBridgeContext(sender: chrome.runtime.MessageSender): void {
  const location = senderLocation(sender)
  const origin = senderOrigin(sender)
  if (!location || !origin) return
  bridgeContexts.set(`${location.tabId}:${location.frameId}`, {
    origin,
    documentId: sender.documentId,
  })
}

async function hasCurrentSitePermission(sender: chrome.runtime.MessageSender): Promise<boolean> {
  const origin = senderOrigin(sender)
  return origin ? hasOriginPermission(origin) : false
}

async function hasOriginPermission(origin: string): Promise<boolean> {
  const pattern = permissionPatternForOrigin(origin)
  if (!pattern || !chrome.permissions?.contains) return false
  try {
    return await chrome.permissions.contains({ origins: [pattern] })
  } catch {
    return false
  }
}

function currentSnapshot(
  sender: chrome.runtime.MessageSender,
  requestedTabId?: unknown,
): ProtectionSnapshot {
  const location = senderLocation(sender)
  const hasExplicitTab = Number.isInteger(requestedTabId)
  const tabId = hasExplicitTab ? (requestedTabId as number) : location?.tabId
  const frameId = hasExplicitTab ? undefined : location?.frameId
  if (tabId === undefined) {
    return { status: 'worker-unavailable', adapter: null, checkedAt: null, freshUntil: null }
  }
  const records = [...protectionRecords.values()].filter(
    (record) => record.tabId === tabId && (frameId === undefined || record.frameId === frameId),
  )
  const hasBridge = [...bridgeContexts.keys()].some(
    (key) =>
      key === `${tabId}:${frameId}` || (frameId === undefined && key.startsWith(`${tabId}:`)),
  )
  if (records.length === 0 && hasBridge) {
    return { status: 'unknown', adapter: null, checkedAt: null, freshUntil: null }
  }
  return snapshotForRecords(records, Date.now())
}

async function handleProtectionHandshake(
  message: { nonce: string; adapter: ProtectionAdapter },
  sender: chrome.runtime.MessageSender,
): Promise<{ accepted: boolean }> {
  const location = senderLocation(sender)
  if (!location) return { accepted: false }
  const currentTime = Date.now()
  discardExpiredHandshakes(currentTime)
  if (pendingHandshakes.size >= MAX_PENDING_HANDSHAKES) {
    void recordDiagnosticEvent('protection.handshake.failure').catch(() => {})
    return { accepted: false }
  }
  if (!(await hasCurrentSitePermission(sender))) {
    setProtectionRecord({
      ...location,
      adapter: message.adapter,
      status: 'permission-denied',
      protocolVersion: PROTECTION_PROTOCOL_VERSION,
      checkedAt: Date.now(),
    })
    return { accepted: false }
  }

  const origin = senderOrigin(sender)
  if (!origin || pendingHandshakes.has(message.nonce)) {
    void recordDiagnosticEvent('protection.handshake.failure').catch(() => {})
    return { accepted: false }
  }
  rememberBridgeContext(sender)

  pendingHandshakes.set(message.nonce, {
    ...location,
    adapter: message.adapter,
    origin,
    documentId: sender.documentId,
    expiresAt: currentTime + HANDSHAKE_TTL_MS,
  })
  return { accepted: true }
}

function handleProtectionHandshakeAck(
  message: { nonce: string; adapter: ProtectionAdapter },
  sender: chrome.runtime.MessageSender,
): void {
  const pending = pendingHandshakes.get(message.nonce)
  pendingHandshakes.delete(message.nonce)
  const location = senderLocation(sender)
  if (
    !pending ||
    !location ||
    pending.adapter !== message.adapter ||
    pending.tabId !== location.tabId ||
    pending.frameId !== location.frameId ||
    pending.origin !== senderOrigin(sender) ||
    pending.documentId !== sender.documentId ||
    pending.expiresAt < Date.now()
  ) {
    void recordDiagnosticEvent('protection.handshake.failure').catch(() => {})
    return
  }
  const existing = protectionRecords.get(recordKey(pending.tabId, pending.frameId, pending.adapter))
  // A concrete route failure remains non-protective for the lifetime of this document.
  // A generic heartbeat cannot erase it; navigation creates a new document and resets it.
  if (existing?.status === 'adapter-incompatible' || existing?.status === 'unsupported') return
  setProtectionRecord({
    tabId: pending.tabId,
    frameId: pending.frameId,
    adapter: pending.adapter,
    status: 'protected',
    protocolVersion: PROTECTION_PROTOCOL_VERSION,
    checkedAt: Date.now(),
  })
  void recordDiagnosticEvent('protection.handshake.success').catch(() => {})
}

const protectionRestore = restoreProtectionRecords()

function clearBadgeIfIdle() {
  if (pendingDecisions.size === 0) {
    chrome.action.setBadgeText({ text: '' })
  }
}

function recordFirstDecision(info: PendingInfo, decision: Decision) {
  const first = info.scores[0]
  if (!first) return

  void recordDecision({
    destination: first.destination,
    asset: first.asset,
    score: first.score,
    tier: tierForScore(first.score).tier,
    decision,
    timestamp: Date.now(),
  }).catch(() => {})
}

export function requestDecision(requestId: string, info: PendingInfo): Promise<Decision> {
  const tierInfo = tierForScore(info.worstScore)
  chrome.action.setBadgeText({ text: '!' })
  chrome.action.setBadgeBackgroundColor({ color: tierInfo.colour })

  return new Promise((resolve) => {
    pendingDecisions.set(requestId, (decision) => {
      pendingDecisions.delete(requestId)
      recordFirstDecision(info, decision)
      resolve(decision)
      clearBadgeIfIdle()
    })

    const params = new URLSearchParams({
      mode: 'intercept',
      requestId,
      score: String(info.worstScore),
    })

    const mapped = info.scores.map((item) => ({
      destination: item.destination,
      asset: item.asset ?? '',
      score: item.score,
    }))

    if (mapped.length > 1) {
      params.set('destinations', JSON.stringify(mapped))
    } else if (mapped.length === 1) {
      const [first] = mapped
      params.set('destination', first.destination)
      if (first.asset) params.set('asset', first.asset)
    }

    chrome.windows.create({
      url: chrome.runtime.getURL(`src/popup/index.html?${params.toString()}`),
      type: 'popup',
      width: 320,
      height: 420,
    })
  })
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isRuntimeSignRequestMessage(message)) {
    resolveOutcome(
      message.xdr,
      {
        extractDestination,
        getScore,
        requestDecision: (info) => requestDecision(message.requestId, info),
      },
      message.networkPassphrase,
    )
      .then((outcome) => {
        const response: RuntimeSignOutcomeMessage = {
          type: 'SIGN_OUTCOME',
          requestId: message.requestId,
          outcome,
        }
        sendResponse(response)
      })
      .catch(() => {
        const response: RuntimeSignOutcomeMessage = {
          type: 'SIGN_OUTCOME',
          requestId: message.requestId,
          outcome: 'cancel',
        }
        sendResponse(response)
      })

    return true
  }

  if (isRuntimeDecisionMadeMessage(message)) {
    const resolve = pendingDecisions.get(message.requestId)
    resolve?.(message.decision)
  }

  if (isRuntimeProtectionHandshakeMessage(message)) {
    void protectionRestore
      .then(() => handleProtectionHandshake(message, _sender))
      .then(sendResponse)
      .catch(() => sendResponse({ accepted: false }))
    return true
  }

  if (isRuntimeProtectionBridgeOnlineMessage(message)) {
    void protectionRestore.then(() => rememberBridgeContext(_sender))
    return undefined
  }

  if (isRuntimeProtectionHandshakeAckMessage(message)) {
    void protectionRestore.then(() => handleProtectionHandshakeAck(message, _sender))
    return undefined
  }

  if (isRuntimeProtectionAdapterStatusMessage(message)) {
    void protectionRestore.then(() => {
      const location = senderLocation(_sender)
      if (!location) return
      rememberBridgeContext(_sender)
      setProtectionRecord({
        ...location,
        adapter: message.adapter,
        status: message.status,
        protocolVersion: PROTECTION_PROTOCOL_VERSION,
        checkedAt: Date.now(),
      })
      void recordDiagnosticEvent('protection.handshake.failure').catch(() => {})
    })
    return undefined
  }

  if (
    (message as RuntimeProtectionStatusQueryMessage | undefined)?.type === 'GET_PROTECTION_STATUS'
  ) {
    void protectionRestore.then(() =>
      sendResponse(
        currentSnapshot(_sender, (message as RuntimeProtectionStatusQueryMessage).tabId),
      ),
    )
    return true
  }

  if ((message as { type?: string } | undefined)?.type === 'CLEAR_DIAGNOSTICS') {
    void clearDiagnostics().then(
      () => sendResponse({ cleared: true }),
      () => sendResponse({ cleared: false }),
    )
    return true
  }

  if ((message as { type?: string } | undefined)?.type === 'EXPORT_DIAGNOSTICS') {
    void exportDiagnostics(diagnosticsHealth()).then(sendResponse, () => sendResponse(undefined))
    return true
  }

  return undefined
})

void recordDiagnosticEvent('runtime.worker_start').catch(() => {})

async function updatePermissionState(restored: boolean): Promise<void> {
  let changed = false
  for (const [key, record] of protectionRecords) {
    const bridge = bridgeContexts.get(`${record.tabId}:${record.frameId}`)
    // A worker restart already makes records stale and intentionally discards origins. Never
    // reconstruct browsing history just to refine an already non-protective status.
    if (!bridge) continue
    const allowed = await hasOriginPermission(bridge.origin)
    if (!restored && !allowed && record.status !== 'permission-denied') {
      protectionRecords.set(key, { ...record, status: 'permission-denied' })
      clearPendingHandshakes(record.tabId)
      changed = true
    }
    if (restored && allowed && record.status === 'permission-denied') {
      protectionRecords.set(key, { ...record, status: 'stale' })
      clearPendingHandshakes(record.tabId)
      changed = true
    }
  }
  if (changed) {
    persistProtectionRecords()
    void recordDiagnosticEvent('protection.permission.changed').catch(() => {})
  }
}

chrome.permissions?.onRemoved.addListener(() => {
  void protectionRestore.then(() => updatePermissionState(false))
})
chrome.permissions?.onAdded.addListener(() => {
  void protectionRestore.then(() => updatePermissionState(true))
})
chrome.tabs?.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return
  void protectionRestore.then(() => {
    clearPendingHandshakes(tabId)
    clearBridgeContexts(tabId)
    for (const [key, record] of protectionRecords) {
      if (record.tabId === tabId) protectionRecords.set(key, { ...record, status: 'stale' })
    }
    persistProtectionRecords()
  })
})
chrome.tabs?.onRemoved.addListener((tabId) => {
  void protectionRestore.then(() => {
    clearPendingHandshakes(tabId)
    clearBridgeContexts(tabId)
    for (const [key, record] of protectionRecords) {
      if (record.tabId === tabId) protectionRecords.delete(key)
    }
    persistProtectionRecords()
  })
})
