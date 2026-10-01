import type { Chain, Hex, WalletClient } from 'viem'
import {
  encodeFunctionData,
  erc20Abi,
  parseSignature,
  parseUnits,
  toHex,
  UserRejectedRequestError,
  type Address,
} from 'viem'
import { base } from 'viem/chains'
import { USDC_BASE_ADDRESS, USDC_DECIMALS } from '@/config/metoken'
import { getBasePublicClient } from '@/config/base-client'
import type { SendOpsResult, SmartWalletOp } from '@/hooks/use-smart-wallet-ops'

/** Minimum native ETH (wei) required before attempting an unsponsored EOA transfer. */
const MIN_EOA_GAS_WEI = 50_000_000_000_000n // 0.00005 ETH

function getErrorCause(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('cause' in error)) return undefined
  return (error as { cause?: unknown }).cause
}

/** True when the wallet declined signing or sending (EIP-1193 4001 and common wrappers). */
export function isUserRejectedWalletRequest(error: unknown): boolean {
  for (let current: unknown = error; current != null; current = getErrorCause(current)) {
    if (current instanceof UserRejectedRequestError) return true

    if (typeof current === 'object') {
      const record = current as Record<string, unknown>
      if (record.code === UserRejectedRequestError.code) return true
      if (record.name === 'UserRejectedRequestError') return true
    }

    if (current instanceof Error) {
      const message = current.message.toLowerCase()
      if (
        message.includes('user rejected') ||
        message.includes('user denied') ||
        message.includes('rejected the request')
      ) {
        return true
      }
    }
  }
  return false
}

/** EIP-712 domain for native USDC on Base (Circle FiatTokenV2). */
export const USDC_BASE_EIP712_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: base.id,
  verifyingContract: USDC_BASE_ADDRESS,
} as const

export const USDC_RECEIVE_WITH_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const

const USDC_EIP3009_ABI = [
  {
    type: 'function',
    name: 'receiveWithAuthorization',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const

const AUTH_VALIDITY_SECONDS = 3600n
const AUTH_CLOCK_SKEW_SECONDS = 60n

export interface ResolveMoveUsdcAmountParams {
  signerUsdcBalance: string
  smartUsdcBalance: string | null
  requiredUsdc6: number
  /** When set, move exactly this amount (capped by signer balance). */
  amountWei?: bigint
}

/**
 * Resolve how much USDC (6-decimal wei) to move from the signer EOA to the smart wallet.
 * Prefers the purchase shortfall when it is strictly less than the EOA balance; otherwise
 * moves the full EOA balance. An explicit `amountWei` overrides shortfall math.
 */
export function resolveMoveUsdcAmount({
  signerUsdcBalance,
  smartUsdcBalance,
  requiredUsdc6,
  amountWei,
}: ResolveMoveUsdcAmountParams): bigint {
  const eoaRaw = parseUnits(signerUsdcBalance, USDC_DECIMALS)
  if (eoaRaw <= 0n) return 0n

  if (amountWei !== undefined) {
    if (amountWei <= 0n) return 0n
    return amountWei < eoaRaw ? amountWei : eoaRaw
  }

  const smartRaw = parseUnits(smartUsdcBalance ?? '0', USDC_DECIMALS)
  const shortfall = BigInt(requiredUsdc6) > smartRaw ? BigInt(requiredUsdc6) - smartRaw : 0n
  return shortfall > 0n && shortfall < eoaRaw ? shortfall : eoaRaw
}

export function createUsdcAuthorizationNonce(): Hex {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toHex(bytes)
}

export interface UsdcReceiveAuthorizationMessage {
  from: Address
  to: Address
  value: bigint
  validAfter: bigint
  validBefore: bigint
  nonce: Hex
}

export function buildUsdcReceiveAuthorizationMessage(
  from: Address,
  to: Address,
  value: bigint,
  nowSeconds: bigint = BigInt(Math.floor(Date.now() / 1000)),
  nonce: Hex = createUsdcAuthorizationNonce(),
): UsdcReceiveAuthorizationMessage {
  if (value <= 0n) {
    throw new Error('Authorization amount must be positive')
  }
  return {
    from,
    to,
    value,
    validAfter: nowSeconds > AUTH_CLOCK_SKEW_SECONDS ? nowSeconds - AUTH_CLOCK_SKEW_SECONDS : 0n,
    validBefore: nowSeconds + AUTH_VALIDITY_SECONDS,
    nonce,
  }
}

export function buildUsdcReceiveWithAuthorizationOp(
  message: UsdcReceiveAuthorizationMessage,
  signature: Hex,
): SmartWalletOp {
  const parsed = parseSignature(signature)
  // Circle USDC expects classic ECDSA v (27/28), not yParity (0/1).
  const v = parsed.v !== undefined ? Number(parsed.v) : parsed.yParity + 27
  const data = encodeFunctionData({
    abi: USDC_EIP3009_ABI,
    functionName: 'receiveWithAuthorization',
    args: [
      message.from,
      message.to,
      message.value,
      message.validAfter,
      message.validBefore,
      message.nonce,
      v,
      parsed.r,
      parsed.s,
    ],
  }) as Hex

  return {
    target: USDC_BASE_ADDRESS,
    data,
    value: 0n,
  }
}

export async function signUsdcReceiveWithAuthorization(
  walletClient: WalletClient,
  signerAddress: Address,
  message: UsdcReceiveAuthorizationMessage,
): Promise<Hex> {
  return walletClient.signTypedData({
    account: signerAddress,
    domain: USDC_BASE_EIP712_DOMAIN,
    types: USDC_RECEIVE_WITH_AUTHORIZATION_TYPES,
    primaryType: 'ReceiveWithAuthorization',
    message,
  })
}

export interface MoveUsdcToSmartWalletParams {
  walletClient: WalletClient
  chain: Chain
  smartAccount: Address
  signerAddress: Address
  signerUsdcBalance: string
  smartUsdcBalance: string | null
  requiredUsdc6: number
  /** Optional exact amount override (Earn sweep). */
  amountWei?: bigint
}

/** Unsponsored EOA ERC-20 transfer (requires Base ETH for gas). */
async function moveUsdcToSmartWallet({
  walletClient,
  chain,
  smartAccount,
  signerAddress,
  signerUsdcBalance,
  smartUsdcBalance,
  requiredUsdc6,
  amountWei,
}: MoveUsdcToSmartWalletParams): Promise<`0x${string}`> {
  const amount = resolveMoveUsdcAmount({
    signerUsdcBalance,
    smartUsdcBalance,
    requiredUsdc6,
    amountWei,
  })
  if (amount <= 0n) {
    throw new Error('No USDC available to move')
  }

  const hash = await walletClient.writeContract({
    address: USDC_BASE_ADDRESS,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [smartAccount, amount],
    chain,
    account: signerAddress,
  })
  await getBasePublicClient().waitForTransactionReceipt({ hash })
  return hash
}

export type SendOpsFn = (ops: SmartWalletOp[]) => Promise<SendOpsResult>

export interface MoveUsdcToSmartWalletGaslessParams extends MoveUsdcToSmartWalletParams {
  sendOps: SendOpsFn
}

/**
 * Gasless EOA→SCA USDC move: signer signs EIP-3009 ReceiveWithAuthorization;
 * the smart wallet submits receiveWithAuthorization as a sponsored UserOp.
 */
async function moveUsdcToSmartWalletGasless({
  walletClient,
  smartAccount,
  signerAddress,
  signerUsdcBalance,
  smartUsdcBalance,
  requiredUsdc6,
  amountWei,
  sendOps,
}: MoveUsdcToSmartWalletGaslessParams): Promise<`0x${string}`> {
  const amount = resolveMoveUsdcAmount({
    signerUsdcBalance,
    smartUsdcBalance,
    requiredUsdc6,
    amountWei,
  })
  if (amount <= 0n) {
    throw new Error('No USDC available to move')
  }

  const message = buildUsdcReceiveAuthorizationMessage(signerAddress, smartAccount, amount)
  const signature = await signUsdcReceiveWithAuthorization(walletClient, signerAddress, message)
  const op = buildUsdcReceiveWithAuthorizationOp(message, signature)
  const { txHash } = await sendOps([op])
  return txHash
}

export interface MoveUsdcToSmartWalletPreferGaslessParams extends MoveUsdcToSmartWalletGaslessParams {
  /** When true, skip the unsponsored EOA fallback entirely. */
  gaslessOnly?: boolean
}

/**
 * Prefer gasless EIP-3009 pull via the smart wallet. If that fails and the signer
 * has enough Base ETH, fall back to a normal EOA transfer; otherwise rethrow a
 * clearer funding error when the failure looks gas-related.
 */
export async function moveUsdcToSmartWalletPreferGasless({
  gaslessOnly = false,
  ...params
}: MoveUsdcToSmartWalletPreferGaslessParams): Promise<`0x${string}`> {
  try {
    return await moveUsdcToSmartWalletGasless(params)
  } catch (gaslessError) {
    if (gaslessOnly || isUserRejectedWalletRequest(gaslessError)) {
      throw gaslessError
    }

    const nativeBalance = await getBasePublicClient().getBalance({
      address: params.signerAddress,
    })
    if (nativeBalance < MIN_EOA_GAS_WEI) {
      const detail = gaslessError instanceof Error ? gaslessError.message : String(gaslessError)
      throw new Error(
        `Could not move USDC without gas. Your signer wallet needs a little ETH on Base, or retry the gasless move. (${detail})`,
      )
    }

    try {
      return await moveUsdcToSmartWallet(params)
    } catch (eoaError) {
      const detail = eoaError instanceof Error ? eoaError.message : String(eoaError)
      throw new Error(`Transfer failed: ${detail}`)
    }
  }
}

export interface TransferUsdcFromSignerParams {
  walletClient: WalletClient
  chain: Chain
  signerAddress: Address
  recipient: Address
  amountWei: bigint
}

export async function transferUsdcFromSigner({
  walletClient,
  chain,
  signerAddress,
  recipient,
  amountWei,
}: TransferUsdcFromSignerParams): Promise<`0x${string}`> {
  if (amountWei <= 0n) {
    throw new Error('Transfer amount must be positive')
  }

  const hash = await walletClient.writeContract({
    address: USDC_BASE_ADDRESS,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [recipient, amountWei],
    chain,
    account: signerAddress,
  })
  await getBasePublicClient().waitForTransactionReceipt({ hash })
  return hash
}
