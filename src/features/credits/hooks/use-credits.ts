import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useAccount,
  useChain,
  useSignMessage,
  useSmartAccountClient,
} from '@account-kit/react';
import { useSmartWalletOps } from '@/hooks/use-smart-wallet-ops';
import { encodeFunctionData, erc20Abi, maxUint256 } from 'viem';
import { getPaymentContractAddress } from '@/config/billing';
import { USDC_ADDRESS_BY_CHAIN_ID } from '@/config/chains';
import {
  CREDIT_PACKS,
  type CreditPackDefinition,
} from '@/config/credits';
import {
  buildBuyCreditsCalldata,
  classifyPayFailure,
} from '@/features/credits/api/buy-credits';
import {
  buildCreditsAuthMessage,
  generateCreditsNonce,
} from '@/features/credits/api/credits-auth-message';

const ARBITRUM_ONE_CHAIN_ID = 42_161;

interface BalanceResponse {
  balance: number;
  configured: boolean;
  degraded?: boolean;
}

interface DebitResponse {
  ok: boolean;
  balance: number;
  debited?: number;
  reason?: string;
}

interface RedeemResponse {
  ok: boolean;
  creditsGranted: number;
  balance: number;
  reason?: string;
}

interface SyncPurchaseResponse {
  ok: boolean;
  creditsAdded: number;
  balance: number;
  reason?: string;
}

interface ClaimMembershipResponse {
  ok: boolean;
  creditsGranted: number;
  balance: number;
  reason?: string;
}

async function fetchBalance(address: `0x${string}`): Promise<BalanceResponse> {
  const url = new URL('/api/credits-balance', window.location.origin);
  url.searchParams.set('address', address);
  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      return { balance: 0, configured: false, degraded: true };
    }
    return (await res.json()) as BalanceResponse;
  } catch {
    return { balance: 0, configured: false, degraded: true };
  }
}

function formatPurchaseError(error: unknown): string {
  const reason = classifyPayFailure(error);
  if (reason === 'insufficient_balance') {
    return 'Insufficient USDC on Arbitrum. Use Buy USDC to top up first.';
  }
  if (reason === 'session_limit_exceeded') {
    return 'Session spending limit exceeded. Try again later.';
  }
  return error instanceof Error ? error.message : 'Purchase failed';
}

export interface UseCreditsResult {
  balance: number;
  configured: boolean;
  isLoading: boolean;
  isDegraded: boolean;
  hasCredits: boolean;
  refreshBalance: () => void;
  purchasePack: (pack: CreditPackDefinition) => Promise<{ ok: boolean; error?: string }>;
  debitCredits: (
    amount: number,
    reason: 'live_ai' | 'flow_video' | 'flow_image',
    idempotencyKey?: string
  ) => Promise<DebitResponse>;
  redeemPromo: (code: string) => Promise<RedeemResponse>;
  /** Claims the monthly Pixels Premium credit allotment (members only, once per 30 days). */
  claimMembershipCredits: () => Promise<ClaimMembershipResponse>;
}

export function useCredits(): UseCreditsResult {
  const { address } = useAccount({ type: 'LightAccount' });
  const { chain } = useChain();
  const { client } = useSmartAccountClient({ type: 'LightAccount' });
  const { signMessageAsync } = useSignMessage({ client });
  const queryClient = useQueryClient();

  const paymentContract = getPaymentContractAddress();
  const usdcAddress = USDC_ADDRESS_BY_CHAIN_ID[ARBITRUM_ONE_CHAIN_ID];

  const { sendOps } = useSmartWalletOps(client ?? undefined);

  const { data, isLoading } = useQuery({
    queryKey: ['credits-balance', address],
    queryFn: () => fetchBalance(address!),
    enabled: Boolean(address),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const refreshBalance = useCallback(() => {
    if (address) {
      void queryClient.invalidateQueries({ queryKey: ['credits-balance', address] });
    }
  }, [address, queryClient]);

  const signAuth = useCallback(
    async (action: string, extra?: string) => {
      if (!address || !client) throw new Error('Wallet not ready');
      const timestamp = Date.now();
      const nonce = generateCreditsNonce();
      const message = buildCreditsAuthMessage(action, address, timestamp, nonce, extra);
      const signature = await signMessageAsync({ message });
      return { address, timestamp, nonce, signature };
    },
    [address, client, signMessageAsync]
  );

  const purchasePack = useCallback(
    async (pack: CreditPackDefinition): Promise<{ ok: boolean; error?: string }> => {
      if (!client || !address || chain?.id !== ARBITRUM_ONE_CHAIN_ID) {
        return { ok: false, error: 'Connect wallet on Arbitrum' };
      }
      if (!paymentContract || !usdcAddress) {
        return { ok: false, error: 'Payment contract not configured' };
      }

      const buyData = buildBuyCreditsCalldata(pack.id);
      if (!buyData) return { ok: false, error: 'Invalid pack' };

      try {
        const approveData = encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [paymentContract, maxUint256],
        });

        const { txHash } = await sendOps([
          { target: usdcAddress, data: approveData, value: 0n },
          { target: paymentContract, data: buyData, value: 0n },
        ]);

        const syncRes = await fetch('/api/credits-sync-purchase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, txHash }),
        });
        const syncBody = (await syncRes.json()) as SyncPurchaseResponse;
        refreshBalance();
        if (!syncBody.ok) {
          return { ok: false, error: syncBody.reason ?? 'Sync failed' };
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: formatPurchaseError(e) };
      }
    },
    [
      address,
      chain?.id,
      client,
      paymentContract,
      refreshBalance,
      sendOps,
      usdcAddress,
    ]
  );

  const debitCredits = useCallback(
    async (
      amount: number,
      reason: 'live_ai' | 'flow_video' | 'flow_image',
      idempotencyKey?: string
    ): Promise<DebitResponse> => {
      try {
        const auth = await signAuth(
          'debit',
          `amount: ${amount}\nreason: ${reason}`
        );
        const res = await fetch('/api/credits-debit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...auth, amount, reason, idempotencyKey }),
        });
        const body = (await res.json()) as DebitResponse;
        refreshBalance();
        return body;
      } catch {
        return { ok: false, balance: 0, reason: 'network_error' };
      }
    },
    [refreshBalance, signAuth]
  );

  const redeemPromo = useCallback(
    async (code: string): Promise<RedeemResponse> => {
      try {
        const auth = await signAuth('redeem-promo', `code: ${code.trim().toUpperCase()}`);
        const res = await fetch('/api/credits-redeem-promo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...auth, code: code.trim() }),
        });
        const body = (await res.json()) as RedeemResponse;
        refreshBalance();
        return body;
      } catch {
        return { ok: false, creditsGranted: 0, balance: 0, reason: 'network_error' };
      }
    },
    [refreshBalance, signAuth]
  );

  const claimMembershipCredits = useCallback(
    async (): Promise<ClaimMembershipResponse> => {
      try {
        const auth = await signAuth('claim-membership');
        const res = await fetch('/api/credits-claim-membership', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(auth),
        });
        const body = (await res.json()) as ClaimMembershipResponse;
        refreshBalance();
        return body;
      } catch {
        return { ok: false, creditsGranted: 0, balance: 0, reason: 'network_error' };
      }
    },
    [refreshBalance, signAuth]
  );

  const balance = data?.balance ?? 0;
  const isDegraded = data?.degraded === true;

  return {
    balance,
    configured: data?.configured ?? false,
    isLoading,
    isDegraded,
    hasCredits: balance > 0,
    refreshBalance,
    purchasePack,
    debitCredits,
    redeemPromo,
    claimMembershipCredits,
  };
}

export { CREDIT_PACKS };
