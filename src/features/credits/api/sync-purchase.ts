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

const SYNC_MAX_ATTEMPTS = 3;
const SYNC_BACKOFF_MS = [1_000, 2_000, 4_000] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSyncSuccess(body: SyncPurchaseResponse): boolean {
  return body.ok || body.reason === 'already_processed';
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

      const retryable =
        lastBody.reason === 'error' ||
        lastBody.reason === 'disabled' ||
        res.status >= 500;

      if (!retryable || attempt === SYNC_MAX_ATTEMPTS - 1) {
        return { ...lastBody, syncPending: true };
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

  return { ...lastBody, syncPending: true };
}
