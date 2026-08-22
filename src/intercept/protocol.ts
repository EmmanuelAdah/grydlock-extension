export type Decision = 'proceed' | 'cancel'
export type Outcome = 'allow' | Decision

export const WINDOW_REQUEST_TYPE = 'GRYDLOCK_REQUEST_OUTCOME'
export const WINDOW_RESPONSE_TYPE = 'GRYDLOCK_OUTCOME_RESPONSE'
export const WINDOW_PROTECTION_PROBE_TYPE = 'GRYDLOCK_PROTECTION_PROBE'
export const WINDOW_PROTECTION_RESPONSE_TYPE = 'GRYDLOCK_PROTECTION_RESPONSE'
export const WINDOW_PROTECTION_ACK_TYPE = 'GRYDLOCK_PROTECTION_ACK'
export const WINDOW_PROTECTION_ADAPTER_STATUS_TYPE = 'GRYDLOCK_PROTECTION_ADAPTER_STATUS'

export type ProtectionAdapter = 'freighter' | 'albedo-popup'

export interface RuntimeProtectionBridgeOnlineMessage {
  type: 'PROTECTION_BRIDGE_ONLINE'
  protocolVersion: number
}

export interface RuntimeProtectionHandshakeMessage {
  type: 'PROTECTION_HANDSHAKE'
  nonce: string
  adapter: ProtectionAdapter
  protocolVersion: number
}

export interface RuntimeProtectionHandshakeAckMessage {
  type: 'PROTECTION_HANDSHAKE_ACK'
  nonce: string
  adapter: ProtectionAdapter
  protocolVersion: number
}

export interface RuntimeProtectionAdapterStatusMessage {
  type: 'PROTECTION_ADAPTER_STATUS'
  adapter: ProtectionAdapter
  status: 'adapter-incompatible' | 'unsupported'
  protocolVersion: number
}

export interface RuntimeProtectionStatusQueryMessage {
  type: 'GET_PROTECTION_STATUS'
  tabId?: number
}

export interface RuntimeClearDiagnosticsMessage {
  type: 'CLEAR_DIAGNOSTICS'
}

export interface RuntimeExportDiagnosticsMessage {
  type: 'EXPORT_DIAGNOSTICS'
}

export interface RuntimeSignRequestMessage {
  type: 'SIGN_REQUEST'
  requestId: string
  xdr: string
  networkPassphrase?: string
}

export interface RuntimeSignOutcomeMessage {
  type: 'SIGN_OUTCOME'
  requestId: string
  outcome: Outcome
}

export interface RuntimeDecisionMadeMessage {
  type: 'DECISION_MADE'
  requestId: string
  decision: Decision
}

export interface RuntimeSignRequestInfo {
  destination: string
  kind: 'payment' | 'contractInvocation'
  asset?: string
  function?: string
  score: number
}
