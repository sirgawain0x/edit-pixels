import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWalletContext } from '@/context/wallet-context';
import { useSmartWalletOps } from '@/hooks/use-smart-wallet-ops';
import { getPaymentContractAddress } from '@/config/billing';
import { USDC_ADDRESS_BY_CHAIN_ID } from '@/config/chains';
import {
  CREDIT_PACKS,
  type CreditPackDefinition,
} from '@/config/credits';
import {
  buildBuyCreditsApproveCalldata,
  buildBuyCreditsCalldata,
  classifyPayFailure,
} from '@/features/credits/api/buy-credits';
import { syncPurchaseCredits } from '@/features/credits/api/sync-purchase';
import { rankCreditsPurchaseTxHashes } from '@/features/credits/api/resolve-purchase-tx';

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

export interface PurchasePackResult {
  ok: boolean;
  error?: string;
  txHash?: `0x${string}`;
  syncPending?: boolean;
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
  purchasePack: (pack: CreditPackDefinition) => Promise<PurchasePackResult>;
  /** Re-sync credits from a completed on-chain buyCredits tx (idempotent). */
  syncPurchase: (txHash: `0x${string}`) => Promise<PurchasePackResult>;
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
  const { account, chain, authenticated, getAccessToken } = useWalletContext();
  const queryClient = useQueryClient();

  const paymentContract = getPaymentContractAddress();
  const usdcAddress = USDC_ADDRESS_BY_CHAIN_ID[ARBITRUM_ONE_CHAIN_ID];

  const { sendOps } = useSmartWalletOps();

  const { data, isLoading } = useQuery({
    queryKey: ['credits-balance', account],
    queryFn: () => fetchBalance(account!),
    enabled: Boolean(account),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const refreshBalance = useCallback(() => {
    if (account) {
      void queryClient.invalidateQueries({ queryKey: ['credits-balance', account] });
    }
  }, [account, queryClient]);

  const signAuth = useCallback(
    async (action: string, extra?: string) => {
      if (!account || !authenticated) throw new Error('Wallet not ready');
      const token = await getAccessToken();
      if (!token) throw new Error('Authentication token not available');
      const timestamp = Date.now();
      return { account, timestamp, action, extra, token };
    },
    [account, authenticated, getAccessToken]
  );

  const syncPurchase = useCallback(
    async (txHash: `0x${string}`): Promise<PurchasePackResult> => {
      if (!account) {
        return { ok: false, error: 'Connect wallet on Arbitrum' };
      }
      const syncBody = await syncPurchaseCredits(account, txHash);
      refreshBalance();
      if (syncBody.ok) {
        return { ok: true, txHash };
      }
      return {
        ok: false,
        txHash,
        syncPending: syncBody.syncPending,
        error: syncBody.syncPending
          ? 'Payment received — credits are still syncing. Retry in a moment.'
          : (syncBody.reason ?? 'Sync failed'),
      };
    },
    [account, refreshBalance]
  );

  const purchasePack = useCallback(
    async (pack: CreditPackDefinition): Promise<PurchasePackResult> => {
      if (!account || chain?.id !== ARBITRUM_ONE_CHAIN_ID) {
        return { ok: false, error: 'Connect wallet on Arbitrum' };
      }
      if (!paymentContract || !usdcAddress) {
        return { ok: false, error: 'Payment contract not configured' };
      }

      const buyData = buildBuyCreditsCalldata(pack.id);
      if (!buyData) return { ok: false, error: 'Invalid pack' };

      try {
        const approveData = buildBuyCreditsApproveCalldata(
          paymentContract,
          pack.usdc6
        );

        const { txHash, txHashes } = await sendOps([
          { target: usdcAddress, data: approveData, value: 0n },
          { target: paymentContract, data: buyData, value: 0n },
        ]);

        const candidates = await rankCreditsPurchaseTxHashes(
          txHashes.length > 0 ? txHashes : [txHash]
        );

        let lastResult: PurchasePackResult = {
          ok: false,
          error: 'Sync failed',
          txHash: candidates[0] ?? txHash,
        };

        for (const candidate of candidates) {
          const syncResult = await syncPurchase(candidate);
          if (syncResult.ok) {
            return { ok: true, txHash: candidate };
          }
          lastResult = {
            ...syncResult,
            txHash: candidate,
            syncPending: syncResult.syncPending === true,
          };
        }

        return {
          ...lastResult,
          txHash: candidates[0] ?? txHash,
        };
      } catch (e) {
        return { ok: false, error: formatPurchaseError(e) };
      }
    },
    [
      account,
      chain?.id,
      paymentContract,
      sendOps,
      syncPurchase,
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
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({
            amount,
            reason,
            idempotencyKey,
            action: auth.action,
            extra: auth.extra,
            timestamp: auth.timestamp,
            walletAddress: auth.account,
          }),
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
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({
            code: code.trim(),
            action: auth.action,
            extra: auth.extra,
            walletAddress: auth.account,
          }),
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
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({ action: auth.action, walletAddress: auth.account }),
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
    syncPurchase,
    debitCredits,
    redeemPromo,
    claimMembershipCredits,
  };
}

export { CREDIT_PACKS };
