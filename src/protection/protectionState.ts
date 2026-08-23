/**
 * The protection state is intentionally separate from signing decisions.  It contains no
 * page URL, account, XDR, request identifier, or wallet capability; it only records whether
 * the extension has recently proved that its own execution contexts can communicate.
 */
export const PROTECTION_PROTOCOL_VERSION = 1
export const PROTECTION_FRESHNESS_MS = 30_000

export const PROTECTION_STATUSES = [
  'protected',
  'stale',
  'bridge-unavailable',
  'worker-unavailable',
  'permission-denied',
  'adapter-incompatible',
  'unsupported',
  'unknown',
] as const

export type ProtectionStatus = (typeof PROTECTION_STATUSES)[number]
export type ProtectionAdapter = 'freighter' | 'albedo-popup'
export type UnsupportedAdapterRoute =
  'albedo-implicit' | 'albedo-pay-without-xdr' | 'albedo-sep-0007'

export interface ProtectionRecord {
  tabId: number
  frameId: number
  adapter: ProtectionAdapter
  status: ProtectionStatus
  protocolVersion: number
  checkedAt: number
}

export interface ProtectionSnapshot {
  status: ProtectionStatus
  adapter: ProtectionAdapter | null
  checkedAt: number | null
  freshUntil: number | null
}

export function recordKey(tabId: number, frameId: number, adapter: ProtectionAdapter): string {
  return `${tabId}:${frameId}:${adapter}`
}

export function isCurrentProtocol(protocolVersion: number): boolean {
  return protocolVersion === PROTECTION_PROTOCOL_VERSION
}

export function statusForRecord(record: ProtectionRecord, now: number): ProtectionStatus {
  if (!isCurrentProtocol(record.protocolVersion)) return 'adapter-incompatible'
  if (record.status !== 'protected') return record.status
  return now - record.checkedAt <= PROTECTION_FRESHNESS_MS ? 'protected' : 'stale'
}

export function snapshotForRecord(
  record: ProtectionRecord | undefined,
  now: number,
): ProtectionSnapshot {
  if (!record) {
    return { status: 'bridge-unavailable', adapter: null, checkedAt: null, freshUntil: null }
  }

  return {
    status: statusForRecord(record, now),
    adapter: record.adapter,
    checkedAt: record.checkedAt,
    freshUntil: record.checkedAt + PROTECTION_FRESHNESS_MS,
  }
}

/**
 * The toolbar is deliberately conservative when more than one executable adapter is
 * present in a frame. A recently observed failure for either route wins over an
 * unrelated successful heartbeat, so a tab is never described as protected while a
 * known route in that same document is incompatible or unsupported.
 */
export function snapshotForRecords(
  records: readonly ProtectionRecord[],
  now: number,
): ProtectionSnapshot {
  if (records.length === 0) return snapshotForRecord(undefined, now)

  const severity: Record<ProtectionStatus, number> = {
    'permission-denied': 5,
    'adapter-incompatible': 4,
    unsupported: 3,
    stale: 2,
    'bridge-unavailable': 1,
    'worker-unavailable': 1,
    unknown: 1,
    protected: 0,
  }

  const selected = [...records].sort((left, right) => {
    const severityDifference =
      severity[statusForRecord(right, now)] - severity[statusForRecord(left, now)]
    return severityDifference || right.checkedAt - left.checkedAt
  })[0]

  return snapshotForRecord(selected, now)
}

/** Worker restarts never inherit a healthy result from an earlier worker lifetime. */
export function staleRecords(records: ProtectionRecord[]): ProtectionRecord[] {
  return records.map((record) =>
    record.status === 'protected' ? { ...record, status: 'stale' } : { ...record },
  )
}

export function validateProtectionRecord(value: unknown): ProtectionRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<ProtectionRecord>
  const tabId = record.tabId
  const frameId = record.frameId
  const protocolVersion = record.protocolVersion
  const checkedAt = record.checkedAt
  if (
    typeof tabId !== 'number' ||
    !Number.isInteger(tabId) ||
    typeof frameId !== 'number' ||
    !Number.isInteger(frameId) ||
    (record.adapter !== 'freighter' && record.adapter !== 'albedo-popup') ||
    !(PROTECTION_STATUSES as readonly string[]).includes(record.status ?? '') ||
    typeof protocolVersion !== 'number' ||
    !Number.isInteger(protocolVersion) ||
    typeof checkedAt !== 'number' ||
    !Number.isFinite(checkedAt) ||
    checkedAt < 0
  ) {
    return null
  }
  return {
    tabId,
    frameId,
    adapter: record.adapter,
    status: record.status as ProtectionStatus,
    protocolVersion,
    checkedAt,
  }
}
