# ADR-0002: Observable, fresh protection state

- **Status:** Proposed
- **Date:** 2026-08-22
- **Decision owners:** Gryd Lock maintainers
- **Related issue/PR:** #128
- **Supersedes:** None
- **Superseded by:** None

## Context

The extension previously treated injection as implicit and showed a placeholder oracle score in
the toolbar popup. That could create false confidence when site access was revoked, the isolated
bridge was absent, the service worker restarted, or a wallet protocol changed. Chromium does not
guarantee ordering between two extensions' content-script listeners, so a successful injection is
also not proof that Gryd Lock wins every Freighter race.

## Decision

Use a versioned, non-financial health handshake for each tab, frame, and supported adapter:

1. The MAIN-world script emits a probe with only a random ephemeral nonce, adapter name, and
   protocol version.
2. The isolated bridge relays the closed-set probe to the worker.
3. The worker accepts it only for an enabled current-site permission, and the MAIN world must
   acknowledge the response before the worker records `protected`.
4. A status expires after 30 seconds; navigation marks records stale; worker restoration converts
   every formerly protected record to stale. Permission removal converts them to
   `permission-denied`; permission restoration requires a new complete handshake.

The state model is: `protected`, `stale`, `bridge-unavailable`, `worker-unavailable`,
`permission-denied`, `adapter-incompatible`, `unsupported`, and `unknown`. No status record
contains a URL, account, XDR, signing request identifier, or decision.

`protected` means the extension's own route recently completed, not that browser listener ordering
is guaranteed. The user-facing copy states this residual uncertainty explicitly. The self-test is
not a sign request and cannot sign, submit, decode, or expose a transaction.

Inject the three cooperating scripts into all frames. A frame can contain an independent wallet
flow; limiting injection to the top document would create a silent bypass. The toolbar aggregates
per-frame records conservatively, selecting a known non-protective status over an unrelated healthy
frame.

Keep `<all_urls>` host access for automatic `document_start` coverage: optional per-site access
would require a user action before the moment a signing request may occur, creating deceptively
partial first-visit coverage. Add `permissions` to observe revocation. Navigation uses tab IDs and
the review popup uses `chrome.windows` without requesting named `tabs` or `windows` permissions;
both inert named permissions are removed. Neither URL nor browsing history is persisted.

## Consequences

- The toolbar presents actual current-tab protection status instead of an oracle preview. The old
  score preview remains available only through the explicit `?dev=score` developer path.
- A worker restart fails closed to stale until a new heartbeat completes.
- A missing bridge has no record and is displayed as `bridge-unavailable`.
- The capability registry, not generic wallet branding, determines which flows can claim support.
- Diagnostics remain local, bounded, closed-set, and non-critical; any diagnostics failure is
  ignored by signing orchestration.

## Validation

- State-machine and background tests cover freshness, restart invalidation, permission denial,
  missing bridge, unsupported adapter status, and strict health-message validation.
- Playwright lifecycle coverage and the real-wallet certification procedure are required release
  gates; the synthetic Freighter harness is not certification evidence.
- Browser permission, extension-update, and listener-order behavior are recorded in the release
  runbook rather than inferred from a green unit suite.
