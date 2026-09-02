import { formatUnits, parseUnits } from 'viem'
import { USDC_DECIMALS } from '@/config/metoken'

export type SendToken = 'usdc' | 'crtvai'

export function parsePositiveAmountWei(amountInput: string, decimals: number): bigint | null {
  if (!amountInput) return null
  try {
    const raw = parseUnits(amountInput, decimals)
    return raw > 0n ? raw : null
  } catch {
    return null
  }
}

export function computeMaxSendableWei(
  token: SendToken,
  usdcBalance: string | null,
  crtvaiBalance: bigint | null,
  gasBufferUsdc6: number,
): bigint {
  if (token === 'crtvai') {
    return crtvaiBalance ?? 0n
  }
  if (!usdcBalance) return 0n
  try {
    const balanceRaw = parseUnits(usdcBalance, USDC_DECIMALS)
    const buffer = BigInt(gasBufferUsdc6)
    return balanceRaw > buffer ? balanceRaw - buffer : 0n
  } catch {
    return 0n
  }
}

export function hasInsufficientSendBalance(
  token: SendToken,
  amountWei: bigint,
  usdcBalance: string | null,
  crtvaiBalance: bigint | null,
  gasBufferUsdc6: number,
): boolean {
  if (token === 'crtvai') {
    return (crtvaiBalance ?? 0n) < amountWei
  }
  if (!usdcBalance) return true
  try {
    const balanceRaw = parseUnits(usdcBalance, USDC_DECIMALS)
    return balanceRaw < amountWei + BigInt(gasBufferUsdc6)
  } catch {
    return true
  }
}

export function formatMaxSendAmount(maxSendableWei: bigint, decimals: number): string {
  if (maxSendableWei <= 0n) return '0'
  return formatUnits(maxSendableWei, decimals)
}
