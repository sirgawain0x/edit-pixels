import { describe, expect, it } from 'vitest'
import * as curveQuote from '../../../../api/_metoken-curve-quote.js'
import {
  isRpcTransportError,
  METOKEN_QUOTE_EXPIRY_SECONDS,
  METOKEN_QUOTE_SETTLEMENT_GRACE_SECONDS,
  METOKEN_QUOTE_SLIPPAGE_BPS,
  validateSettlementAgainstQuote,
} from '../../../../api/_metoken-curve-quote.js'
import {
  CallExecutionError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  HttpRequestError,
  RpcRequestError,
  TimeoutError,
} from 'viem'
import { vi } from 'vitest'
import {
  calculateMeTokensMintedPure,
  isWithinSlippageBand,
  type CurveState,
} from '../../../../api/_metoken-curve-math.js'

const MEMO_SUPPLY_CRTVAI = 3.199997731857693174
const MEMO_BALANCE_POOLED_USDC6 = 5_120_001n

function memoCurveState(): CurveState {
  return {
    supplyWei: BigInt(Math.floor(MEMO_SUPPLY_CRTVAI * 1e18)),
    balancePooledUsdc6: MEMO_BALANCE_POOLED_USDC6,
  }
}

describe('isRpcTransportError', () => {
  const emptyCall = {}
  const contractCtx = {
    abi: [] as const,
    functionName: 'totalSupply',
  }

  it('detects a top-level HttpRequestError', () => {
    expect(isRpcTransportError(new HttpRequestError({ url: 'https://rpc.example' }))).toBe(true)
  })

  it('maps wrapped ContractFunctionExecutionError → CallExecutionError → HttpRequestError', () => {
    const http = new HttpRequestError({ url: 'https://rpc.example' })
    const call = new CallExecutionError(http, emptyCall)
    const wrapped = new ContractFunctionExecutionError(call, contractCtx)
    expect(isRpcTransportError(wrapped)).toBe(true)
  })

  it('maps wrapped TimeoutError', () => {
    const timeout = new TimeoutError({ body: {}, url: 'https://rpc.example' })
    const call = new CallExecutionError(timeout, emptyCall)
    expect(isRpcTransportError(new ContractFunctionExecutionError(call, contractCtx))).toBe(true)
  })

  it('maps AbortError by name', () => {
    const abort = new Error('The operation was aborted')
    abort.name = 'AbortError'
    expect(isRpcTransportError(abort)).toBe(true)
  })

  it('does not treat contract reverts as transport errors', () => {
    const revert = new ContractFunctionRevertedError({
      abi: [],
      functionName: 'totalSupply',
      message: 'execution reverted',
    })
    const call = new CallExecutionError(revert, emptyCall)
    const wrapped = new ContractFunctionExecutionError(call, contractCtx)
    expect(isRpcTransportError(wrapped)).toBe(false)
  })

  function rpcRequestError(code: number, message: string, data?: unknown) {
    return new RpcRequestError({
      body: { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [] },
      url: 'https://rpc.example',
      error: data === undefined ? { code, message } : { code, message, data },
    })
  }

  const errorStringRevertData =
    '0x08c379a0000000000000000000000000000000000000000000000000000000000000020' +
    '00000000000000000000000000000000000000000000000000000000000000004' +
    '7465737400000000000000000000000000000000000000000000000000000000'

  it('treats -32000 with plain-text data as transport', () => {
    expect(isRpcTransportError(rpcRequestError(-32_000, 'internal error', 'missing trie node'))).toBe(
      true,
    )
  })

  it('treats -32000 with object data payload as transport', () => {
    expect(
      isRpcTransportError(rpcRequestError(-32_000, 'internal error', { reason: 'missing trie node' })),
    ).toBe(true)
  })

  it('does not classify too-short hex as a revert', () => {
    expect(isRpcTransportError(rpcRequestError(-32_000, 'internal error', '0x12'))).toBe(true)
  })

  it('classifies Error(string) revert return data as a revert', () => {
    expect(isRpcTransportError(rpcRequestError(3, 'execution reverted', errorStringRevertData))).toBe(
      false,
    )
    expect(isRpcTransportError(rpcRequestError(-32_000, 'internal error', errorStringRevertData))).toBe(
      false,
    )
  })

  function revertWrappingRpc(code: number, message: string) {
    const rpc = rpcRequestError(code, message)
    const revert = new ContractFunctionRevertedError({
      abi: [],
      functionName: 'totalSupply',
      message: 'execution reverted',
      cause: rpc,
    })
    const call = new CallExecutionError(revert, emptyCall)
    return new ContractFunctionExecutionError(call, contractCtx)
  }

  it('does not treat revert wrapping RpcRequestError (-32000) as transport', () => {
    expect(isRpcTransportError(revertWrappingRpc(-32_000, 'execution reverted'))).toBe(false)
  })

  it('does not treat revert wrapping RpcRequestError (-32603) as transport', () => {
    expect(isRpcTransportError(revertWrappingRpc(-32_603, 'internal error'))).toBe(false)
  })
})

describe('metoken curve math (memo reference)', () => {
  it('$1 mints ~0.29857 CRTVAI at supply 3.2 and pooled $5.12', () => {
    const minted = calculateMeTokensMintedPure(1_000_000n, memoCurveState())
    const whole = Number(minted) / 1e18
    expect(whole).toBeGreaterThan(0.298)
    expect(whole).toBeLessThan(0.299)
  })
})

describe('quote expiry and slippage', () => {
  it('exports default TTL, grace window, and slippage band', () => {
    expect(METOKEN_QUOTE_EXPIRY_SECONDS).toBe(75)
    expect(METOKEN_QUOTE_SETTLEMENT_GRACE_SECONDS + METOKEN_QUOTE_EXPIRY_SECONDS).toBe(15 * 60)
    expect(METOKEN_QUOTE_SLIPPAGE_BPS).toBe(250)
  })

  it('rejects settlement after grace window', async () => {
    const expiresAtMs =
      Date.now() - (METOKEN_QUOTE_SETTLEMENT_GRACE_SECONDS + 5) * 1000
    await expect(
      validateSettlementAgainstQuote({
        estimatedUsdc6: 1_000_000,
        minCrtvaiWei: 100n,
        expiresAtMs,
        slippageBps: METOKEN_QUOTE_SLIPPAGE_BPS,
      }),
    ).rejects.toMatchObject({ code: 'quote_expired' })
  })

  it('keeps Director checkout valid after wallet delay past the 75s quote TTL', async () => {
    const quotedWei = 298_570_000_000_000_000n
    const mintSpy = vi
      .spyOn(curveQuote, 'readMeTokensMintedForDeposit')
      .mockResolvedValue(quotedWei)

    const issuedAtMs = Date.now() - 90_000
    const expiresAtMs = issuedAtMs + METOKEN_QUOTE_EXPIRY_SECONDS * 1000
    expect(Date.now()).toBeGreaterThan(expiresAtMs)
    expect(Date.now()).toBeLessThanOrEqual(
      expiresAtMs + METOKEN_QUOTE_SETTLEMENT_GRACE_SECONDS * 1000,
    )

    const { validateSettlementAgainstQuote: validateLate } =
      await import('../../../../api/_metoken-curve-quote.js')
    await expect(
      validateLate({
        estimatedUsdc6: 1_000_000,
        minCrtvaiWei: quotedWei,
        expiresAtMs,
        slippageBps: METOKEN_QUOTE_SLIPPAGE_BPS,
      }),
    ).resolves.toBeDefined()

    mintSpy.mockRestore()
  })

  it('rejects when fresh amount exceeds the slippage band', () => {
    const quoted = 298_570_000_000_000_000n
    const fresh = quoted + quoted / 5n
    expect(isWithinSlippageBand(quoted, fresh, METOKEN_QUOTE_SLIPPAGE_BPS)).toBe(false)
    expect(isWithinSlippageBand(quoted, quoted, METOKEN_QUOTE_SLIPPAGE_BPS)).toBe(true)
  })
})
