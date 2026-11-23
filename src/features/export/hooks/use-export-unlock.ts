/**
 * The export dialog's side of the watermark unlock: quote it, pay it, remember it.
 *
 * Split from `utils/export-unlock.ts` the same way Precision splits its client from its
 * orchestrator — the util knows the wire and the cache, this hook knows the order of
 * operations and what the UI may say at each step.
 *
 * `locked` is the default for every project. Nothing here decides whether the mark is drawn:
 * the dialog maps `unlocked` onto `settings.watermark`, and the renderer stamps unless that is
 * explicitly `false`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { formatUnits } from 'viem'
import { useSmartWalletOps } from '@/hooks/use-smart-wallet-ops'
import { buildCrtvaiTransferOp } from '@/shared/web3/build-metoken-payment-op'
import { invalidateWalletTokenBalances } from '@/hooks/invalidate-wallet-balances'
import { useCrtvaiBalance } from '@/hooks/use-crtvai-balance'
import { CRTVAI_DECIMALS } from '@/config/metoken'
import { createLogger } from '@/shared/logging/logger'
import { useWalletContext } from '../deps/wallet'
import {
  fetchExportUnlockQuote,
  readStoredPermit,
  redeemExportUnlockPermit,
  storeExportPermit,
  type ExportUnlockIdentity,
  type ExportUnlockQuote,
} from '../utils/export-unlock'

const log = createLogger('ExportUnlock')

export type ExportUnlockStatus =
  | 'locked'
  | 'quoting'
  | 'paying'
  | 'verifying'
  | 'unlocked'
  | 'error'

export interface UseExportUnlockResult {
  status: ExportUnlockStatus
  unlocked: boolean
  quote: ExportUnlockQuote | null
  /** CRTVAI the unlock costs right now, formatted for display; null until the quote lands. */
  crtvaiCost: string | null
  /** The wallet's CRTVAI balance, formatted. '—' when unknown. */
  balanceFormatted: string
  /** False when the balance is known and below the quote, or the wallet cannot send. */
  canPay: boolean
  /** Why paying is unavailable, for the button's disabled state. */
  blockedReason: 'no-wallet' | 'insufficient' | null
  error: string | null
  /** When the current permit stops being valid, if this project is unlocked. */
  expiresAtMs: number | null
  unlock: () => Promise<void>
  refreshQuote: () => void
}

/** Format meToken wei for display with up to two decimals. */
function formatCrtvai(wei: bigint): string {
  const n = Number(formatUnits(wei, CRTVAI_DECIMALS))
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

/**
 * Re-price when the held quote is missing or has aged out; the server pins the amount anyway,
 * but paying against a stale number would fail verification for no good reason.
 */
async function quoteOrRefresh(
  identity: ExportUnlockIdentity,
  projectId: string,
  current: ExportUnlockQuote | null,
): Promise<ExportUnlockQuote> {
  if (current && current.expiresAtMs > Date.now()) return current
  return fetchExportUnlockQuote(identity, projectId)
}

export function useExportUnlock(options: {
  projectId: string | undefined
  /** Fetch a quote only while the surface that sells it is actually open. */
  enabled: boolean
}): UseExportUnlockResult {
  const { projectId, enabled } = options
  const { account, signerAddress, getAccessToken } = useWalletContext()
  const { sendOps, ready: walletReady } = useSmartWalletOps()
  const queryClient = useQueryClient()
  const { balance, formatted: balanceFormatted } = useCrtvaiBalance(account)

  const [status, setStatus] = useState<ExportUnlockStatus>('locked')
  const [quote, setQuote] = useState<ExportUnlockQuote | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The permit that unlocks this project, kept in state so a successful payment updates the
  // UI without a reload, and in storage so it survives one.
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Re-read on every project/account change: the permit is bound to both.
  useEffect(() => {
    const stored = readStoredPermit(account, projectId)
    setExpiresAtMs(stored?.expiresAtMs ?? null)
    setQuote(null)
    setError(null)
    setStatus(stored ? 'unlocked' : 'locked')
  }, [account, projectId])

  const identity = useMemo<ExportUnlockIdentity | null>(() => {
    if (!signerAddress || !account) return null
    return { getAccessToken, signerAddress, payerAddress: account }
  }, [account, getAccessToken, signerAddress])

  // Bumped by `refreshQuote` to re-run the fetch without adding `status` to the deps — a dep
  // that this effect also writes would re-fire it forever.
  const [quoteNonce, setQuoteNonce] = useState(0)

  useEffect(() => {
    // Price only while the card is on screen, with an identity to bind the purchase to, and
    // only for a project that does not already hold a permit.
    if (!enabled || !identity || !projectId) return
    if (readStoredPermit(account, projectId)) return

    let cancelled = false
    setStatus('quoting')

    void fetchExportUnlockQuote(identity, projectId)
      .then((next) => {
        if (cancelled) return
        setQuote(next)
        setStatus('locked')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // A failed quote must not read as unlocked: the mark stays on and the user is told.
        log.warn('export unlock quote failed', { error: String(err) })
        setError(err instanceof Error ? err.message : 'Could not price the watermark removal')
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [account, enabled, identity, projectId, quoteNonce])

  const refreshQuote = useCallback(() => {
    setError(null)
    setQuoteNonce((nonce) => nonce + 1)
  }, [])

  const minCrtvaiWei = quote ? BigInt(quote.minCrtvaiWei) : null
  const crtvaiCost = minCrtvaiWei !== null ? formatCrtvai(minCrtvaiWei) : null

  const insufficient = minCrtvaiWei !== null && balance !== null && balance < minCrtvaiWei
  const blockedReason: 'no-wallet' | 'insufficient' | null =
    !identity || !walletReady ? 'no-wallet' : insufficient ? 'insufficient' : null

  const unlock = useCallback(async () => {
    if (!identity || !projectId) {
      setError('Connect a wallet to remove the watermark')
      setStatus('error')
      return
    }

    setError(null)
    try {
      const activeQuote = await quoteOrRefresh(identity, projectId, quote)
      if (mountedRef.current) setQuote(activeQuote)

      setStatus('paying')
      // Send exactly the pinned minimum: a smaller transfer is one the server will refuse.
      const { txHash } = await sendOps([buildCrtvaiTransferOp(BigInt(activeQuote.minCrtvaiWei))])

      setStatus('verifying')
      const permit = await redeemExportUnlockPermit(identity, { projectId, paymentTxHash: txHash })
      storeExportPermit(identity.payerAddress, permit)

      if (!mountedRef.current) return
      setExpiresAtMs(permit.expiresAtMs)
      setStatus('unlocked')
      invalidateWalletTokenBalances(queryClient, undefined, account)
    } catch (err) {
      if (!mountedRef.current) return
      log.warn('export unlock failed', { error: String(err) })
      setError(err instanceof Error ? err.message : 'Payment failed')
      setStatus('error')
    }
  }, [account, identity, projectId, queryClient, quote, sendOps])

  return {
    status,
    unlocked: status === 'unlocked',
    quote,
    crtvaiCost,
    balanceFormatted,
    canPay: blockedReason === null && quote !== null,
    blockedReason,
    error,
    expiresAtMs,
    unlock,
    refreshQuote,
  }
}
