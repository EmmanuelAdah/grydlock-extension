# Freighter release certification template

Use this template for every release that claims Freighter protection. It is a release gate, not a
developer convenience test: a synthetic listener proves extension plumbing only and cannot prove
cross-extension listener ordering.

## Environment

- Gryd Lock version/commit:
- Freighter version/build:
- Chromium major version:
- Platform:
- Certification operator:
- Date (UTC day only):

Do not record accounts, destinations, XDR, dApp URLs, request IDs, browser profiles, screenshots,
wallet logs, or arbitrary error text in this document or linked artifacts.

## Required result

Both trial sets must be **20/20 pass**. A pass means that a synthetic testnet payment displays the
Gryd Lock warning before Freighter receives the signing request. Record only `pass` or one of the
coarse failure classes `ordering`, `injection`, `bridge`, `worker`, `permission`, `protocol`, or
`other`.

| Trial | Cold start | Warm start |
| ----- | ---------- | ---------- |
| 01    |            |            |
| 02    |            |            |
| 03    |            |            |
| 04    |            |            |
| 05    |            |            |
| 06    |            |            |
| 07    |            |            |
| 08    |            |            |
| 09    |            |            |
| 10    |            |            |
| 11    |            |            |
| 12    |            |            |
| 13    |            |            |
| 14    |            |            |
| 15    |            |            |
| 16    |            |            |
| 17    |            |            |
| 18    |            |            |
| 19    |            |            |
| 20    |            |            |

## Required lifecycle checks

Perform one synthetic testnet trial for each check. Verify that the toolbar first shows a
non-protective state where applicable, then that protection returns only after a fresh handshake.

- [ ] Reload
- [ ] Same-origin navigation
- [ ] Cross-origin navigation
- [ ] Child frame
- [ ] New tab
- [ ] Current-site access revoked
- [ ] Current-site access restored
- [ ] Service-worker restart
- [ ] Extension update/reload
- [ ] Albedo popup XDR route
- [ ] Albedo implicit/session route explicitly shown unsupported
- [ ] Albedo pay-without-XDR route explicitly shown unsupported
- [ ] Albedo SEP-0007 route explicitly shown unsupported

## Sign-off

- [ ] 20 cold trials passed.
- [ ] 20 warm trials passed.
- [ ] All lifecycle checks passed.
- [ ] No prohibited data was retained in the certification record.
- [ ] Release approver:

If any box is not checked, do not release with a Freighter protection claim. Mark the affected
adapter/browser combination unsupported in the capability registry and update public support copy.
