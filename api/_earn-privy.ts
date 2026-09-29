/// <reference types="node" />
/**
 * Privy Earn helpers — vault id, node client, user wallet resolution, deposit/withdraw.
 */
// fallow-ignore-file unused-export,complexity

import {
  PrivyClient,
  isEmbeddedWalletLinkedAccount,
  type LinkedAccountEmbeddedWallet,
} from '@privy-io/node'
import { getBearerToken } from './_wallet-auth.js'

const DEFAULT_EARN_VAULT_ID = 'vault_hls023z3qxu3k0tpklu7sy5w'

let privyNodeClient: PrivyClient | null = null

export function getEarnVaultId(): string {
  return process.env.PRIVY_EARN_VAULT_ID?.trim() || DEFAULT_EARN_VAULT_ID
}

export function getPrivyNodeAuth(): { appId: string; appSecret: string } | null {
  const appId = process.env.PRIVY_APP_ID?.trim() || null
  const appSecret = process.env.PRIVY_APP_SECRET?.trim() || null
  if (!appId || !appSecret) return null
  return { appId, appSecret }
}

export function getPrivyNodeClient(): PrivyClient | null {
  if (!privyNodeClient) {
    const auth = getPrivyNodeAuth()
    if (!auth) return null
    privyNodeClient = new PrivyClient({
      appId: auth.appId,
      appSecret: auth.appSecret,
    })
  }
  return privyNodeClient
}

export function isEarnConfigured(): boolean {
  return Boolean(getPrivyNodeAuth())
}

export interface EarnSession {
  userId: string
  walletId: string
  address: `0x${string}`
  accessToken: string
}

function isEthereumEmbeddedWithId(
  account: LinkedAccountEmbeddedWallet,
): account is LinkedAccountEmbeddedWallet & {
  id: string
  chain_type: 'ethereum'
  address: string
} {
  return (
    account.chain_type === 'ethereum' &&
    typeof account.id === 'string' &&
    account.id.length > 0 &&
    typeof account.address === 'string' &&
    account.address.startsWith('0x')
  )
}

/** Verify Bearer access token and resolve the user's Privy ethereum embedded wallet id. */
export async function resolveEarnSession(request: Request): Promise<EarnSession | null> {
  const accessToken = getBearerToken(request)
  if (!accessToken) return null

  const client = getPrivyNodeClient()
  if (!client) return null

  try {
    const claims = await client.utils().auth().verifyAccessToken(accessToken)
    if (!claims?.user_id) return null

    const user = await client.users()._get(claims.user_id)
    const embedded = user.linked_accounts.find(
      (account): account is LinkedAccountEmbeddedWallet & { id: string; address: string } =>
        isEmbeddedWalletLinkedAccount(account) && isEthereumEmbeddedWithId(account),
    )
    if (!embedded) return null

    return {
      userId: user.id,
      walletId: embedded.id,
      address: embedded.address.toLowerCase() as `0x${string}`,
      accessToken,
    }
  } catch {
    return null
  }
}

export function parsePositiveDecimalAmount(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null
  if (Number(trimmed) <= 0) return null
  return trimmed
}

export function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export interface EarnVaultPublic {
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

export function parseCaip2ChainId(caip2: string): number | null {
  const match = /^eip155:(\d+)$/.exec(caip2)
  if (!match?.[1]) return null
  const chainId = Number(match[1])
  return Number.isFinite(chainId) ? chainId : null
}

export function toEarnVaultPublic(details: {
  id: string
  name: string
  provider: string
  vault_address: string
  caip2: string
  asset: { address: string; symbol: string; decimals: number }
  user_apy: number | null
  app_apy: number | null
  tvl_usd: number | null
  available_liquidity_usd: number | null
}): EarnVaultPublic {
  const userApyBps = details.user_apy
  return {
    id: details.id,
    name: details.name,
    provider: details.provider,
    vaultAddress: details.vault_address,
    caip2: details.caip2,
    chainId: parseCaip2ChainId(details.caip2),
    asset: {
      address: details.asset.address,
      symbol: details.asset.symbol,
      decimals: details.asset.decimals,
    },
    userApyBps,
    userApyPercent: userApyBps === null ? null : userApyBps / 100,
    appApyBps: details.app_apy,
    tvlUsd: details.tvl_usd,
    availableLiquidityUsd: details.available_liquidity_usd,
  }
}

export interface EarnPositionPublic {
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

function formatRawAmount(raw: string, decimals: number): string {
  try {
    const value = BigInt(raw)
    if (decimals <= 0) return value.toString()
    const base = 10n ** BigInt(decimals)
    const whole = value / base
    const frac = value % base
    if (frac === 0n) return whole.toString()
    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
    return `${whole.toString()}.${fracStr}`
  } catch {
    return raw
  }
}

export function toEarnPositionPublic(position: {
  asset: { address: string; symbol: string; decimals: number }
  assets_in_vault: string
  shares_in_vault: string
  total_deposited: string
  total_withdrawn: string
}): EarnPositionPublic {
  return {
    asset: {
      address: position.asset.address,
      symbol: position.asset.symbol,
      decimals: position.asset.decimals,
    },
    assetsInVault: position.assets_in_vault,
    sharesInVault: position.shares_in_vault,
    totalDeposited: position.total_deposited,
    totalWithdrawn: position.total_withdrawn,
    assetsInVaultFormatted: formatRawAmount(position.assets_in_vault, position.asset.decimals),
  }
}

export interface EarnActionPublic {
  id: string
  walletId: string
  type: string
  status: 'pending' | 'succeeded' | 'rejected' | 'failed'
  vaultId: string
  amount?: string
  rawAmount?: string | null
  caip2?: string
  failureMessage?: string
}

export function toEarnActionPublic(action: {
  id: string
  wallet_id: string
  type: string
  status: 'pending' | 'succeeded' | 'rejected' | 'failed'
  vault_id: string
  amount?: string | null
  raw_amount?: string | null
  caip2?: string
  failure_reason?: { message: string } | null
}): EarnActionPublic {
  return {
    id: action.id,
    walletId: action.wallet_id,
    type: action.type,
    status: action.status,
    vaultId: action.vault_id,
    amount: action.amount ?? undefined,
    rawAmount: action.raw_amount,
    caip2: action.caip2,
    failureMessage: action.failure_reason?.message,
  }
}
