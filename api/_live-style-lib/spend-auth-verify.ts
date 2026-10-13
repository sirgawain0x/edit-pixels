// fallow-ignore-file unused-export,complexity,code-duplication
import {
  type Hex,
  type PublicClient,
  decodeEventLog,
  erc20Abi,
  parseAbi,
} from 'viem'
import type { LiveStyleSpendAuthMethod } from './payment/types.js'

export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const

const permit2Abi = parseAbi([
  'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'event Approval(address indexed owner, address indexed token, address indexed spender, uint160 amount, uint48 expiration)',
])

export type SpendAuthVerifyResult = { ok: true } | { ok: false; reason: string }

function normalizeAddr(addr: string): string {
  return addr.trim().toLowerCase()
}

function parseProofTxHash(proof: string): Hex | null {
  const hash = proof.trim()
  if (!hash.startsWith('0x') || hash.length < 66) return null
  return hash as Hex
}

function hasApprovalLog(
  logs: { address: string; topics: readonly Hex[]; data: Hex }[],
  token: string,
  owner: string,
  spender: string,
  minAmount: bigint,
): boolean {
  const tokenL = normalizeAddr(token)

  for (const log of logs) {
    if (normalizeAddr(log.address) !== tokenL) continue
    try {
      const decoded = decodeEventLog({
        abi: erc20Abi,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      })
      if (decoded.eventName !== 'Approval') continue
      const args = decoded.args as { owner: string; spender: string; value: bigint }
      if (normalizeAddr(args.owner) !== owner) continue
      if (normalizeAddr(args.spender) !== spender) continue
      if (args.value >= minAmount) return true
    } catch {
      // not an Approval log
    }
  }
  return false
}

function hasPermit2ApprovalLog(
  logs: { address: string; topics: readonly Hex[]; data: Hex }[],
  owner: string,
  token: string,
  spender: string,
  minAmount: bigint,
  nowMs: number,
): boolean {
  const permit2 = normalizeAddr(PERMIT2_ADDRESS)
  const tokenL = normalizeAddr(token)

  for (const log of logs) {
    if (normalizeAddr(log.address) !== permit2) continue
    try {
      const decoded = decodeEventLog({
        abi: permit2Abi,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      })
      if (decoded.eventName !== 'Approval') continue
      const args = decoded.args as {
        owner: string
        token: string
        spender: string
        amount: bigint
        expiration: number
      }
      if (normalizeAddr(args.owner) !== owner) continue
      if (normalizeAddr(args.token) !== tokenL) continue
      if (normalizeAddr(args.spender) !== spender) continue
      if (args.amount < minAmount) continue
      if (args.expiration * 1000 <= nowMs) continue
      return true
    } catch {
      // not a Permit2 Approval log
    }
  }
  return false
}

export async function verifyLiveStyleSpendAuth(options: {
  proof: string
  method: LiveStyleSpendAuthMethod
  wallet: string
  spender: string
  usdcToken: `0x${string}`
  minCapUsdc6: bigint
  nowMs: number
  client: PublicClient
}): Promise<SpendAuthVerifyResult> {
  const txHash = parseProofTxHash(spendAuthProofTxHash(options.proof))
  if (!txHash) return { ok: false, reason: 'invalid_spend_auth_proof' }

  const owner = normalizeAddr(options.wallet)
  const spender = normalizeAddr(options.spender)
  const token = normalizeAddr(options.usdcToken)
  if (!owner.startsWith('0x') || owner.length < 42) {
    return { ok: false, reason: 'invalid_wallet' }
  }
  if (!spender.startsWith('0x') || spender.length < 42) {
    return { ok: false, reason: 'invalid_spender' }
  }

  let receipt
  try {
    receipt = await options.client.getTransactionReceipt({ hash: txHash })
  } catch {
    return { ok: false, reason: 'spend_auth_tx_not_found' }
  }

  if (receipt.status !== 'success') {
    return { ok: false, reason: 'spend_auth_tx_failed' }
  }

  const logs = receipt.logs

  if (options.method === 'erc20-approve') {
    if (
      !hasApprovalLog(logs, token, owner, spender, options.minCapUsdc6)
    ) {
      return { ok: false, reason: 'usdc_approval_not_found' }
    }
  } else if (options.method === 'permit2') {
    if (
      !hasPermit2ApprovalLog(
        logs,
        owner,
        token,
        spender,
        options.minCapUsdc6,
        options.nowMs,
      )
    ) {
      return { ok: false, reason: 'permit2_approval_not_found' }
    }
    const permit2Allowance = await options.client.readContract({
      address: PERMIT2_ADDRESS,
      abi: permit2Abi,
      functionName: 'allowance',
      args: [owner as `0x${string}`, options.usdcToken, spender as `0x${string}`],
    })
    const amount = BigInt(permit2Allowance[0])
    const expiration = Number(permit2Allowance[1])
    if (amount < options.minCapUsdc6) {
      return { ok: false, reason: 'permit2_allowance_too_low' }
    }
    if (expiration * 1000 <= options.nowMs) {
      return { ok: false, reason: 'permit2_expired' }
    }
  } else if (options.method === 'coinbase-spend-permission') {
    const permit2Ok = hasPermit2ApprovalLog(
      logs,
      owner,
      token,
      spender,
      options.minCapUsdc6,
      options.nowMs,
    )
    const erc20Ok = hasApprovalLog(logs, token, owner, spender, options.minCapUsdc6)
    if (!permit2Ok && !erc20Ok) {
      return { ok: false, reason: 'coinbase_spend_permission_tx_invalid' }
    }
  } else {
    const _never: never = options.method
    return _never
  }

  const allowance = await options.client.readContract({
    address: options.usdcToken,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner as `0x${string}`, spender as `0x${string}`],
  })

  if (allowance < options.minCapUsdc6) {
    return { ok: false, reason: 'usdc_allowance_too_low' }
  }

  return { ok: true }
}

/** Strip optional `proof|{...}` metadata suffix before on-chain tx lookup. */
export function spendAuthProofTxHash(proof: string): string {
  const pipe = proof.indexOf('|')
  return (pipe === -1 ? proof : proof.slice(0, pipe)).trim()
}
