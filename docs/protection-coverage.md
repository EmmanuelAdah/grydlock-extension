# Protection coverage, compatibility, and release runbook

## What a protection status means

The toolbar status is scoped to the active tab. Internally, health is tracked per frame and adapter;
the toolbar selects the least-safe current frame result so a known failure in any frame is never
hidden by an unrelated successful heartbeat. `protected` requires a fresh (30-second)
MAIN-world → isolated bridge → worker → MAIN-world acknowledgement using protocol version 1.
It proves only that Gryd Lock's own route is currently communicating. It does **not** prove the
browser will order Gryd Lock before another extension's listener; Chromium does not offer that
guarantee. All other states are intentionally non-protective:

| Status                 | Meaning                                                                  | User action                                                     |
| ---------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `stale`                | A previous result expired, navigation happened, or the worker restarted. | Reload/wait for a fresh check.                                  |
| `bridge-unavailable`   | No content-script bridge record exists for the tab.                      | Do not assume review; reload and check site access.             |
| `worker-unavailable`   | The toolbar cannot obtain a worker result.                               | Do not assume review; retry after the extension recovers.       |
| `permission-denied`    | Site access was revoked.                                                 | Restore site access in browser extension settings, then reload. |
| `adapter-incompatible` | A Freighter protocol was observed but is not supported.                  | Do not assume review.                                           |
| `unsupported`          | The route cannot expose an inspectable transaction.                      | Do not assume review.                                           |
| `unknown`              | No current evidence exists yet.                                          | Wait for the check or reload.                                   |

## Executable capability registry

`src/protection/capabilities.ts` is the source of truth for support claims.

| Adapter      | Chromium support claim                                     | Explicit exclusions                                                                |
| ------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Freighter    | `FREIGHTER_EXTERNAL_MSG_REQUEST` with `SUBMIT_TRANSACTION` | Unknown protocol revisions report `adapter-incompatible`.                          |
| Albedo popup | `auth.albedo.link` popup `tx` intent carrying XDR          | implicit/session, `pay` without XDR, and SEP-0007 redirect routes are unsupported. |

Firefox, Safari, mobile browsers, and every wallet not listed in the registry are unsupported.
Adding a capability requires a registry entry, fixtures proving the protocol, a negative-path test,
and documentation update in the same change.

## Diagnostics privacy contract

Diagnostics are local-only hourly counters with a seven-day bound. Export is user initiated from
the Options history page. The export schema contains a fixed event vocabulary, coarse environment
values, coarse health, and hour-rounded buckets. It intentionally excludes accounts, destinations,
XDR, URLs, request IDs, decisions, fine timestamps, browsing history, and arbitrary errors.

**Clear diagnostics** removes only `localDiagnosticsV1`; it does not remove decision history or
trusted-address policy. Diagnostics writes are queued off the signing path and errors are ignored
after incrementing no signing state, so diagnostics cannot add a decision delay or change an
allow/cancel outcome.

## Chromium release certification

The synthetic E2E suite verifies extension plumbing only. A release with a supported real
Freighter build requires recorded results using the
[certification template](release/freighter-certification-template.md):

1. 20 cold-start trials: fresh Chromium profile, load Gryd Lock and the supported Freighter build,
   then submit a synthetic testnet payment. Record that the warning appears before Freighter.
2. 20 warm-start trials: repeat in an already-running profile.
3. For both sets, record extension and wallet versions, Chromium major version, pass/fail, and the
   coarse failure classification only. Never record XDR, account, destination, URL, screenshot, or
   request ID in the certification artifact.
4. Repeat one trial each after reload, same-origin navigation, cross-origin navigation, in a child
   frame, after service-worker restart, after extension update/reload, and after site permission
   revoke/restore. Each must display the corresponding non-protective state until a fresh check.
5. Run the supported Albedo popup route and assert its three excluded paths remain explicitly
   unsupported rather than inheriting popup support.

The release gate is 20/20 successful cold trials and 20/20 successful warm trials. Any ordering
failure is a release blocker, not a warning to suppress. Attach the redacted trial summary to the
release checklist; do not upload browser profiles or wallet logs.

## Protection SLOs and incident response

- Fresh status: heartbeat acknowledgement in under 30 seconds for 99% of controlled Chromium
  certification trials.
- Revocation visibility: permission removal transitions cached state immediately in the worker;
  the toolbar polling interval is five seconds.
- Recovery: worker restart must never retain `protected`; a new acknowledgement is required.

If a regression is observed: mark affected adapter/browser combinations unsupported in the registry,
stop claiming coverage in release notes/store copy, reproduce with synthetic testnet data, and do
not restore the claim until the certification gate passes again.
