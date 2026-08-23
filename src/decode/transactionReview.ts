import { FeeBumpTransaction, Networks, TransactionBuilder } from '@stellar/stellar-sdk'
import type { Asset, OperationRecord, Transaction } from '@stellar/stellar-sdk'
import { extractOperationSemantics } from './sorobanSemantics'
import { resolveNetworkPassphrase } from './decodeTransaction'
import {
  REVIEW_POLICY_VERSION,
  REVIEW_SCHEMA_VERSION,
  type ReviewFact,
  type ReviewFinding,
  type ReviewOperation,
  type ReviewTarget,
  type TransactionReview,
} from '../review/model'

/** Exact operation discriminants in @stellar/stellar-sdk 16.0.1. */
export const PINNED_SDK_OPERATION_TYPES = [
  'accountMerge', 'allowTrust', 'beginSponsoringFutureReserves', 'bumpSequence', 'changeTrust',
  'claimClaimableBalance', 'clawback', 'clawbackClaimableBalance', 'createAccount',
  'createClaimableBalance', 'createPassiveSellOffer', 'endSponsoringFutureReserves',
  'extendFootprintTtl', 'inflation', 'invokeHostFunction', 'liquidityPoolDeposit',
  'liquidityPoolWithdraw', 'manageBuyOffer', 'manageData', 'manageSellOffer',
  'pathPaymentStrictReceive', 'pathPaymentStrictSend', 'payment', 'restoreFootprint',
  'revokeAccountSponsorship', 'revokeClaimableBalanceSponsorship', 'revokeDataSponsorship',
  'revokeLiquidityPoolSponsorship', 'revokeOfferSponsorship', 'revokeSignerSponsorship',
  'revokeTrustlineSponsorship', 'setOptions', 'setTrustLineFlags',
] as const

/**
 * `Operation` exposes these helpers in SDK 16.0.1. Four Soroban convenience
 * helpers encode the single `invokeHostFunction` operation discriminant; the
 * rest must be represented directly by the classifier above. The test suite
 * compares this closed set with the installed SDK so upgrades cannot add an
 * operation builder without an explicit review decision.
 */
export const PINNED_SDK_OPERATION_BUILDERS = [
  ...PINNED_SDK_OPERATION_TYPES,
  'createCustomContract',
  'createStellarAssetContract',
  'invokeContractFunction',
  'uploadContractWasm',
] as const

const MAX_OPERATIONS = 100
const MAX_FACTS_PER_OPERATION = 24
const MAX_RENDERED_VALUE = 256

function clean(value: unknown): string {
  const text = Array.from(String(value)).filter((character) => {
    const code = character.codePointAt(0) ?? 0
    return code > 0x1f && (code < 0x7f || code > 0x9f)
  }).join('')
  return text.length > MAX_RENDERED_VALUE ? `${text.slice(0, MAX_RENDERED_VALUE)}…` : text
}

function fact(label: string, value: unknown, provenance: ReviewFact['provenance'] = 'xdr'): ReviewFact {
  return { label, value: clean(value), provenance }
}

function assetLabel(asset: Asset | undefined): string {
  if (!asset || asset.isNative()) return 'XLM'
  return `${asset.getCode()}:${asset.getIssuer()}`
}

function assetFromUnknown(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'isNative' in value) return assetLabel(value as Asset)
  return clean(value)
}

function account(value: string, asset?: string): ReviewTarget {
  return { type: 'account', value: clean(value), asset }
}

function balance(value: string): ReviewTarget {
  return { type: 'claimable-balance', value: clean(value) }
}

function pool(value: string): ReviewTarget {
  return { type: 'liquidity-pool', value: clean(value) }
}

function sourceFor(operation: OperationRecord, transaction: Transaction): string {
  return operation.source ?? transaction.source
}

function stateLimitation(operationIndex: number): ReviewFinding {
  return {
    code: 'ledger-state-not-verified', severity: 'warning', operationIndex,
    title: 'Ledger state was not verified',
    detail: 'This static review cannot confirm balances, trustline state, offer state, or contract execution.',
  }
}

function addSoroban(
  operation: ReviewOperation,
  raw: Extract<OperationRecord, { type: 'invokeHostFunction' }>,
  networkPassphrase: string,
) {
  const semantics = extractOperationSemantics(raw.func, raw.auth ?? [], operation.source, {
    networkPassphrase,
  })
  operation.coverage = semantics.confidence === 'decoded' ? 'understood' : semantics.confidence
  if (semantics.invocation) {
    operation.summary = `Soroban ${semantics.invocation.functionName} invocation`
    operation.targets.push({ type: 'contract', value: semantics.invocation.contractId })
    operation.facts.push(fact('Function', semantics.invocation.functionName, 'static-inference'))
    for (const movement of semantics.movements) {
      operation.facts.push(fact('Token action', movement.kind, 'static-inference'))
      operation.facts.push(fact('Contract', movement.contractId, 'static-inference'))
      // A custom token contract has no reversible code/issuer identity in XDR.
      // Keep its exact contract identity as the asset identity rather than
      // inventing a classic Stellar asset label.
      operation.facts.push(
        fact('Asset', movement.asset ?? `contract:${movement.contractId}`, 'static-inference'),
      )
      if (movement.from) operation.facts.push(fact('From', movement.from, 'static-inference'))
      if (movement.to) operation.targets.push(account(movement.to, movement.asset))
      if (movement.to) operation.facts.push(fact('To', movement.to, 'static-inference'))
      if (movement.spender) operation.facts.push(fact('Spender', movement.spender, 'static-inference'))
      if (movement.amount) operation.facts.push(fact('Amount', movement.amount, 'static-inference'))
    }
  } else {
    operation.summary = `Soroban ${semantics.kind}`
  }
  for (const warning of semantics.warnings) {
    const severity = warning === 'unbounded-approval' || warning === 'token-admin-operation' || warning === 'foreign-authorization'
      ? 'high' as const : 'warning' as const
    operation.findings.push({ code: `soroban-${warning}`, severity, operationIndex: operation.index,
      title: warning.replace(/-/g, ' '), detail: 'Derived from static Soroban call and authorization analysis.' })
  }
  operation.findings.push(stateLimitation(operation.index))
}

function reviewOperation(
  raw: OperationRecord,
  index: number,
  transaction: Transaction,
  networkPassphrase: string,
): ReviewOperation {
  const operation: ReviewOperation = {
    index, type: raw.type, source: clean(sourceFor(raw, transaction)), coverage: 'understood',
    summary: raw.type, facts: [fact('Source', sourceFor(raw, transaction))], targets: [], findings: [],
  }
  const partial = () => { operation.coverage = 'partial'; operation.findings.push(stateLimitation(index)) }
  const addAssetAmount = (asset: Asset, amount: string) => {
    operation.facts.push(fact('Asset', assetLabel(asset))); operation.facts.push(fact('Amount', amount))
  }

  switch (raw.type) {
    case 'createAccount':
      operation.summary = 'Create account'; operation.targets.push(account(raw.destination)); operation.facts.push(fact('Destination', raw.destination), fact('Starting balance', raw.startingBalance)); break
    case 'payment':
      operation.summary = 'Payment'; operation.targets.push(account(raw.destination, assetLabel(raw.asset))); addAssetAmount(raw.asset, raw.amount); operation.facts.push(fact('Destination', raw.destination)); break
    case 'pathPaymentStrictSend':
      operation.summary = 'Path payment (strict send)'; operation.targets.push(account(raw.destination, assetLabel(raw.destAsset))); operation.facts.push(fact('Send asset', assetLabel(raw.sendAsset)), fact('Send amount', raw.sendAmount), fact('Destination', raw.destination), fact('Destination asset', assetLabel(raw.destAsset)), fact('Destination minimum', raw.destMin), fact('Path', raw.path.map(assetLabel).join(' → ') || 'direct')); partial(); break
    case 'pathPaymentStrictReceive':
      operation.summary = 'Path payment (strict receive)'; operation.targets.push(account(raw.destination, assetLabel(raw.destAsset))); operation.facts.push(fact('Send asset', assetLabel(raw.sendAsset)), fact('Send maximum', raw.sendMax), fact('Destination', raw.destination), fact('Destination asset', assetLabel(raw.destAsset)), fact('Destination amount', raw.destAmount), fact('Path', raw.path.map(assetLabel).join(' → ') || 'direct')); partial(); break
    case 'createPassiveSellOffer':
    case 'manageSellOffer':
      operation.summary = raw.type === 'manageSellOffer' ? 'Manage sell offer' : 'Create passive sell offer'; operation.facts.push(fact('Selling', assetLabel(raw.selling)), fact('Buying', assetLabel(raw.buying)), fact('Amount', raw.amount), fact('Price', raw.price)); partial(); break
    case 'manageBuyOffer':
      operation.summary = 'Manage buy offer'; operation.facts.push(fact('Selling', assetLabel(raw.selling)), fact('Buying', assetLabel(raw.buying)), fact('Buy amount', raw.buyAmount), fact('Price', raw.price), fact('Offer ID', raw.offerId)); partial(); break
    case 'setOptions': {
      operation.summary = 'Change account options';
      const entries = Object.entries(raw).filter(([key, value]) => key !== 'type' && key !== 'source' && value !== undefined)
      for (const [key, value] of entries) operation.facts.push(fact(key, typeof value === 'object' ? JSON.stringify(value) : value))
      operation.findings.push({ code: 'authority-change', severity: 'high', operationIndex: index, title: 'Account authority change', detail: 'Signer, threshold, flag, or account-option changes can alter future authorization.' }); break
    }
    case 'changeTrust': operation.summary = 'Change trustline'; operation.facts.push(fact('Asset or pool', assetFromUnknown(raw.line)), fact('Limit', raw.limit)); partial(); break
    case 'allowTrust': operation.summary = 'Set trust authorization'; operation.targets.push(account(raw.trustor)); operation.facts.push(fact('Trustor', raw.trustor), fact('Asset code', raw.assetCode), fact('Authorization', raw.authorize)); operation.findings.push({ code: 'trust-authorization-change', severity: 'high', operationIndex: index, title: 'Trust authorization changed', detail: 'This changes whether another account can hold or trade an issued asset.' }); break
    case 'accountMerge': operation.summary = 'Merge account'; operation.targets.push(account(raw.destination)); operation.facts.push(fact('Destination', raw.destination)); operation.findings.push({ code: 'account-merge', severity: 'critical', operationIndex: index, title: 'Account merge', detail: 'The source account balance is transferred and the account is removed if the operation succeeds.' }); break
    case 'inflation': operation.summary = 'Inflation'; partial(); break
    case 'manageData': operation.summary = 'Manage account data'; operation.facts.push(fact('Key', raw.name), fact('Value', raw.value ? `${raw.value.length} bytes` : 'delete')); operation.findings.push({ code: 'account-data-change', severity: 'warning', operationIndex: index, title: 'Account data change', detail: 'Transaction data is shown by key and length; arbitrary data is not rendered.' }); break
    case 'bumpSequence': operation.summary = 'Bump sequence'; operation.facts.push(fact('Bump to', raw.bumpTo)); break
    case 'createClaimableBalance': operation.summary = 'Create claimable balance'; addAssetAmount(raw.asset, raw.amount); for (const claimant of raw.claimants) { operation.targets.push(account(claimant.destination, assetLabel(raw.asset))); operation.facts.push(fact('Claimant', claimant.destination)) }; partial(); break
    case 'claimClaimableBalance': operation.summary = 'Claim claimable balance'; operation.targets.push(balance(raw.balanceId)); operation.facts.push(fact('Claimable balance ID', raw.balanceId)); partial(); break
    case 'beginSponsoringFutureReserves': operation.summary = 'Begin reserve sponsorship'; operation.targets.push(account(raw.sponsoredId)); operation.facts.push(fact('Sponsored account', raw.sponsoredId)); operation.findings.push({ code: 'sponsorship-change', severity: 'warning', operationIndex: index, title: 'Reserve sponsorship begins', detail: 'Future reserve entries may be sponsored until the matching end operation.' }); break
    case 'endSponsoringFutureReserves': operation.summary = 'End reserve sponsorship'; operation.findings.push({ code: 'sponsorship-change', severity: 'warning', operationIndex: index, title: 'Reserve sponsorship ends', detail: 'Ends the active sponsorship relationship for this source.' }); break
    case 'revokeAccountSponsorship': operation.summary = 'Revoke account sponsorship'; operation.targets.push(account(raw.account)); operation.facts.push(fact('Account', raw.account)); partial(); break
    case 'revokeTrustlineSponsorship': operation.summary = 'Revoke trustline sponsorship'; operation.targets.push(account(raw.account)); operation.facts.push(fact('Account', raw.account), fact('Asset or pool', assetFromUnknown(raw.asset))); partial(); break
    case 'revokeOfferSponsorship': operation.summary = 'Revoke offer sponsorship'; operation.targets.push(account(raw.seller)); operation.facts.push(fact('Seller', raw.seller), fact('Offer ID', raw.offerId)); partial(); break
    case 'revokeDataSponsorship': operation.summary = 'Revoke data sponsorship'; operation.targets.push(account(raw.account)); operation.facts.push(fact('Account', raw.account), fact('Data key', raw.name)); partial(); break
    case 'revokeClaimableBalanceSponsorship': operation.summary = 'Revoke claimable-balance sponsorship'; operation.targets.push(balance(raw.balanceId)); operation.facts.push(fact('Claimable balance ID', raw.balanceId)); partial(); break
    case 'revokeLiquidityPoolSponsorship': operation.summary = 'Revoke liquidity-pool sponsorship'; operation.targets.push(pool(raw.liquidityPoolId)); operation.facts.push(fact('Liquidity pool ID', raw.liquidityPoolId)); partial(); break
    case 'revokeSignerSponsorship': operation.summary = 'Revoke signer sponsorship'; operation.targets.push(account(raw.account)); operation.facts.push(fact('Account', raw.account), fact('Signer', JSON.stringify(raw.signer))); operation.findings.push({ code: 'sponsorship-change', severity: 'warning', operationIndex: index, title: 'Signer sponsorship revoked', detail: 'May change reserve responsibility for an account signer.' }); break
    case 'clawback': operation.summary = 'Clawback asset'; operation.targets.push(account(raw.from, assetLabel(raw.asset))); addAssetAmount(raw.asset, raw.amount); operation.facts.push(fact('From', raw.from)); operation.findings.push({ code: 'clawback', severity: 'critical', operationIndex: index, title: 'Asset clawback', detail: 'An issuer attempts to remove an asset from another account.' }); break
    case 'clawbackClaimableBalance': operation.summary = 'Claw back claimable balance'; operation.targets.push(balance(raw.balanceId)); operation.facts.push(fact('Claimable balance ID', raw.balanceId)); operation.findings.push({ code: 'clawback', severity: 'critical', operationIndex: index, title: 'Claimable balance clawback', detail: 'An issuer attempts to claw back a claimable balance.' }); break
    case 'setTrustLineFlags': operation.summary = 'Set trustline flags'; operation.targets.push(account(raw.trustor, assetLabel(raw.asset))); operation.facts.push(fact('Trustor', raw.trustor), fact('Asset', assetLabel(raw.asset)), fact('Flags', JSON.stringify(raw.flags))); operation.findings.push({ code: 'trust-authorization-change', severity: 'high', operationIndex: index, title: 'Trustline flags changed', detail: 'Changes authorization or clawback-related flags on a trustline.' }); break
    case 'liquidityPoolDeposit': operation.summary = 'Deposit liquidity'; operation.targets.push(pool(raw.liquidityPoolId)); operation.facts.push(fact('Pool ID', raw.liquidityPoolId), fact('Maximum amount A', raw.maxAmountA), fact('Maximum amount B', raw.maxAmountB), fact('Minimum price', raw.minPrice), fact('Maximum price', raw.maxPrice)); partial(); break
    case 'liquidityPoolWithdraw': operation.summary = 'Withdraw liquidity'; operation.targets.push(pool(raw.liquidityPoolId)); operation.facts.push(fact('Pool ID', raw.liquidityPoolId), fact('Shares', raw.amount), fact('Minimum amount A', raw.minAmountA), fact('Minimum amount B', raw.minAmountB)); partial(); break
    case 'invokeHostFunction': addSoroban(operation, raw, networkPassphrase); break
    case 'extendFootprintTtl': operation.summary = 'Extend contract footprint TTL'; operation.facts.push(fact('Extend to ledger', raw.extendTo)); partial(); break
    case 'restoreFootprint': operation.summary = 'Restore contract footprint'; partial(); break
    default: {
      const unknown = raw as never
      operation.coverage = 'opaque'; operation.summary = `Unsupported SDK operation ${(unknown as { type: string }).type}`
      operation.findings.push({ code: 'unsupported-operation', severity: 'warning', operationIndex: index, title: 'Unsupported operation', detail: 'This SDK operation is retained as opaque and cannot be treated as safe.' })
    }
  }
  operation.facts = operation.facts.slice(0, MAX_FACTS_PER_OPERATION)
  return operation
}

function memoFor(transaction: Transaction): ReviewFact | undefined {
  if (!transaction.memo || transaction.memo.type === 'none' || transaction.memo.value === null) return undefined
  const raw = transaction.memo.value
  const value = transaction.memo.type === 'text'
    ? raw.toString()
    : Array.from(raw as Uint8Array).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return fact(`Memo (${transaction.memo.type})`, value)
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function extractTransactionReview(xdr: string, networkPassphrase: string = Networks.PUBLIC): TransactionReview | null {
  if (xdr.length > 1024 * 1024) return null
  try {
    const exactNetwork = resolveNetworkPassphrase(networkPassphrase)
    const parsed = TransactionBuilder.fromXDR(xdr, exactNetwork)
    const inner = parsed instanceof FeeBumpTransaction ? parsed.innerTransaction : parsed
    if (inner.operations.length > MAX_OPERATIONS) return null
    const operations = inner.operations.map((operation, index) =>
      reviewOperation(operation, index, inner, exactNetwork),
    )
    const findings = operations.flatMap((operation) => operation.findings)
    if (operations.length === 0) findings.push({ code: 'empty-transaction', severity: 'warning', title: 'No operations', detail: 'The envelope contains no reviewable operations.' })
    return {
      schemaVersion: REVIEW_SCHEMA_VERSION, policyVersion: REVIEW_POLICY_VERSION, networkPassphrase: exactNetwork,
      xdrDigest: hex(parsed.hash()),
      envelope: { type: parsed instanceof FeeBumpTransaction ? 'fee-bump' : 'transaction', source: inner.source, feeSource: parsed instanceof FeeBumpTransaction ? parsed.feeSource : undefined, operationCount: operations.length },
      memo: memoFor(inner), operations, findings,
    }
  } catch {
    return null
  }
}

export function scoreableTargets(review: TransactionReview): ReviewTarget[] {
  const seen = new Set<string>()
  return review.operations.flatMap((operation) => operation.targets).filter((target) => {
    if (target.type !== 'account') return false
    const key = `${target.type}:${target.value}`
    if (seen.has(key)) return false
    seen.add(key); return true
  })
}
