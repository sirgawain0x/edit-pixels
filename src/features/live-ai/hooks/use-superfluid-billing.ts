import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useAccount,
  useChain,
  useSmartAccountClient,
} from '@account-kit/react';
import { arbitrum } from 'viem/chains';
import type { Hex } from 'viem';
import { useSmartWalletOps } from '@/hooks/use-smart-wallet-ops';
import {
  getSuperfluidReceiverAddress,
  intervalCostUsdc6ToFlowRate,
  isSuperfluidConfigured,
  SUPERFLUID_CHAIN_ID,
  wrapUsdc6ForOneHour,
} from '@/config/superfluid';
import { createLogger, createOperationId } from '@/shared/logging/logger';
import { usePremiumMembership } from '@/features/live-ai/hooks/use-premium-membership';
import { formatBillingErrorDetail, extractTxHashFromError } from '../utils/billing-error-detail';
import { useLiveSessionStore } from '../stores/live-session-store';
import {
  buildDeleteFlowUserOperation,
  buildStartFlowUserOperations,
  readExistingFlowRate,
  readUsdcBalanceArbitrum,
  readUsdcxBalance,
} from '../api/superfluid-flow';

const log = createLogger('superfluid-billing');

const BALANCE_POLL_MS = 30_000;
/** Stop stream when USDCx cannot cover ~2 minutes at current rate. */
const MIN_RUNWAY_SECONDS = 120;
/** Max time a confirmed flow may run without the broadcast going live before we stop it. */
const FLOW_WITHOUT_STREAM_GRACE_MS = 90_000;
const STOP_FLOW_MAX_ATTEMPTS = 3;
const STOP_FLOW_RETRY_DELAY_MS = 2_000;

export interface StopFlowOptions {
  /** When true, do not set billingError in global store (e.g. session rollback). */
  suppressBillingError?: boolean;
}

/**
 * Manages Superfluid USDCx streaming for Live AI.
 *
 * Payment-first contract: callers must await `startFlow()` (which resolves only
 * after the flow is confirmed on-chain) BEFORE starting the AI session, so no
 * rendering happens without an active payment stream. The hook stops the flow
 * when the stream ends, when the flow runs without the stream ever going live
 * (grace timeout), or when USDCx runway gets too low.
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
  const [flowActive, setFlowActiveState] = useState(false);
  const flowActiveRef = useRef(false);
  const startInFlightRef = useRef(false);
  const stopInFlightRef = useRef(false);
  const wasLiveRef = useRef(false);
  const lastStopErrorRef = useRef<unknown>(null);

  const markFlowActive = useCallback((value: boolean) => {
    flowActiveRef.current = value;
    setFlowActiveState(value);
  }, []);

  const intervalCostRef = useRef(intervalCostUsdc6);
  intervalCostRef.current = intervalCostUsdc6;

  const flowRateRef = useRef(intervalCostUsdc6ToFlowRate(intervalCostUsdc6));
  flowRateRef.current = intervalCostUsdc6ToFlowRate(intervalCostUsdc6);

  const { sendOps, ready: walletReady } = useSmartWalletOps(client ?? undefined);

  const sendOpsRef = useRef<
    (
      uo: Array<{ target: `0x${string}`; data: `0x${string}`; value: bigint }>
    ) => Promise<{ txHash: Hex }>
  >(() => Promise.reject(new Error('Wallet not ready')));

  sendOpsRef.current = async (uo) => {
    if (!client) throw new Error('Wallet not ready');
    const result = await sendOps(uo);
    return { txHash: result.txHash };
  };

  const ensureArbitrum = useCallback(async () => {
    if (chain?.id === SUPERFLUID_CHAIN_ID) return;
    await setChain({ chain: arbitrum });
  }, [chain?.id, setChain]);

  /**
   * Deletes the on-chain flow with bounded retries. On persistent failure the
   * flow stays marked active so a later call can retry; a billing error is
   * surfaced instead of silently leaving the stream paying.
   */
  const stopFlow = useCallback(
    async (options?: StopFlowOptions): Promise<boolean> => {
      if (!address || !receiver) return true;
      if (!flowActiveRef.current) return true;
      if (stopInFlightRef.current) return false;

      stopInFlightRef.current = true;
      lastStopErrorRef.current = null;
      const opId = createOperationId();
      const event = log.startEvent('superfluid_stop_flow', opId);
      event.merge({ address, receiver });

      try {
        for (let attempt = 1; attempt <= STOP_FLOW_MAX_ATTEMPTS; attempt++) {
          try {
            const existing = await readExistingFlowRate(address, receiver);
            if (existing > 0n) {
              const op = buildDeleteFlowUserOperation(address, receiver);
              const { txHash } = await sendOpsRef.current([op]);
              event.set('txHash', txHash);
            }
            markFlowActive(false);
            event.success({ attempt });
            return true;
          } catch (e) {
            lastStopErrorRef.current = e;
            log.warn('Failed to delete Superfluid flow', { attempt, error: e });
            event.set('lastAttempt', attempt);
            if (attempt < STOP_FLOW_MAX_ATTEMPTS) {
              await new Promise((r) => setTimeout(r, STOP_FLOW_RETRY_DELAY_MS));
            }
          }
        }
        const detail = formatBillingErrorDetail(lastStopErrorRef.current);
        if (!options?.suppressBillingError) {
          setBillingError('rpc_or_unknown', detail);
        }
        event.failure(lastStopErrorRef.current, { suppressBillingError: options?.suppressBillingError });
        return false;
      } finally {
        stopInFlightRef.current = false;
      }
    },
    [address, receiver, markFlowActive, setBillingError]
  );

  /**
   * Wraps USDC and creates/updates the flow, resolving true only after the
   * user operation is confirmed on-chain. Callers must not start the AI
   * session unless this resolves true.
   */
  const startFlow = useCallback(async (): Promise<boolean> => {
    if (!address || !receiver || !configured) return false;
    if (flowActiveRef.current) return true;
    if (startInFlightRef.current) return false;
    if (!client || !walletReady) {
      log.warn('Cannot start Superfluid flow: smart wallet not ready', {
        hasClient: Boolean(client),
        walletReady,
      });
      setBillingError('wallet_not_ready');
      return false;
    }

    startInFlightRef.current = true;
    setBillingError(null);

    const opId = createOperationId();
    const event = log.startEvent('superfluid_start_flow', opId);
    event.merge({ address, receiver });

    try {
      await ensureArbitrum();

      const cost = intervalCostRef.current;
      const rate = flowRateRef.current;
      const wrapUsdc6 = wrapUsdc6ForOneHour(cost);
      event.merge({
        intervalCostUsdc6: cost,
        flowRate: rate.toString(),
        wrapUsdc6: wrapUsdc6.toString(),
      });

      const usdcBalance = await readUsdcBalanceArbitrum(address);
      event.set('usdcBalance6', usdcBalance.toString());
      if (usdcBalance < wrapUsdc6) {
        setBillingError('insufficient_balance');
        event.failure(new Error('Insufficient USDC for wrap amount'));
        return false;
      }

      const existingFlowRate = await readExistingFlowRate(address, receiver);
      const ops = buildStartFlowUserOperations({
        sender: address,
        receiver,
        flowRate: rate,
        wrapUsdc6,
        existingFlowRate,
      });

      const { txHash } = await sendOpsRef.current(ops);
      event.set('txHash', txHash);
      markFlowActive(true);
      setBillingError(null);
      event.success();
      return true;
    } catch (e) {
      log.warn('Failed to start Superfluid flow', { error: e });
      const msg = e instanceof Error ? e.message.toLowerCase() : '';
      const txHash = extractTxHashFromError(e);
      const detail = formatBillingErrorDetail(e, txHash);
      if (
        msg.includes('insufficient') ||
        msg.includes('balance') ||
        msg.includes('allowance')
      ) {
        setBillingError('insufficient_balance', detail);
      } else {
        setBillingError('rpc_or_unknown', detail);
      }
      event.failure(e);
      return false;
    } finally {
      startInFlightRef.current = false;
    }
  }, [
    address,
    client,
    configured,
    ensureArbitrum,
    markFlowActive,
    receiver,
    setBillingError,
    walletReady,
  ]);

  // Stop the flow when the stream ends. If the flow is active but the stream
  // never goes live (broadcast failure), stop it after a grace period so the
  // user is not left paying for nothing.
  useEffect(() => {
    if (streamActive) {
      wasLiveRef.current = true;
      return;
    }
    if (wasLiveRef.current) {
      wasLiveRef.current = false;
      void stopFlow();
      return;
    }
    if (!flowActive) return;
    const id = setTimeout(() => {
      log.warn('Stream did not go live within grace period; stopping flow');
      onPauseRef.current?.();
      void stopFlow();
    }, FLOW_WITHOUT_STREAM_GRACE_MS);
    return () => clearTimeout(id);
  }, [streamActive, flowActive, stopFlow]);

  // Best-effort flow cleanup if the hook unmounts while the flow is active.
  const stopFlowRef = useRef(stopFlow);
  stopFlowRef.current = stopFlow;
  useEffect(() => {
    return () => {
      if (flowActiveRef.current) void stopFlowRef.current();
    };
  }, []);

  // Monitor USDCx runway while the flow is active; halt session + flow when low.
  useEffect(() => {
    if (!flowActive || !configured || !address) return;

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
  }, [address, configured, flowActive, setBillingError, setStreamActive, stopFlow]);

  const setOnPause = useCallback((fn: (() => void) | null) => {
    onPauseRef.current = fn;
  }, []);

  return {
    configured,
    walletReady,
    setOnPause,
    intervalCostUsdc6,
    startFlow,
    stopFlow,
    flowActive,
    walletReady: Boolean(client && walletReady),
  };
}
