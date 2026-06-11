import { useCallback, useEffect, useRef } from 'react';
import {
  useAccount,
  useChain,
  useSendUserOperation,
  useSmartAccountClient,
} from '@account-kit/react';
import { arbitrum } from 'viem/chains';
import {
  getSuperfluidReceiverAddress,
  intervalCostUsdc6ToFlowRate,
  isSuperfluidConfigured,
  SUPERFLUID_CHAIN_ID,
  wrapUsdc6ForOneHour,
} from '@/config/superfluid';
import { usePremiumMembership } from '@/features/live-ai/hooks/use-premium-membership';
import { useLiveSessionStore } from '../stores/live-session-store';
import {
  buildDeleteFlowUserOperation,
  buildStartFlowUserOperations,
  readExistingFlowRate,
  readUsdcBalanceArbitrum,
  readUsdcxBalance,
} from '../api/superfluid-flow';

const BALANCE_POLL_MS = 30_000;
/** Stop stream when USDCx cannot cover ~2 minutes at current rate. */
const MIN_RUNWAY_SECONDS = 120;

/**
 * Manages Superfluid USDCx streaming while Live AI is active.
 * Creates/updates flow on stream start; deletes flow on stop.
 */
export function useSuperfluidBilling() {
  const streamActive = useLiveSessionStore((s) => s.streamActive);
  const setStreamActive = useLiveSessionStore((s) => s.setStreamActive);
  const setBillingError = useLiveSessionStore((s) => s.setBillingError);

  const { address } = useAccount({ type: 'LightAccount' });
  const { chain, setChain } = useChain();
  const { client } = useSmartAccountClient({ type: 'LightAccount' });
  const { intervalCostUsdc6 } = usePremiumMembership(
    address as `0x${string}` | undefined
  );

  const receiver = getSuperfluidReceiverAddress();
  const configured = isSuperfluidConfigured();

  const onPauseRef = useRef<(() => void) | null>(null);
  const flowActiveRef = useRef(false);
  const startInFlightRef = useRef(false);
  const stopInFlightRef = useRef(false);

  const intervalCostRef = useRef(intervalCostUsdc6);
  intervalCostRef.current = intervalCostUsdc6;

  const flowRateRef = useRef(intervalCostUsdc6ToFlowRate(intervalCostUsdc6));
  flowRateRef.current = intervalCostUsdc6ToFlowRate(intervalCostUsdc6);

  const pendingOpRef = useRef<{
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);

  const { sendUserOperation } = useSendUserOperation({
    client,
    waitForTxn: true,
    onSuccess: () => {
      pendingOpRef.current?.resolve();
      pendingOpRef.current = null;
    },
    onError: (err) => {
      pendingOpRef.current?.reject(
        err instanceof Error ? err : new Error(String(err))
      );
      pendingOpRef.current = null;
    },
  });

  const sendOpsRef = useRef<
    (
      uo: Array<{ target: `0x${string}`; data: `0x${string}`; value: bigint }>
    ) => Promise<void>
  >(() => Promise.reject(new Error('Wallet not ready')));

  sendOpsRef.current = async (uo) => {
    if (!client) throw new Error('Wallet not ready');
    await new Promise<void>((resolve, reject) => {
      pendingOpRef.current = { resolve, reject };
      sendUserOperation({ uo });
    });
  };

  const ensureArbitrum = useCallback(async () => {
    if (chain?.id === SUPERFLUID_CHAIN_ID) return;
    await setChain({ chain: arbitrum });
  }, [chain?.id, setChain]);

  const stopFlow = useCallback(async () => {
    if (!address || !receiver || stopInFlightRef.current) return;
    if (!flowActiveRef.current) return;

    stopInFlightRef.current = true;
    try {
      const existing = await readExistingFlowRate(address, receiver);
      if (existing > 0n) {
        const op = buildDeleteFlowUserOperation(address, receiver);
        await sendOpsRef.current([op]);
      }
    } catch {
      // Best-effort cleanup.
    } finally {
      flowActiveRef.current = false;
      stopInFlightRef.current = false;
    }
  }, [address, receiver]);

  const startFlow = useCallback(async () => {
    if (
      !address ||
      !receiver ||
      !configured ||
      startInFlightRef.current ||
      flowActiveRef.current
    ) {
      return;
    }

    startInFlightRef.current = true;
    setBillingError(null);

    try {
      await ensureArbitrum();

      const cost = intervalCostRef.current;
      const rate = flowRateRef.current;
      const wrapUsdc6 = wrapUsdc6ForOneHour(cost);

      const usdcBalance = await readUsdcBalanceArbitrum(address);
      if (usdcBalance < wrapUsdc6) {
        setBillingError('insufficient_balance');
        setStreamActive(false);
        onPauseRef.current?.();
        return;
      }

      const existingFlowRate = await readExistingFlowRate(address, receiver);
      const ops = buildStartFlowUserOperations({
        sender: address,
        receiver,
        flowRate: rate,
        wrapUsdc6,
        existingFlowRate,
      });

      await sendOpsRef.current(ops);
      flowActiveRef.current = true;
      setBillingError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : '';
      if (
        msg.includes('insufficient') ||
        msg.includes('balance') ||
        msg.includes('allowance')
      ) {
        setBillingError('insufficient_balance');
      } else {
        setBillingError('rpc_or_unknown');
      }
      setStreamActive(false);
      onPauseRef.current?.();
    } finally {
      startInFlightRef.current = false;
    }
  }, [address, configured, ensureArbitrum, receiver, setBillingError, setStreamActive]);

  useEffect(() => {
    if (!streamActive) {
      void stopFlow();
      return;
    }
    if (!configured || !address || !receiver) return;
    void startFlow();
  }, [streamActive, configured, address, receiver, startFlow, stopFlow]);

  useEffect(() => {
    if (!streamActive || !configured || !address) return;

    const check = async () => {
      const rate = flowRateRef.current;
      if (rate <= 0n) return;
      try {
        const usdcxBalance = await readUsdcxBalance(address);
        const runwaySeconds = Number(usdcxBalance / rate);
        if (runwaySeconds < MIN_RUNWAY_SECONDS) {
          setBillingError('insufficient_balance');
          setStreamActive(false);
          onPauseRef.current?.();
          await stopFlow();
        }
      } catch {
        // Ignore transient RPC errors.
      }
    };

    const id = setInterval(() => void check(), BALANCE_POLL_MS);
    return () => clearInterval(id);
  }, [address, configured, setBillingError, setStreamActive, stopFlow, streamActive]);

  const setOnPause = useCallback((fn: (() => void) | null) => {
    onPauseRef.current = fn;
  }, []);

  return {
    configured,
    setOnPause,
    intervalCostUsdc6,
  };
}
