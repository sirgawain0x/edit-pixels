export interface EarnVaultInfo {
  id: string
  name: string
  provider: string
  vaultAddress: string
  caip2: string
  chainId: number | null
  asset: {
    address: string
    symbol: string
    decimals: number
  }
  userApyBps: number | null
  userApyPercent: number | null
  appApyBps: number | null
  tvlUsd: number | null
  availableLiquidityUsd: number | null
}

export interface EarnPositionInfo {
  asset: {
    address: string
    symbol: string
    decimals: number
  }
  assetsInVault: string
  sharesInVault: string
  totalDeposited: string
  totalWithdrawn: string
  assetsInVaultFormatted: string
}

export type EarnActionStatus = 'pending' | 'succeeded' | 'rejected' | 'failed'

export interface EarnActionInfo {
  id: string
  walletId: string
  type: string
  status: EarnActionStatus
  vaultId: string
  amount?: string
  rawAmount?: string | null
  caip2?: string
  failureMessage?: string
}
