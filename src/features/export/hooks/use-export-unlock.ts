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
import {
  useSmartWalletOps,
  type SendOpsResult,
  type SmartWalletOp,
} from '@/hooks/use-smart-wallet-ops'
import { buildCrtvaiTransferOp } from '@/shared/web3/build-metoken-payment-op'
import { invalidateWalletTokenBalances } from '@/hooks/invalidate-wallet-balances'
import { useCrtvaiBalance } from '@/hooks/use-crtvai-balance'
import { CRTVAI_DECIMALS } from '@/config/metoken'
import { createLogger } from '@/shared/logging/logger'
import { useWalletContext } from '../deps/wallet'
import {
  clearPendingPayment,
  fetchExportUnlockQuote,
  readPendingPayment,
  readStoredPermit,
  redeemExportUnlockPermit,
  rememberPendingPayment,
  storeExportPermit,
  type ExportUnlockIdentity,
  type ExportUnlockQuote,
  type PendingExportPayment,
  type StoredExportPermit,
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
  /**
   * True when a transfer has been sent but its permit is not stored yet — "try again" then
   * resumes the claim instead of paying again.
   */
  hasPendingPayment: boolean
  unlock: () => Promise<void>
  refreshQuote: () => void
}

/** Format meToken wei for display with up to two decimals. */
function formatCrtvai(wei: bigint): string {
  const n = Number(formatUnits(wei, CRTVAI_DECIMALS))
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

/** The wallet's call sender, narrowed to what this hook needs. */
type SendOps = (ops: SmartWalletOp[]) => Promise<SendOpsResult>

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

/** Redeem an already-sent payment and keep the permit. Never sends money. */
async function redeemPendingPayment(
  identity: ExportUnlockIdentity,
  projectId: string,
  payment: PendingExportPayment,
): Promise<StoredExportPermit> {
  const permit = await redeemExportUnlockPermit(identity, {
    projectId,
    paymentTxHash: payment.txHash,
    quote: payment.quote,
  })
  storeExportPermit(identity.payerAddress, permit)
  clearPendingPayment(identity.payerAddress, projectId)
  return permit
}

/**
 * Pay for this project's unlock, then redeem it.
 *
 * `onSent` runs between the transfer and the redemption, which is the only window where the
 * money is gone and no permit exists yet — that is why the payment is handed back there for
 * the caller to record.
 */
async function payForUnlock(input: {
  identity: ExportUnlockIdentity
  projectId: string
  quote: ExportUnlockQuote
  sendOps: SendOps
  onSent: (payment: PendingExportPayment) => void
}): Promise<StoredExportPermit> {
  // Send exactly the pinned minimum: a smaller transfer is one the server will refuse.
  const { txHash } = await input.sendOps([buildCrtvaiTransferOp(BigInt(input.quote.minCrtvaiWei))])
  const payment: PendingExportPayment = { txHash, quote: input.quote }
  input.onSent(payment)
  return redeemPendingPayment(input.identity, input.projectId, payment)
}

/** The transfer awaiting redemption: this session's, else whatever storage remembers. */
function currentPending(
  remembered: PendingExportPayment | null,
  identity: ExportUnlockIdentity,
  projectId: string,
): PendingExportPayment | null {
  return remembered ?? readPendingPayment(identity.payerAddress, projectId)
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

  // The transfer that has left the wallet but whose permit is not stored yet, if any.
  const [hasPendingPayment, setHasPendingPayment] = useState(false)
  const pendingRef = useRef<PendingExportPayment | null>(null)

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
    const pending = stored ? null : readPendingPayment(account, projectId)
    pendingRef.current = pending
    setHasPendingPayment(pending !== null)
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

  // Publish a permit that is already stored: the UI only needs to hear about it.
  const finishUnlock = useCallback(
    (permit: StoredExportPermit) => {
      if (!mountedRef.current) return
      setExpiresAtMs(permit.expiresAtMs)
      setHasPendingPayment(false)
      setStatus('unlocked')
      invalidateWalletTokenBalances(queryClient, undefined, account)
    },
    [account, queryClient],
  )

  const unlock = useCallback(async () => {
    if (!identity || !projectId) {
      setError('Connect a wallet to remove the watermark')
      setStatus('error')
      return
    }

    setError(null)
    try {
      // Resume first: if a transfer already left the wallet, the only thing left to do is
      // redeem it. Sending another one would charge twice for the same unlock.
      const pending = currentPending(pendingRef.current, identity, projectId)
      let permit: StoredExportPermit
      if (pending) {
        setStatus('verifying')
        permit = await redeemPendingPayment(identity, projectId, pending)
      } else {
        const activeQuote = await quoteOrRefresh(identity, projectId, quote)
        if (mountedRef.current) setQuote(activeQuote)
        setStatus('paying')
        permit = await payForUnlock({
          identity,
          projectId,
          quote: activeQuote,
          sendOps,
          onSent: (payment) => {
            // Recorded before the redemption so a failure is resumable rather than a second
            // payment; the quote proof travels with it so the server can verify the amount.
            pendingRef.current = payment
            rememberPendingPayment(identity.payerAddress, projectId, payment)
            if (mountedRef.current) setHasPendingPayment(true)
          },
        })
      }

      pendingRef.current = null
      finishUnlock(permit)
    } catch (err) {
      if (!mountedRef.current) return
      log.warn('export unlock failed', { error: String(err), pending: pendingRef.current !== null })
      setError(err instanceof Error ? err.message : 'Payment failed')
      setStatus('error')
    }
  }, [finishUnlock, identity, projectId, quote, sendOps])

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
    hasPendingPayment,
    unlock,
    refreshQuote,
  }
}
