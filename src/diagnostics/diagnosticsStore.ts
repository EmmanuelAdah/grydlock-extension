import {
  buildReport,
  parseState,
  recordEvent,
  type DiagnosticEvent,
  type DiagnosticsEnvironment,
  type DiagnosticsReport,
  type DiagnosticsState,
  type HealthCheck,
  type HealthStatus,
} from './diagnostics'

export const DIAGNOSTICS_STORAGE_KEY = 'localDiagnosticsV1'

let writeTail: Promise<void> = Promise.resolve()

function now(): number {
  return Date.now()
}

async function readState(): Promise<DiagnosticsState> {
  const stored = await chrome.storage.local.get(DIAGNOSTICS_STORAGE_KEY)
  return parseState(stored[DIAGNOSTICS_STORAGE_KEY], now())
}

/**
 * Diagnostics must never delay or influence signing.  The serialized write queue avoids
 * lost counters when a burst of runtime events arrives, while callers intentionally do
 * not await it on the signing path.
 */
export function recordDiagnosticEvent(event: DiagnosticEvent): Promise<void> {
  const write = async () => {
    const state = recordEvent(await readState(), event, now())
    await chrome.storage.local.set({ [DIAGNOSTICS_STORAGE_KEY]: state })
  }
  writeTail = writeTail.then(write, write)
  return writeTail
}

export async function clearDiagnostics(): Promise<void> {
  await writeTail
  await chrome.storage.local.remove(DIAGNOSTICS_STORAGE_KEY)
}

function coarseBrowser(): DiagnosticsEnvironment['browser'] {
  const userAgent = navigator.userAgent
  if (/firefox/i.test(userAgent)) return 'firefox'
  if (/chrome|chromium|edg|opr/i.test(userAgent)) return 'chromium'
  return 'other'
}

function coarsePlatform(): DiagnosticsEnvironment['platform'] {
  const platform = navigator.platform.toLowerCase()
  if (platform.includes('win')) return 'windows'
  if (platform.includes('mac')) return 'macos'
  if (platform.includes('linux')) return 'linux'
  return 'other'
}

function browserMajorVersion(): number | null {
  const match = navigator.userAgent.match(/(?:Chrome|Chromium|Firefox|Edg)\/(\d+)/i)
  return match ? Number(match[1]) : null
}

function environment(): DiagnosticsEnvironment {
  return {
    extensionVersion: chrome.runtime.getManifest().version,
    browser: coarseBrowser(),
    browserMajorVersion: browserMajorVersion(),
    platform: coarsePlatform(),
  }
}

export async function exportDiagnostics(
  health: Record<HealthCheck, HealthStatus>,
): Promise<DiagnosticsReport> {
  return buildReport({ state: await readState(), now: now(), environment: environment(), health })
}

/** Test hook that prevents storage queue state from leaking across module tests. */
export function resetDiagnosticsWriteQueueForTest(): void {
  writeTail = Promise.resolve()
}
