/// <reference types="node" />
/**
 * Shared CRTVAI transfer verification for Director, Flow, Seedance, and batch billing.
 * Supports EOA payers and ERC-4337 smart-account payers (bundler as tx.from).
 */
// fallow-ignore-file complexity

import {
  decodeEventLog,
  getAddress,
  parseAbiItem,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem'
import { entryPoint07Address } from 'viem/account-abstraction'
import { predictPixelsSmartAccountForSigner } from './_pixels-smart-account.js'

export const CRTVAI_DIAMOND_ADDRESS = '0xecb695544a3d2a64d579b3828f3f60f6932f4846' as const

const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as const

const userOperationEvent = parseAbiItem(
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
)

export type CrtvaiPaymentVerifyResult =
  | { ok: true; amountWei: bigint; logIndex: number; transferFrom: Address }
  | { ok: false; reason: string }

function topicAddress(addr: Address): Hex {
  return `0x000000000000000000000000${addr.slice(2).toLowerCase()}` as Hex
}

function allowedTransferFromAddresses(signer: Address): Address[] {
  const predicted = predictPixelsSmartAccountForSigner(signer)
  return signer === predicted ? [signer] : [signer, predicted]
}

export function verifyCrtvaiPaymentFromReceipt(options: {
  receipt: Pick<TransactionReceipt, 'status' | 'logs'>
  txFrom: Address
  txTo: Address | null
  verifiedSignerAddress: Address
  payerAddress: Address
  treasuryAddress: Address
  minAmountWei: bigint
}): CrtvaiPaymentVerifyResult {
  if (options.receipt.status !== 'success') {
    return { ok: false, reason: 'Payment transaction failed' }
  }

  const signer = getAddress(options.verifiedSignerAddress)
  const payer = getAddress(options.payerAddress)
  const treasury = getAddress(options.treasuryAddress)
  const predicted = predictPixelsSmartAccountForSigner(signer)

  if (payer !== signer && payer !== predicted) {
    return { ok: false, reason: 'Payment payer is not linked to the authenticated wallet' }
  }

  const payerIsEoa = payer === signer
  const payerIsSmart = payer === predicted

  if (payerIsEoa && options.txFrom.toLowerCase() !== signer.toLowerCase()) {
    return { ok: false, reason: 'Payment sender does not match payer wallet' }
  }

  if (
    payerIsSmart &&
    options.txTo &&
    options.txTo.toLowerCase() === entryPoint07Address.toLowerCase()
  ) {
    const entryLogs = options.receipt.logs.filter(
      (log) => log.address.toLowerCase() === entryPoint07Address.toLowerCase(),
    )
    let sawSuccessfulUserOp = false
    for (const log of entryLogs) {
      try {
        const decoded = decodeEventLog({
          abi: [userOperationEvent],
          data: log.data,
          topics: log.topics,
        })
        if (
          decoded.eventName === 'UserOperationEvent' &&
          getAddress(decoded.args.sender) === predicted &&
          decoded.args.success
        ) {
          sawSuccessfulUserOp = true
          break
        }
      } catch {
        // not a UserOperationEvent
      }
    }
    if (!sawSuccessfulUserOp) {
      return { ok: false, reason: 'No successful user operation for smart account payer' }
    }
  }

  const allowedFrom = new Set(
    allowedTransferFromAddresses(signer).map((a) => a.toLowerCase()),
  )
  const treasuryTopic = topicAddress(treasury)

  const matching: Array<{ logIndex: number; amountWei: bigint; from: Address }> = []
  for (const log of options.receipt.logs) {
    if (log.address.toLowerCase() !== CRTVAI_DIAMOND_ADDRESS.toLowerCase()) continue
    if (!log.topics[0] || log.topics[0].toLowerCase() !== ERC20_TRANSFER_TOPIC) {
      continue
    }
    const fromTopic = log.topics[1]?.toLowerCase()
    const toTopic = log.topics[2]?.toLowerCase()
    if (!fromTopic || !toTopic || toTopic !== treasuryTopic.toLowerCase()) continue
    const fromAddr = getAddress(`0x${fromTopic.slice(-40)}`)
    if (!allowedFrom.has(fromAddr.toLowerCase())) continue
    const amountWei = BigInt(log.data)
    matching.push({ logIndex: log.logIndex, amountWei, from: fromAddr })
  }

  matching.sort((a, b) => a.logIndex - b.logIndex)
  const hit = matching.find((m) => m.amountWei >= options.minAmountWei)
  if (!hit) {
    if (matching.length === 0) {
      return { ok: false, reason: 'No matching CRTVAI transfer to treasury found' }
    }
    const total = matching.reduce((sum, m) => sum + m.amountWei, 0n)
    return {
      ok: false,
      reason: `Payment too low: need ${options.minAmountWei} wei, got ${total}`,
    }
  }

  return {
    ok: true,
    amountWei: hit.amountWei,
    logIndex: hit.logIndex,
    transferFrom: hit.from,
  }
}
