import {
  WINDOW_PROTECTION_ACK_TYPE,
  WINDOW_PROTECTION_ADAPTER_STATUS_TYPE,
  WINDOW_PROTECTION_PROBE_TYPE,
  WINDOW_PROTECTION_RESPONSE_TYPE,
  WINDOW_REQUEST_TYPE,
  WINDOW_RESPONSE_TYPE,
  type RuntimeProtectionAdapterStatusMessage,
  type RuntimeProtectionBridgeOnlineMessage,
  type RuntimeProtectionHandshakeAckMessage,
  type RuntimeProtectionHandshakeMessage,
  type RuntimeSignOutcomeMessage,
  type RuntimeSignRequestMessage,
} from './protocol'
import { PROTECTION_PROTOCOL_VERSION } from '../protection/protectionState'

const MAX_NONCE_LENGTH = 128

function isProtectionAdapter(value: unknown): value is 'freighter' | 'albedo-popup' {
  return value === 'freighter' || value === 'albedo-popup'
}

function isNonce(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_NONCE_LENGTH
}

const bridgeOnline: RuntimeProtectionBridgeOnlineMessage = {
  type: 'PROTECTION_BRIDGE_ONLINE',
  protocolVersion: PROTECTION_PROTOCOL_VERSION,
}
chrome.runtime.sendMessage(bridgeOnline)

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const data = event.data as
    | {
        type?: string
        localId?: string
        requestId?: string
        xdr?: string
        networkPassphrase?: string
      }
    | undefined
  const localId = data?.localId ?? data?.requestId
  if (data?.type !== WINDOW_REQUEST_TYPE || !localId || !data.xdr) return

  const message: RuntimeSignRequestMessage = {
    type: 'SIGN_REQUEST',
    requestId: localId,
    xdr: data.xdr,
    networkPassphrase: data.networkPassphrase,
  }

  chrome.runtime.sendMessage(message, (response: RuntimeSignOutcomeMessage | undefined) => {
    window.postMessage(
      { type: WINDOW_RESPONSE_TYPE, localId, outcome: response?.outcome ?? 'cancel' },
      '*',
    )
  })
})

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return
  const data = event.data as
    | {
        type?: string
        nonce?: unknown
        adapter?: unknown
        protocolVersion?: unknown
        status?: unknown
      }
    | undefined
  if (
    !data ||
    !isProtectionAdapter(data.adapter) ||
    data.protocolVersion !== PROTECTION_PROTOCOL_VERSION
  ) {
    return
  }

  if (data.type === WINDOW_PROTECTION_PROBE_TYPE && isNonce(data.nonce)) {
    const message: RuntimeProtectionHandshakeMessage = {
      type: 'PROTECTION_HANDSHAKE',
      nonce: data.nonce,
      adapter: data.adapter,
      protocolVersion: PROTECTION_PROTOCOL_VERSION,
    }
    chrome.runtime.sendMessage(message, (response: { accepted?: boolean } | undefined) => {
      if (chrome.runtime.lastError || response?.accepted !== true) return
      window.postMessage(
        {
          type: WINDOW_PROTECTION_RESPONSE_TYPE,
          nonce: data.nonce,
          adapter: data.adapter,
          protocolVersion: PROTECTION_PROTOCOL_VERSION,
        },
        window.location.origin,
      )
    })
    return
  }

  if (data.type === WINDOW_PROTECTION_ACK_TYPE && isNonce(data.nonce)) {
    const message: RuntimeProtectionHandshakeAckMessage = {
      type: 'PROTECTION_HANDSHAKE_ACK',
      nonce: data.nonce,
      adapter: data.adapter,
      protocolVersion: PROTECTION_PROTOCOL_VERSION,
    }
    chrome.runtime.sendMessage(message)
    return
  }

  if (
    data.type === WINDOW_PROTECTION_ADAPTER_STATUS_TYPE &&
    (data.status === 'adapter-incompatible' || data.status === 'unsupported')
  ) {
    const message: RuntimeProtectionAdapterStatusMessage = {
      type: 'PROTECTION_ADAPTER_STATUS',
      adapter: data.adapter,
      status: data.status,
      protocolVersion: PROTECTION_PROTOCOL_VERSION,
    }
    chrome.runtime.sendMessage(message)
  }
})
