// @vitest-environment node
import {
  Account,
  Address,
  Asset,
  Contract,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
} from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  extractTransactionReview,
  PINNED_SDK_OPERATION_BUILDERS,
  PINNED_SDK_OPERATION_TYPES,
  scoreableTargets,
} from './transactionReview'
import { aggregateReview } from '../review/policy'

const SOURCE = 'GDR2Q6FLC4L277PFRHOB7OVKDZFURPSU3NVOK5TYB2Q5CVBWH345DLU5'
const DESTINATION = 'GAJBUZ24T66NRCSFEBVRMDU3HC7PQPVORDX6NHD3CWJNMEJEF5TMMR2Z'
const ISSUER = 'GBQ643CLEU2HQDIU6SCFPAHMULF6WDMULUU6RPNLWRNHXDDU76GH7MQK'
const BALANCE_ID = '00000000da0d57da7d4850e7fc10d2a9d0ebc731f7afb40574c03395b17d49149b91f5be'

type TestOperation = Parameters<TransactionBuilder['addOperation']>[0]

function xdr(
  operations: TestOperation[],
  memo?: Memo,
  networkPassphrase: string = Networks.TESTNET,
) {
  const builder = new TransactionBuilder(new Account(SOURCE, '0'), {
    fee: '100',
    networkPassphrase,
  })
  operations.forEach((operation) => builder.addOperation(operation))
  if (memo) builder.addMemo(memo)
  return builder.setTimeout(30).build().toXDR()
}

describe('transaction review schema', () => {
  it('has an explicit SDK compatibility gate for every pinned operation discriminant', () => {
    expect(PINNED_SDK_OPERATION_TYPES).toEqual([
      'accountMerge',
      'allowTrust',
      'beginSponsoringFutureReserves',
      'bumpSequence',
      'changeTrust',
      'claimClaimableBalance',
      'clawback',
      'clawbackClaimableBalance',
      'createAccount',
      'createClaimableBalance',
      'createPassiveSellOffer',
      'endSponsoringFutureReserves',
      'extendFootprintTtl',
      'inflation',
      'invokeHostFunction',
      'liquidityPoolDeposit',
      'liquidityPoolWithdraw',
      'manageBuyOffer',
      'manageData',
      'manageSellOffer',
      'pathPaymentStrictReceive',
      'pathPaymentStrictSend',
      'payment',
      'restoreFootprint',
      'revokeAccountSponsorship',
      'revokeClaimableBalanceSponsorship',
      'revokeDataSponsorship',
      'revokeLiquidityPoolSponsorship',
      'revokeOfferSponsorship',
      'revokeSignerSponsorship',
      'revokeTrustlineSponsorship',
      'setOptions',
      'setTrustLineFlags',
    ])
  })

  it('fails the SDK compatibility gate when a new operation builder is added', () => {
    expect(Object.keys(Operation).sort()).toEqual([...PINNED_SDK_OPERATION_BUILDERS].sort())
  })

  it('preserves memo, amount, issuer, path, source, exact network and digest', () => {
    const review = extractTransactionReview(
      xdr(
        [
          Operation.pathPaymentStrictSend({
            sendAsset: Asset.native(),
            sendAmount: '10',
            destination: DESTINATION,
            destAsset: new Asset('USD', ISSUER),
            destMin: '9',
            path: [Asset.native()],
          }),
        ],
        Memo.text('invoice-42'),
      ),
      Networks.TESTNET,
    )
    expect(review).not.toBeNull()
    expect(review).toMatchObject({
      networkPassphrase: Networks.TESTNET,
      memo: { value: 'invoice-42' },
      envelope: { source: SOURCE },
    })
    expect(review?.xdrDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(review?.operations[0].facts).toEqual(
      expect.arrayContaining([
        { label: 'Send amount', value: '10.0000000', provenance: 'xdr' },
        { label: 'Destination asset', value: `USD:${ISSUER}`, provenance: 'xdr' },
        { label: 'Path', value: 'XLM', provenance: 'xdr' },
      ]),
    )
  })

  it.each([
    ['PUBLIC', Networks.PUBLIC],
    ['TESTNET', Networks.TESTNET],
    ['FUTURENET', Networks.FUTURENET],
    ['custom passphrase', 'Custom network ; 2035'],
  ])('retains the exact %s network identity', (_name, networkPassphrase) => {
    const review = extractTransactionReview(
      xdr(
        [Operation.payment({ destination: DESTINATION, asset: Asset.native(), amount: '1' })],
        undefined,
        networkPassphrase,
      ),
      networkPassphrase,
    )
    expect(review?.networkPassphrase).toBe(networkPassphrase)
    expect(review?.operations[0].targets[0].networkPassphrase).toBe(networkPassphrase)
  })

  it('does not let a low score suppress an account-authority finding', () => {
    const review = extractTransactionReview(
      xdr([
        Operation.payment({ destination: DESTINATION, asset: Asset.native(), amount: '1' }),
        Operation.setOptions({ signer: { ed25519PublicKey: DESTINATION, weight: 1 } }),
      ]),
      Networks.TESTNET,
    )!
    const aggregate = aggregateReview(review, [
      {
        target: { type: 'account', value: DESTINATION, networkPassphrase: Networks.TESTNET },
        score: 1,
        status: 'available',
      },
    ])
    expect(aggregate.severity).toBe('high')
    expect(aggregate.findings.some((finding) => finding.code === 'authority-change')).toBe(true)
  })

  it('retains claimable balance IDs as typed review targets and never scores them as accounts', () => {
    const review = extractTransactionReview(
      xdr([Operation.claimClaimableBalance({ balanceId: BALANCE_ID })]),
      Networks.TESTNET,
    )!
    expect(review.operations[0].targets).toEqual([
      {
        type: 'claimable-balance',
        value: BALANCE_ID,
        networkPassphrase: Networks.TESTNET,
      },
    ])
    expect(scoreableTargets(review)).toEqual([])
  })

  it('preserves fee payer separately from the inner transaction source', () => {
    const inner = new TransactionBuilder(new Account(SOURCE, '0'), {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({ destination: DESTINATION, asset: Asset.native(), amount: '1' }),
      )
      .setTimeout(30)
      .build()
    const feePayer = Keypair.random().publicKey()
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      feePayer,
      '1000',
      inner,
      Networks.TESTNET,
    )
    const review = extractTransactionReview(feeBump.toXDR(), Networks.TESTNET)!
    expect(review.envelope).toMatchObject({ type: 'fee-bump', source: SOURCE, feeSource: feePayer })
  })

  it('preserves all 100 operations in exact order', () => {
    const operations = Array.from({ length: 100 }, (_, index) =>
      Operation.manageData({ name: `key-${index}`, value: String(index) }),
    )
    const review = extractTransactionReview(xdr(operations), Networks.TESTNET)!
    expect(review.operations).toHaveLength(100)
    expect(review.operations.map((operation) => operation.index)).toEqual(
      Array.from({ length: 100 }, (_, index) => index),
    )
  })

  it('rejects an over-limit payload or a review without a supplied network identity', () => {
    // The SDK/XDR schema itself rejects 101-operation envelopes. This guards
    // the additional raw-XDR size boundary before parsing work begins.
    expect(extractTransactionReview('A'.repeat(1024 * 1024 + 1), Networks.TESTNET)).toBeNull()
    expect(
      extractTransactionReview(
        xdr([Operation.payment({ destination: DESTINATION, asset: Asset.native(), amount: '1' })]),
      ),
    ).toBeNull()
  })

  it('integrates Soroban transfer meaning and provenance into the review', () => {
    const contract = new Asset('USDC', ISSUER).contractId(Networks.TESTNET)
    const review = extractTransactionReview(
      xdr([
        new Contract(contract).call(
          'transfer',
          new Address(SOURCE).toScVal(),
          new Address(DESTINATION).toScVal(),
          nativeToScVal(12_000_000n, { type: 'i128' }),
        ),
      ]),
      Networks.TESTNET,
    )!
    expect(review.operations[0]).toMatchObject({
      type: 'invokeHostFunction',
      coverage: 'understood',
    })
    expect(review.operations[0].facts).toEqual(
      expect.arrayContaining([
        { label: 'Function', value: 'transfer', provenance: 'static-inference' },
        { label: 'Asset', value: `contract:${contract}`, provenance: 'static-inference' },
        { label: 'Amount', value: '12000000', provenance: 'static-inference' },
      ]),
    )
    expect(review.operations[0].targets).toEqual(
      expect.arrayContaining([
        { type: 'contract', value: contract, networkPassphrase: Networks.TESTNET },
        { type: 'account', value: DESTINATION, networkPassphrase: Networks.TESTNET },
      ]),
    )
  })

  it('surfaces Soroban deployment and upgrade activity as high-severity findings', () => {
    const contract = new Asset('USDC', ISSUER).contractId(Networks.TESTNET)
    const review = extractTransactionReview(
      xdr([
        Operation.createStellarAssetContract({ asset: new Asset('USDC', ISSUER) }),
        new Contract(contract).call('update_current_contract_wasm'),
      ]),
      Networks.TESTNET,
    )!

    expect(review.operations[0]).toMatchObject({
      coverage: 'understood',
      summary: 'Deploy Stellar asset contract',
    })
    expect(review.operations[0].facts).toEqual(
      expect.arrayContaining([
        { label: 'Created asset', value: `USDC:${ISSUER}`, provenance: 'static-inference' },
      ]),
    )
    expect(review.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'soroban-contract-deployment', severity: 'high' }),
        expect.objectContaining({ code: 'soroban-contract-upgrade', severity: 'high' }),
      ]),
    )
  })

  it('returns a finite non-green outcome for arbitrary malformed XDR strings', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2048 }), (value) => {
        expect(extractTransactionReview(value, Networks.TESTNET)).toBeNull()
      }),
      { numRuns: 200 },
    )
  })
})
