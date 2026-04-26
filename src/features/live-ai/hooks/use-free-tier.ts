import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useSignMessage,
  useSmartAccountClient,
} from '@account-kit/react';

interface ClaimResponse {
  ok: boolean;
  minutesRemaining: number;
  minutesGranted: number;
  reason?: string;
}

interface RemainingResponse {
  minutesRemaining: number;
  configured: boolean;
}

export interface UseFreeTierResult {
  /** Free Live AI minutes remaining this month. 0 when not configured or exhausted. */
  minutesRemaining: number;
  /** True when the server has free-tier storage configured. */
  configured: boolean;
  isLoading: boolean;
  /**
   * Attempts to consume 5 free minutes for the given address. Signs an EIP-191
   * message via the Alchemy smart account and POSTs it for server verification.
   * Resolves with { ok } — ok=false means allowance exhausted, signer unavailable,
   * or server unreachable; caller should fall through to on-chain charging.
   */
  claim: (address: `0x${string}`) => Promise<ClaimResponse>;
}

/**
 * MESSAGE FORMAT — must stay byte-identical to api/claim-free-minutes.ts.
 * Change here and server in the same commit.
 */
function buildFreeTierMessage(
  address: `0x${string}`,
  timestamp: number,
  nonce: string
): string {
  return (
    'Pixels free-tier claim\n' +
    `address: ${address.toLowerCase()}\n` +
    `timestamp: ${timestamp}\n` +
    `nonce: ${nonce}`
  );
}

function generateNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function fetchRemaining(
  address: `0x${string}`
): Promise<RemainingResponse> {
  const url = new URL('/api/free-minutes-remaining', window.location.origin);
  url.searchParams.set('address', address);
  const res = await fetch(url.toString());
  if (!res.ok) return { minutesRemaining: 0, configured: false };
  return (await res.json()) as RemainingResponse;
}

/**
 * Exposes the monthly free-tier allowance (15 min/mo by default) and a claim()
 * function that the billing loop calls once per 5-minute tick before falling
 * back to on-chain USDC charging.
 */
export function useFreeTier(
  address: `0x${string}` | undefined
): UseFreeTierResult {
  const queryClient = useQueryClient();
  const { client } = useSmartAccountClient({ type: 'LightAccount' });
  const { signMessageAsync } = useSignMessage({ client });

  const { data, isLoading } = useQuery({
    queryKey: ['free-tier-remaining', address],
    queryFn: () => fetchRemaining(address!),
    enabled: Boolean(address),
    staleTime: 60_000,
  });

  const claim = useCallback(
    async (addr: `0x${string}`): Promise<ClaimResponse> => {
      if (!client) {
        return { ok: false, minutesRemaining: 0, minutesGranted: 0 };
      }
      const timestamp = Date.now();
      const nonce = generateNonce();
      const message = buildFreeTierMessage(addr, timestamp, nonce);

      let signature: string;
      try {
        signature = await signMessageAsync({ message });
      } catch {
        return { ok: false, minutesRemaining: 0, minutesGranted: 0 };
      }

      const res = await fetch('/api/claim-free-minutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addr, timestamp, nonce, signature }),
      });
      void queryClient.invalidateQueries({
        queryKey: ['free-tier-remaining', addr],
      });
      if (!res.ok) return { ok: false, minutesRemaining: 0, minutesGranted: 0 };
      return (await res.json()) as ClaimResponse;
    },
    [client, queryClient, signMessageAsync]
  );

  return {
    minutesRemaining: data?.minutesRemaining ?? 0,
    configured: data?.configured ?? false,
    isLoading,
    claim,
  };
}
