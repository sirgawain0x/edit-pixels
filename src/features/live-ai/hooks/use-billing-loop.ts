import { useEffect, useRef } from 'react';
import { useAccount, useChain, useSmartAccountClient, useSendUserOperation } from '@account-kit/react';
import { getPaymentContractAddress } from '@/config/billing';
import { buildPayAiRenderCalldata, classifyPayFailure } from '../api/pay-ai-render';
import { useLiveSessionStore } from '../stores/live-session-store';
import { useFreeTier } from './use-free-tier';
import { usePremiumMembership } from './use-premium-membership';

const ARBITRUM_ONE_CHAIN_ID = 42_161;
const BILLING_INTERVAL_MS = 300_000; // 5 minutes

/**
 * Runs the 5-minute billing loop while stream is active.
 * Sends payAiRender(intervalCostUsdc6) via Smart Account; on failure pauses and sets billingError.
 * Phase 2: when user uses a gated style and holds MeToken (checkMeTokenHolder), call payWithRoyalty(amount, creatorAddress) instead; creator from Stylus style registry or cached mapping.
 *
 * IMPORTANT:
 * This hook must only be mounted after Account Kit signer context is ready
 * (user present and signerStatus.isInitializing === false). Caller is responsible
 * for this guard to avoid useSmartAccountClient context timing errors.
 */
export function useBillingLoop() {
  const { address } = useAccount({ type: 'LightAccount' });
  const { chain } = useChain();
  const { client } = useSmartAccountClient({ type: 'LightAccount' });
  const { intervalCostUsdc6 } = usePremiumMembership(address as `0x${string}` | undefined);
  const { claim: claimFreeTier } = useFreeTier(address as `0x${string}` | undefined);
  const streamActive = useLiveSessionStore((s) => s.streamActive);
  const setStreamActive = useLiveSessionStore((s) => s.setStreamActive);
  const setBillingError = useLiveSessionStore((s) => s.setBillingError);

  const paymentContractAddress = getPaymentContractAddress();
  const onPauseRef = useRef<(() => void) | null>(null);

  const { sendUserOperation, isSendingUserOperation } = useSendUserOperation({
    client,
    waitForTxn: true,
    onSuccess: () => setBillingError(null),
    onError: (err) => {
      const reason = classifyPayFailure(err);
      setBillingError(reason);
      setStreamActive(false);
      onPauseRef.current?.();
    },
  });

  /** Call from the component that can stop the broadcast; pass null on unmount. */
  const setOnPause = (fn: (() => void) | null) => {
    onPauseRef.current = fn;
  };

  useEffect(() => {
    if (
      !streamActive ||
      !client ||
      chain?.id !== ARBITRUM_ONE_CHAIN_ID ||
      !paymentContractAddress ||
      intervalCostUsdc6 <= 0
    ) {
      return;
    }

    const data = buildPayAiRenderCalldata(intervalCostUsdc6);
    if (!data) return;

    const tick = async () => {
      if (isSendingUserOperation) return;
      if (address) {
        try {
          const claim = await claimFreeTier(address as `0x${string}`);
          if (claim.ok) return;
        } catch {
          // Free-tier server unreachable — fall through to on-chain charge.
        }
      }
      sendUserOperation({
        uo: {
          target: paymentContractAddress,
          data,
          value: 0n,
        },
      });
    };

    void tick();
    const id = setInterval(() => void tick(), BILLING_INTERVAL_MS);
    return () => clearInterval(id);
  }, [
    streamActive,
    client,
    chain?.id,
    paymentContractAddress,
    intervalCostUsdc6,
    sendUserOperation,
    isSendingUserOperation,
    setStreamActive,
    setBillingError,
    address,
    claimFreeTier,
  ]);

  return { setOnPause };
}
