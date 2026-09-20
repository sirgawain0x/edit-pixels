import type { DirectorBatchQuoteResponse } from './seedance-client'
import { isBatchQuoteExpired } from './director-batch-queue'

/** Server-issued batch quote — survives Director / Agent Engine restarts (localStorage). */
const REMOTE_QUOTE_KEY = 'pixels:director-batch:remote-quote'

export interface DirectorBatchRemoteQuote {
  shotsKey: string
  storyboardId?: string
  /** Server `batchQuoteId` from POST /api/pixels-director-batch-quote — never a client UUID. */
  quote: DirectorBatchQuoteResponse
  savedAtMs: number
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

export function saveDirectorBatchRemoteQuote(payload: DirectorBatchRemoteQuote): void {
  if (!hasStorage()) return
  if (!payload.quote.batchQuoteId?.trim()) return
  window.localStorage.setItem(REMOTE_QUOTE_KEY, JSON.stringify(payload))
}

export function loadDirectorBatchRemoteQuote(
  shotsKey: string,
  storyboardId?: string,
): DirectorBatchRemoteQuote | null {
  if (!hasStorage()) return null
  try {
    const raw = window.localStorage.getItem(REMOTE_QUOTE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DirectorBatchRemoteQuote
    if (!parsed.shotsKey || parsed.shotsKey !== shotsKey) return null
    if (!parsed.quote?.batchQuoteId?.trim()) return null
    if (storyboardId && parsed.storyboardId && parsed.storyboardId !== storyboardId) {
      return null
    }
    if (isBatchQuoteExpired(parsed.quote.expiresAt)) return null
    return parsed
  } catch {
    return null
  }
}

export function clearDirectorBatchRemoteQuote(): void {
  if (!hasStorage()) return
  window.localStorage.removeItem(REMOTE_QUOTE_KEY)
}
