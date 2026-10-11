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

const permit2EventsAbi = [
  {
    type: 'event',
    name: 'Approval',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'spender', type: 'address', indexed: true },
      { name: 'amount', type: 'uint160', indexed: false },
      { name: 'expiration', type: 'uint48', indexed: false },
    ],
  },
] as const

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

function permit2ApprovalLog(
  owner: string,
  token: string,
  spender: string,
  amount: bigint,
  expirationSec: number,
): { address: string; topics: readonly Hex[]; data: Hex } {
  const topics = encodeEventTopics({
    abi: permit2EventsAbi,
    eventName: 'Approval',
    args: {
      owner: owner as `0x${string}`,
      token: token as `0x${string}`,
      spender: spender as `0x${string}`,
    },
  }) as [Hex, ...Hex[]]
  const data = encodeAbiParameters(parseAbiParameters('uint160 amount, uint48 expiration'), [
    amount,
    expirationSec,
  ])
  return { address: PERMIT2_ADDRESS, topics, data }
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

  it('rejects permit2 tx that only touches Permit2 without Approval event', async () => {
    const client = mockClient({
      receipt: {
        status: 'success',
        blockNumber: 1n,
        logs: [{ address: PERMIT2_ADDRESS, topics: [], data: '0x' as Hex }],
        to: PERMIT2_ADDRESS,
      },
      allowance: 3_000_000n,
    })
    const result = await verifyLiveStyleSpendAuth({
      ...base,
      method: 'permit2',
      client: client as never,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('permit2_approval_not_found')
  })

  it('rejects expired permit2 allowance in proof tx event', async () => {
    const client = mockClient({
      receipt: {
        status: 'success',
        blockNumber: 1n,
        logs: [permit2ApprovalLog(OWNER, USDC, SPENDER, 3_000_000n, 1)],
        to: PERMIT2_ADDRESS,
      },
      allowance: 3_000_000n,
      permit2: { amount: 3_000_000n, expiration: Math.floor(Date.now() / 1000) + 3600 },
    })
    const nowMs = Date.now()
    const result = await verifyLiveStyleSpendAuth({
      ...base,
      method: 'permit2',
      nowMs,
      client: client as never,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('permit2_approval_not_found')
  })

  it('rejects permit2 when on-chain allowance was revoked after proof tx', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600
    const client = mockClient({
      receipt: {
        status: 'success',
        blockNumber: 1n,
        logs: [permit2ApprovalLog(OWNER, USDC, SPENDER, 3_000_000n, exp)],
        to: PERMIT2_ADDRESS,
      },
      allowance: 3_000_000n,
      permit2: { amount: 0n, expiration: exp },
    })
    const result = await verifyLiveStyleSpendAuth({
      ...base,
      method: 'permit2',
      client: client as never,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('permit2_allowance_too_low')
  })

  it('rejects coinbase-spend-permission with 1-unit erc20 approval only', async () => {
    const client = mockClient({
      receipt: {
        status: 'success',
        blockNumber: 1n,
        logs: [approvalLog(OWNER, SPENDER, 1n)],
        to: OWNER,
      },
      allowance: 3_000_000n,
    })
    const result = await verifyLiveStyleSpendAuth({
      ...base,
      method: 'coinbase-spend-permission',
      proof: `0x${'ab'.repeat(32)}|{"endTimeMs":${Date.now() + 86_400_000}}`,
      client: client as never,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('coinbase_spend_permission_tx_invalid')
  })
})
