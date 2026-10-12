import { describe, expect, it } from 'vitest'
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  parseAbiItem,
  parseAbiParameters,
  type TransactionReceipt,
} from 'viem'

type ReceiptLog = TransactionReceipt['logs'][number]
import { entryPoint07Address } from 'viem/account-abstraction'
import {
  CRTVAI_DIAMOND_ADDRESS,
  verifyCrtvaiPaymentFromReceipt,
} from '../../../api/_pixels-crtvai-payment.js'
import { predictPixelsSmartAccountForSigner } from '../../../api/_pixels-smart-account.js'

const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const userOperationEvent = parseAbiItem(
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
)

const SIGNER = getAddress('0x1111111111111111111111111111111111111111')
const TREASURY = getAddress('0x2222222222222222222222222222222222222222')
const BUNDLER = getAddress('0x3333333333333333333333333333333333333333')
const SMART = predictPixelsSmartAccountForSigner(SIGNER)

function transferLog(from: string, to: string, amount: bigint, logIndex: number): ReceiptLog {
  return {
    address: CRTVAI_DIAMOND_ADDRESS,
    topics: [
      TRANSFER_TOPIC,
      `0x000000000000000000000000${from.slice(2)}`,
      `0x000000000000000000000000${to.slice(2)}`,
    ],
    data: `0x${amount.toString(16).padStart(64, '0')}`,
    logIndex,
    blockHash: '0x0',
    blockNumber: 1n,
    transactionHash: '0x0',
    transactionIndex: 0,
    removed: false,
  } as ReceiptLog
}

function userOpEvent(sender: string, success: boolean, logIndex: number): ReceiptLog {
  const topics = encodeEventTopics({
    abi: [userOperationEvent],
    eventName: 'UserOperationEvent',
    args: {
      userOpHash: `0x${'00'.repeat(32)}`,
      sender: getAddress(sender),
      paymaster: getAddress(`0x${'0'.repeat(40)}`),
    },
  })
  const data = encodeAbiParameters(parseAbiParameters('uint256, bool, uint256, uint256'), [
    0n,
    success,
    0n,
    0n,
  ])
  return {
    address: entryPoint07Address,
    topics,
    data,
    logIndex,
    blockHash: '0x0',
    blockNumber: 1n,
    transactionHash: '0x0',
    transactionIndex: 0,
    removed: false,
  } as ReceiptLog
}

describe('verifyCrtvaiPaymentFromReceipt', () => {
  it('accepts an EOA payer transfer when tx.from is the signer', () => {
    const result = verifyCrtvaiPaymentFromReceipt({
      receipt: {
        status: 'success',
        logs: [transferLog(SIGNER, TREASURY, 5n, 0)],
      },
      txFrom: SIGNER,
      txTo: CRTVAI_DIAMOND_ADDRESS,
      verifiedSignerAddress: SIGNER,
      payerAddress: SIGNER,
      treasuryAddress: TREASURY,
      minAmountWei: 5n,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.logIndex).toBe(0)
  })

  it('accepts a smart-account userOp payment with bundler tx.from', () => {
    const result = verifyCrtvaiPaymentFromReceipt({
      receipt: {
        status: 'success',
        logs: [
          userOpEvent(SMART, true, 0),
          transferLog(SMART, TREASURY, 10n, 1),
        ],
      },
      txFrom: BUNDLER,
      txTo: entryPoint07Address,
      verifiedSignerAddress: SIGNER,
      payerAddress: SMART,
      treasuryAddress: TREASURY,
      minAmountWei: 10n,
    })
    expect(result.ok).toBe(true)
  })

  it('rejects a failed user operation', () => {
    const result = verifyCrtvaiPaymentFromReceipt({
      receipt: {
        status: 'success',
        logs: [
          userOpEvent(SMART, false, 0),
          transferLog(SMART, TREASURY, 10n, 1),
        ],
      },
      txFrom: BUNDLER,
      txTo: entryPoint07Address,
      verifiedSignerAddress: SIGNER,
      payerAddress: SMART,
      treasuryAddress: TREASURY,
      minAmountWei: 10n,
    })
    expect(result.ok).toBe(false)
  })

  it('rejects transfer to wrong treasury', () => {
    const wrongTreasury = getAddress('0x4444444444444444444444444444444444444444')
    const result = verifyCrtvaiPaymentFromReceipt({
      receipt: {
        status: 'success',
        logs: [transferLog(SIGNER, wrongTreasury, 5n, 0)],
      },
      txFrom: SIGNER,
      txTo: CRTVAI_DIAMOND_ADDRESS,
      verifiedSignerAddress: SIGNER,
      payerAddress: SIGNER,
      treasuryAddress: TREASURY,
      minAmountWei: 5n,
    })
    expect(result.ok).toBe(false)
  })

  it('rejects underpayment', () => {
    const result = verifyCrtvaiPaymentFromReceipt({
      receipt: {
        status: 'success',
        logs: [transferLog(SIGNER, TREASURY, 2n, 0)],
      },
      txFrom: SIGNER,
      txTo: CRTVAI_DIAMOND_ADDRESS,
      verifiedSignerAddress: SIGNER,
      payerAddress: SIGNER,
      treasuryAddress: TREASURY,
      minAmountWei: 5n,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/too low/i)
  })

  it('rejects mismatched userOp sender', () => {
    const otherSmart = getAddress('0x5555555555555555555555555555555555555555')
    const result = verifyCrtvaiPaymentFromReceipt({
      receipt: {
        status: 'success',
        logs: [
          userOpEvent(otherSmart, true, 0),
          transferLog(SMART, TREASURY, 10n, 1),
        ],
      },
      txFrom: BUNDLER,
      txTo: entryPoint07Address,
      verifiedSignerAddress: SIGNER,
      payerAddress: SMART,
      treasuryAddress: TREASURY,
      minAmountWei: 10n,
    })
    expect(result.ok).toBe(false)
  })
})
