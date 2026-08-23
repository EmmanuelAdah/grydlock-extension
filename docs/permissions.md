# Permissions Rationale

This document justifies the current `manifest.json` permission scope, per the Chrome Web Store review guidance on requesting the narrowest permissions a use case actually needs.

## Current scope

- `host_permissions: ["<all_urls>"]`
- Content scripts `mainWorld.js`, `albedoMainWorld.js` (MAIN world), and `bridge.js` all match `<all_urls>`, run at `document_start`, and use `all_frames` so a wallet flow in an embedded dApp cannot silently bypass the protection state.

## Why `<all_urls>` + `document_start` is the current requirement

Gryd Lock's job is to intercept a wallet-signing call (`window.freighterApi.signTransaction`, or Albedo's `window.open('https://albedo.link/confirm', ...)`, see README's "Albedo Interception") **before** the dApp's own code runs, on **whichever site the user happens to be dApp-browsing on**. Two properties of that follow directly:

1. **The set of sites is not knowable in advance.** Any site can embed Stellar wallet-signing integration (a dApp, a DEX front end, a marketplace) — there's no fixed, enumerable list of "Stellar dApp domains" the way there might be for, say, a single SaaS product's extension. Narrowing `matches` to a fixed domain list would silently stop protecting users on every dApp not on that list, which defeats the point of a warn-before-signing tool.
2. **Interception must happen at `document_start`, before user interaction.** `activeTab` only grants host access _after_ the user invokes the extension (clicking the toolbar icon or a context-menu entry) for the current tab. A signing call frequently fires as part of a page's normal load or an early dApp-initiated flow, well before the user has any reason to click the extension icon — by the time `activeTab` access would exist, the moment to intercept has often already passed. This is a hard architectural constraint of MV3's `activeTab`, not a configuration choice.

## Alternatives considered

- **`activeTab` + `optional_host_permissions`, user-triggered "enable on this site":** evaluated and deferred. It would reduce the standing grant, but it reintroduces the timing problem above (the grant only exists after the user acts) and adds a per-site opt-in prompt to a tool whose value proposition is _automatic_ protection on first visit to an unfamiliar dApp — most users skip optional-permission prompts, which would leave exactly the risky, unfamiliar sites unprotected. Revisiting this is tracked as a follow-up once there's Store review feedback or usage data to weigh against the UX cost.
- **Fixed domain allowlist:** rejected — see point 1 above; it doesn't match the actual threat model (an arbitrary/unknown dApp, not a known set of them).

## Mitigations already in place

- `content_security_policy` is scoped to `'self'` for extension pages.
- Named permissions are limited to `storage` and `permissions`. `storage` holds local history,
  protection state, and diagnostics; `permissions` observes user host-access changes. The `windows`
  and `tabs` permissions were removed because the extension APIs used here do not require named
  grants. No `webRequest`, `scripting`, or similar broad API is requested.
- MAIN-world injection is limited to the two files that need it (`mainWorld.js`, `albedoMainWorld.js`); `bridge.js` runs in the isolated content script world. All three execute in frames because they are a single protocol and the toolbar aggregates frame state conservatively.
- The toolbar reports a current per-tab protection status. A missing bridge, stale worker result,
  incompatible wallet protocol, unsupported route, or revoked site access is not presented as
  protected. See [protection coverage](protection-coverage.md) for the precise state model.
- The `permissions` API observes grant changes and verifies a current site grant before accepting a
  health handshake. Navigation invalidates state by tab ID; Gryd Lock does not persist tab URLs,
  origins, document IDs, or browsing history. An origin is held only in worker memory while a
  document is active so a permission event can invalidate that document without writing site data.

## Revisiting this

The optional-per-site alternative was re-evaluated in ADR-0002 and remains deferred: it can only
protect a site after a user grant, while interception needs to exist before a first signing call.
If scope changes in the future, update this file, `README.md`, the Chrome Web Store listing, and
the capability registry together, then re-verify the interception flow manually against a real
Freighter install — the timing constraints make partial coverage easy to misrepresent.
