// fallow-ignore-file complexity
import {
  type Hex,
  type PublicClient,
  decodeEventLog,
  erc20Abi,
  parseAbi,
} from 'viem'
import type { LiveStyleSpendAuthMethod } from './payment/types'

export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const

const permit2AllowanceAbi = parseAbi([
  'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
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

function txTouchesPermit2(
  logs: { address: string }[],
  txTo: string | null | undefined,
): boolean {
  const permit2 = normalizeAddr(PERMIT2_ADDRESS)
  if (txTo && normalizeAddr(txTo) === permit2) return true
  return logs.some((log) => normalizeAddr(log.address) === permit2)
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

  const blockNumber = receipt.blockNumber
  const logs = receipt.logs

  if (options.method === 'erc20-approve') {
    if (
      !hasApprovalLog(logs, token, owner, spender, options.minCapUsdc6)
    ) {
      return { ok: false, reason: 'usdc_approval_not_found' }
    }
  } else if (options.method === 'permit2') {
    if (!txTouchesPermit2(logs, receipt.to)) {
      return { ok: false, reason: 'permit2_tx_required' }
    }
    const permit2Allowance = await options.client.readContract({
      address: PERMIT2_ADDRESS,
      abi: permit2AllowanceAbi,
      functionName: 'allowance',
      args: [owner as `0x${string}`, options.usdcToken, spender as `0x${string}`],
      blockNumber,
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
    const meta = parseCoinbaseSpendProofMeta(options.proof)
    if (meta?.endTimeMs !== undefined && meta.endTimeMs <= options.nowMs) {
      return { ok: false, reason: 'coinbase_spend_permission_expired' }
    }
    if (!txTouchesPermit2(logs, receipt.to) && !hasApprovalLog(logs, token, owner, spender, 1n)) {
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
    blockNumber,
  })

  if (allowance < options.minCapUsdc6) {
    return { ok: false, reason: 'usdc_allowance_too_low' }
  }

  return { ok: true }
}

/** Optional `proof|{"endTimeMs":...}` suffix for Coinbase spend permission expiry. */
function parseCoinbaseSpendProofMeta(proof: string): { endTimeMs?: number } | null {
  const pipe = proof.indexOf('|')
  if (pipe === -1) return null
  try {
    const json = JSON.parse(proof.slice(pipe + 1)) as { endTimeMs?: number }
    return json
  } catch {
    return null
  }
}

/** Strip Coinbase metadata suffix before on-chain tx lookup. */
export function spendAuthProofTxHash(proof: string): string {
  const pipe = proof.indexOf('|')
  return (pipe === -1 ? proof : proof.slice(0, pipe)).trim()
}
