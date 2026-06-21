export interface SyncPurchaseResponse {
  ok: boolean;
  creditsAdded: number;
  balance: number;
  reason?: string;
}

export interface SyncPurchaseResult extends SyncPurchaseResponse {
  /** True when on-chain payment succeeded but credits are not yet in Redis. */
  syncPending?: boolean;
}

const SYNC_MAX_ATTEMPTS = 5;
const SYNC_BACKOFF_MS = [1_000, 2_000, 3_000, 5_000, 8_000] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSyncSuccess(body: SyncPurchaseResponse): boolean {
  return body.ok || body.reason === 'already_processed';
}

/** Errors where retry will never succeed — do not show sync-pending UX. */
const TERMINAL_SYNC_REASONS = new Set([
  'buyer_mismatch',
  'pack_mismatch',
  'tx_failed',
]);

function isRetryableSyncFailure(
  reason: string | undefined,
  status: number
): boolean {
  if (reason && TERMINAL_SYNC_REASONS.has(reason)) return false;
  return (
    reason === 'error' ||
    reason === 'disabled' ||
    reason === 'event_not_found' ||
    reason === 'network_error' ||
    status >= 500
  );
}

function shouldMarkSyncPending(
  reason: string | undefined,
  status: number
): boolean {
  if (reason && TERMINAL_SYNC_REASONS.has(reason)) return false;
  return isRetryableSyncFailure(reason, status);
}

/**
 * Idempotently sync credits from an on-chain buyCredits tx. Retries transient failures.
 */
export async function syncPurchaseCredits(
  address: `0x${string}`,
  txHash: `0x${string}`
): Promise<SyncPurchaseResult> {
  let lastBody: SyncPurchaseResponse = {
    ok: false,
    creditsAdded: 0,
    balance: 0,
    reason: 'network_error',
  };

  for (let attempt = 0; attempt < SYNC_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch('/api/credits-sync-purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, txHash }),
      });
      lastBody = (await res.json()) as SyncPurchaseResponse;

      if (isSyncSuccess(lastBody)) {
        return { ...lastBody, ok: true };
      }

      const retryable = isRetryableSyncFailure(lastBody.reason, res.status);

      if (!retryable || attempt === SYNC_MAX_ATTEMPTS - 1) {
        return {
          ...lastBody,
          syncPending: shouldMarkSyncPending(lastBody.reason, res.status),
        };
      }
    } catch {
      if (attempt === SYNC_MAX_ATTEMPTS - 1) {
        return {
          ok: false,
          creditsAdded: 0,
          balance: 0,
          reason: 'network_error',
          syncPending: true,
        };
      }
    }

    await sleep(SYNC_BACKOFF_MS[attempt] ?? 4_000);
  }

  return { ...lastBody, syncPending: shouldMarkSyncPending(lastBody.reason, 0) };
}
