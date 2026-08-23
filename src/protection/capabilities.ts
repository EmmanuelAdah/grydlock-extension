import type { ProtectionAdapter, UnsupportedAdapterRoute } from './protectionState'

export const CAPABILITY_REGISTRY_VERSION = 1

export interface AdapterCapability {
  adapter: ProtectionAdapter
  protocol: string
  supportedBrowsers: readonly ['chromium']
  supportedVersions: string
  exclusions: readonly UnsupportedAdapterRoute[]
}

/**
 * A support claim must be executable.  This registry deliberately describes the page
 * protocols we test, not a vague "wallet supported" label.
 */
export const ADAPTER_CAPABILITIES: readonly AdapterCapability[] = [
  {
    adapter: 'freighter',
    protocol: 'FREIGHTER_EXTERNAL_MSG_REQUEST/SUBMIT_TRANSACTION',
    supportedBrowsers: ['chromium'],
    supportedVersions: 'Freighter external-message protocol v1',
    exclusions: [],
  },
  {
    adapter: 'albedo-popup',
    protocol: 'auth.albedo.link popup tx intent with XDR',
    supportedBrowsers: ['chromium'],
    supportedVersions: 'Albedo popup intent protocol with an XDR payload',
    exclusions: ['albedo-implicit', 'albedo-pay-without-xdr', 'albedo-sep-0007'],
  },
] as const

export const UNSUPPORTED_ROUTES: Readonly<Record<UnsupportedAdapterRoute, string>> = {
  'albedo-implicit': 'Albedo implicit/session intents bypass the popup and are not inspected.',
  'albedo-pay-without-xdr': 'Albedo pay intents without an XDR payload are not inspected.',
  'albedo-sep-0007': 'Albedo SEP-0007 redirect handling is not inspected.',
}

export function capabilityFor(adapter: ProtectionAdapter): AdapterCapability {
  const capability = ADAPTER_CAPABILITIES.find((entry) => entry.adapter === adapter)
  if (!capability) throw new Error(`Missing capability registry entry for ${adapter}`)
  return capability
}
