# ADR-0003: Versioned local transaction review

- **Status:** Proposed
- **Date:** 2026-08-23
- **Decision owners:** Gryd Lock maintainers
- **Related issue/PR:** #126
- **Supersedes:** None
- **Superseded by:** None

## Context

Destination-only scoring could omit authorization changes, contract calls, fee-bump context, and opaque operations while displaying a reassuring score. Review details were also encoded in the popup URL.

## Decision drivers

- Preserve every operation in its original signing order.
- Make incomplete static analysis visible and non-green.
- Keep transaction details local to extension contexts.

## Considered options

### Option A: Extend the destination projection

This cannot represent operation order, typed identifiers, authorization findings, or opaque payloads without becoming an implicit and lossy review schema.

### Option B: Versioned canonical local review model

Parse one bounded review object containing envelope identity, facts, typed targets, coverage, and findings; collect oracle evidence separately; aggregate it by one policy.

## Decision

Use option B. `TransactionReview` is schema and policy versioned. Each parsed operation is `understood`, `partial`, or `opaque`; partial and opaque coverage generates a visible warning. The model retains only static XDR facts and labels ledger-dependent effects as not verified. Only `account` targets may be passed to the legacy destination scorer; claimable-balance, contract, and liquidity-pool identifiers remain typed local review data.

The background worker stores the aggregated review against the existing request ID. The popup receives only the request ID in its URL and retrieves review data from the worker, then displays the exact network, SDK transaction digest, envelope/fee source, memo, findings, and expandable ordered operation details.

## Consequences

- The popup is larger because it can show an honest review rather than a single score.
- A malformed review fails closed (`cancel`) and partial or opaque operations cannot be shown as low risk.
- Live oracle protocol provenance remains governed by issue #125; this ADR consumes only numeric legacy evidence and never claims it is a ledger observation.

## Security and privacy considerations

XDR, amounts, memos, sources, and review findings remain in local extension memory and are removed from popup URL query parameters. Bounds apply to XDR size, operation count, facts, displayed values, and Soroban authorization traversal. The digest is network-bound and binds displayed information to the parsed envelope.

## Validation

Unit/property tests cover schema preservation, operation ordering, malformed XDR, typed claimable balances, fee-bump sources, Soroban transfer extraction, severity aggregation, and popup accessibility. Browser interception retains its existing request/decision contract.

## Revisit criteria

Revisit when the SDK changes its operation union, when a retained audit store is introduced, or when the oracle protocol in #125 supplies versioned evidence.
