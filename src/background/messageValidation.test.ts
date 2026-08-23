import { describe, expect, it } from 'vitest'
import {
  MAX_NETWORK_PASSPHRASE_LENGTH,
  MAX_REQUEST_ID_LENGTH,
  MAX_XDR_LENGTH,
  isRuntimeDecisionMadeMessage,
  isRuntimeProtectionAdapterStatusMessage,
  isRuntimeProtectionBridgeOnlineMessage,
  isRuntimeProtectionHandshakeAckMessage,
  isRuntimeProtectionHandshakeMessage,
  isRuntimeSignRequestMessage,
} from './messageValidation'

describe('isRuntimeSignRequestMessage', () => {
  it('accepts valid requests with and without a network passphrase', () => {
    expect(
      isRuntimeSignRequestMessage({
        type: 'SIGN_REQUEST',
        requestId: 'req-1',
        xdr: 'AAAAAg==',
      }),
    ).toBe(true)

    expect(
      isRuntimeSignRequestMessage({
        type: 'SIGN_REQUEST',
        requestId: 'req-2',
        xdr: 'AAAAAg==',
        networkPassphrase: 'Test SDF Network ; September 2015',
      }),
    ).toBe(true)
  })

  it('accepts values exactly at each explicit size limit', () => {
    expect(
      isRuntimeSignRequestMessage({
        type: 'SIGN_REQUEST',
        requestId: 'r'.repeat(MAX_REQUEST_ID_LENGTH),
        xdr: 'A'.repeat(MAX_XDR_LENGTH),
        networkPassphrase: 'n'.repeat(MAX_NETWORK_PASSPHRASE_LENGTH),
      }),
    ).toBe(true)
  })

  it.each([
    null,
    undefined,
    'SIGN_REQUEST',
    [],
    {},
    { type: 'SIGN_REQUEST' },
    { type: 'SIGN_REQUEST', requestId: 'req-1' },
    { type: 'SIGN_REQUEST', requestId: 1, xdr: 'AAAAAg==' },
    { type: 'SIGN_REQUEST', requestId: 'req-1', xdr: 1 },
    { type: 'SIGN_REQUEST', requestId: 'req-1', xdr: 'AAAAAg==', networkPassphrase: 1 },
    { type: 'OTHER', requestId: 'req-1', xdr: 'AAAAAg==' },
  ])('rejects malformed values %#', (message) => {
    expect(isRuntimeSignRequestMessage(message)).toBe(false)
  })

  it.each([
    { type: 'SIGN_REQUEST', requestId: '', xdr: 'AAAAAg==' },
    { type: 'SIGN_REQUEST', requestId: '   ', xdr: 'AAAAAg==' },
    { type: 'SIGN_REQUEST', requestId: 'req-1', xdr: '' },
    { type: 'SIGN_REQUEST', requestId: 'req-1', xdr: '   ' },
    { type: 'SIGN_REQUEST', requestId: 'req-1', xdr: 'AAAAAg==', networkPassphrase: '' },
    { type: 'SIGN_REQUEST', requestId: 'req-1', xdr: 'AAAAAg==', networkPassphrase: '   ' },
  ])('rejects empty required or supplied strings %#', (message) => {
    expect(isRuntimeSignRequestMessage(message)).toBe(false)
  })

  it.each([
    {
      type: 'SIGN_REQUEST',
      requestId: 'r'.repeat(MAX_REQUEST_ID_LENGTH + 1),
      xdr: 'AAAAAg==',
    },
    {
      type: 'SIGN_REQUEST',
      requestId: 'req-1',
      xdr: 'A'.repeat(MAX_XDR_LENGTH + 1),
    },
    {
      type: 'SIGN_REQUEST',
      requestId: 'req-1',
      xdr: 'AAAAAg==',
      networkPassphrase: 'n'.repeat(MAX_NETWORK_PASSPHRASE_LENGTH + 1),
    },
  ])('rejects values over each explicit size limit %#', (message) => {
    expect(isRuntimeSignRequestMessage(message)).toBe(false)
  })
})

describe('protection health message validation', () => {
  const health = {
    type: 'PROTECTION_HANDSHAKE',
    nonce: 'health-nonce',
    adapter: 'freighter',
    protocolVersion: 1,
  }

  it('accepts the closed-set non-financial handshake and acknowledgment shapes', () => {
    expect(
      isRuntimeProtectionBridgeOnlineMessage({
        type: 'PROTECTION_BRIDGE_ONLINE',
        protocolVersion: 1,
      }),
    ).toBe(true)
    expect(isRuntimeProtectionHandshakeMessage(health)).toBe(true)
    expect(
      isRuntimeProtectionHandshakeAckMessage({ ...health, type: 'PROTECTION_HANDSHAKE_ACK' }),
    ).toBe(true)
  })

  it('rejects incompatible, malformed, and value-bearing health payloads', () => {
    expect(isRuntimeProtectionHandshakeMessage({ ...health, protocolVersion: 2 })).toBe(false)
    expect(isRuntimeProtectionHandshakeMessage({ ...health, nonce: '' })).toBe(false)
    expect(isRuntimeProtectionHandshakeMessage({ ...health, xdr: 'AAAA-real-transaction' })).toBe(
      false,
    )
    expect(isRuntimeProtectionHandshakeMessage({ ...health, account: 'GACCOUNT' })).toBe(false)
    expect(
      isRuntimeProtectionHandshakeAckMessage({
        ...health,
        type: 'PROTECTION_HANDSHAKE_ACK',
        decision: 'proceed',
      }),
    ).toBe(false)
    expect(
      isRuntimeProtectionBridgeOnlineMessage({
        type: 'PROTECTION_BRIDGE_ONLINE',
        protocolVersion: 1,
        url: 'https://dapp.example',
      }),
    ).toBe(false)
  })

  it('accepts only known adapter failure classifications', () => {
    expect(
      isRuntimeProtectionAdapterStatusMessage({
        type: 'PROTECTION_ADAPTER_STATUS',
        adapter: 'albedo-popup',
        status: 'unsupported',
        protocolVersion: 1,
      }),
    ).toBe(true)
    expect(
      isRuntimeProtectionAdapterStatusMessage({
        type: 'PROTECTION_ADAPTER_STATUS',
        adapter: 'albedo-popup',
        status: 'healthy',
        protocolVersion: 1,
      }),
    ).toBe(false)
  })
})

describe('isRuntimeDecisionMadeMessage', () => {
  it.each(['proceed', 'cancel'] as const)('accepts a valid %s decision', (decision) => {
    expect(
      isRuntimeDecisionMadeMessage({
        type: 'DECISION_MADE',
        requestId: 'req-1',
        decision,
      }),
    ).toBe(true)
  })

  it.each([
    null,
    undefined,
    [],
    {},
    { type: 'DECISION_MADE' },
    { type: 'DECISION_MADE', requestId: 'req-1' },
    { type: 'DECISION_MADE', requestId: 1, decision: 'proceed' },
    { type: 'DECISION_MADE', requestId: '', decision: 'proceed' },
    { type: 'DECISION_MADE', requestId: 'req-1', decision: 'allow' },
    { type: 'DECISION_MADE', requestId: 'req-1', decision: 1 },
    {
      type: 'DECISION_MADE',
      requestId: 'r'.repeat(MAX_REQUEST_ID_LENGTH + 1),
      decision: 'cancel',
    },
  ])('rejects malformed decisions %#', (message) => {
    expect(isRuntimeDecisionMadeMessage(message)).toBe(false)
  })
})
