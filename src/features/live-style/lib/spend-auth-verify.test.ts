import {
  type Hex,
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  parseAbiParameters,
} from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { verifyLiveStyleSpendAuth, PERMIT2_ADDRESS } from './spend-auth-verify'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
const OWNER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const SPENDER = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const OTHER = '0xcccccccccccccccccccccccccccccccccccccccc'

function approvalLog(owner: string, spender: string, value: bigint): {
  address: string
  topics: readonly Hex[]
  data: Hex
} {
  const topics = encodeEventTopics({
    abi: erc20Abi,
    eventName: 'Approval',
    args: { owner: owner as `0x${string}`, spender: spender as `0x${string}` },
  }) as [Hex, ...Hex[]]
  const data = encodeAbiParameters(parseAbiParameters('uint256'), [value])
  return {
    address: USDC,
    topics,
    data,
  }
}

function mockClient(overrides: {
  receipt?: {
    status: 'success' | 'reverted'
    blockNumber: bigint
    logs: { address: string; topics: readonly Hex[]; data: Hex }[]
    to?: string
  }
  allowance?: bigint
  permit2?: { amount: bigint; expiration: number }
}) {
  return {
    getTransactionReceipt: vi.fn().mockResolvedValue(
      overrides.receipt ?? {
        status: 'success',
        blockNumber: 1n,
        logs: [approvalLog(OWNER, SPENDER, 3_000_000n)],
        to: OWNER,
      },
    ),
    readContract: vi.fn().mockImplementation(async (req: { address: string; functionName: string }) => {
      if (req.functionName === 'allowance' && req.address === PERMIT2_ADDRESS) {
        const p = overrides.permit2 ?? {
          amount: 3_000_000n,
          expiration: Math.floor(Date.now() / 1000) + 3600,
        }
        return [p.amount, p.expiration, 0]
      }
      if (req.functionName === 'allowance') {
        return overrides.allowance ?? 3_000_000n
      }
      return 0n
    }),
  }
}

describe('verifyLiveStyleSpendAuth', () => {
  const base = {
    proof: '0x' + 'ab'.repeat(32),
    method: 'erc20-approve' as const,
    wallet: OWNER,
    spender: SPENDER,
    usdcToken: USDC,
    minCapUsdc6: 2_000_000n,
    nowMs: Date.now(),
  }

  it('accepts valid erc20 approve proof', async () => {
    const client = mockClient({ allowance: 3_000_000n })
    const result = await verifyLiveStyleSpendAuth({ ...base, client: client as never })
    expect(result).toEqual({ ok: true })
  })

  it('rejects wrong owner in approval log', async () => {
    const client = mockClient({
      receipt: {
        status: 'success',
        blockNumber: 1n,
        logs: [approvalLog(OTHER, SPENDER, 3_000_000n)],
        to: OWNER,
      },
      allowance: 0n,
    })
    const result = await verifyLiveStyleSpendAuth({ ...base, client: client as never })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('usdc_approval_not_found')
  })

  it('rejects wrong spender', async () => {
    const client = mockClient({
      receipt: {
        status: 'success',
        blockNumber: 1n,
        logs: [approvalLog(OWNER, OTHER, 3_000_000n)],
        to: OWNER,
      },
      allowance: 0n,
    })
    const result = await verifyLiveStyleSpendAuth({ ...base, client: client as never })
    expect(result.ok).toBe(false)
  })

  it('rejects cap too low', async () => {
    const client = mockClient({
      receipt: {
        status: 'success',
        blockNumber: 1n,
        logs: [approvalLog(OWNER, SPENDER, 500_000n)],
        to: OWNER,
      },
      allowance: 500_000n,
    })
    const result = await verifyLiveStyleSpendAuth({
      ...base,
      minCapUsdc6: 2_000_000n,
      client: client as never,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('usdc_approval_not_found')
  })

  it('rejects failed tx', async () => {
    const client = mockClient({
      receipt: { status: 'reverted', blockNumber: 1n, logs: [], to: OWNER },
    })
    const result = await verifyLiveStyleSpendAuth({ ...base, client: client as never })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('spend_auth_tx_failed')
  })

  it('rejects bad tx hash proof', async () => {
    const client = mockClient({})
    const result = await verifyLiveStyleSpendAuth({
      ...base,
      proof: 'not-a-hash',
      client: client as never,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_spend_auth_proof')
  })

  it('rejects expired permit2 allowance', async () => {
    const client = mockClient({
      receipt: {
        status: 'success',
        blockNumber: 1n,
        logs: [{ address: PERMIT2_ADDRESS, topics: [], data: '0x' as Hex }],
        to: PERMIT2_ADDRESS,
      },
      allowance: 3_000_000n,
      permit2: { amount: 3_000_000n, expiration: 1 },
    })
    const result = await verifyLiveStyleSpendAuth({
      ...base,
      method: 'permit2',
      nowMs: Date.now(),
      client: client as never,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('permit2_expired')
  })
})
