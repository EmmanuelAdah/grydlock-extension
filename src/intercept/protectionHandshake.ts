import {
  WINDOW_PROTECTION_ACK_TYPE,
  WINDOW_PROTECTION_ADAPTER_STATUS_TYPE,
  WINDOW_PROTECTION_PROBE_TYPE,
  WINDOW_PROTECTION_RESPONSE_TYPE,
  type ProtectionAdapter,
} from './protocol'
import { PROTECTION_PROTOCOL_VERSION } from '../protection/protectionState'

const HEARTBEAT_INTERVAL_MS = 10_000
const PROBE_TIMEOUT_MS = 3_000

/**
 * Proves only the MAIN → isolated bridge → worker route.  Its payload is closed-set
 * metadata plus an ephemeral nonce; it can neither represent nor trigger a signing request.
 */
export function startProtectionHeartbeat(adapter: ProtectionAdapter): void {
  const targetOrigin = window.location.origin

  const sendProbe = () => {
    const nonce = crypto.randomUUID()
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== targetOrigin) return
      const data = event.data as
        { type?: string; nonce?: string; adapter?: string; protocolVersion?: number } | undefined
      if (
        data?.type !== WINDOW_PROTECTION_RESPONSE_TYPE ||
        data.nonce !== nonce ||
        data.adapter !== adapter ||
        data.protocolVersion !== PROTECTION_PROTOCOL_VERSION
      ) {
        return
      }
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timeout)
      window.postMessage(
        {
          type: WINDOW_PROTECTION_ACK_TYPE,
          nonce,
          adapter,
          protocolVersion: PROTECTION_PROTOCOL_VERSION,
        },
        targetOrigin,
      )
    }

    window.addEventListener('message', onMessage)
    const timeout = window.setTimeout(
      () => window.removeEventListener('message', onMessage),
      PROBE_TIMEOUT_MS,
    )
    window.postMessage(
      {
        type: WINDOW_PROTECTION_PROBE_TYPE,
        nonce,
        adapter,
        protocolVersion: PROTECTION_PROTOCOL_VERSION,
      },
      targetOrigin,
    )
  }

  sendProbe()
  window.setInterval(sendProbe, HEARTBEAT_INTERVAL_MS)
}

/** Report an observed but unsupported wallet protocol without carrying its request payload. */
export function reportAdapterStatus(
  adapter: ProtectionAdapter,
  status: 'adapter-incompatible' | 'unsupported',
): void {
  window.postMessage(
    {
      type: WINDOW_PROTECTION_ADAPTER_STATUS_TYPE,
      adapter,
      status,
      protocolVersion: PROTECTION_PROTOCOL_VERSION,
    },
    window.location.origin,
  )
}
