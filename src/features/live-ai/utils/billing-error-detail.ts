import type { Hex } from 'viem';
import { arbitrum } from 'viem/chains';

const ARBISCAN_TX_BASE = `${arbitrum.blockExplorers?.default?.url ?? 'https://arbiscan.io'}/tx/`;

/** Extract a transaction hash from common Viem / RPC error shapes. */
export function extractTxHashFromError(error: unknown): Hex | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as { txHash?: Hex; transactionHash?: Hex; hash?: Hex };
  return record.txHash ?? record.transactionHash ?? record.hash;
}

/**
 * Maps raw wallet / RPC errors to user-facing billing detail text.
 */
export function formatBillingErrorDetail(
  error: unknown,
  txHash?: Hex | null
): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown error';
  const lower = raw.toLowerCase();

  if (lower.includes('wallet not ready')) {
    return 'Wallet is still initializing. Wait a moment and try again.';
  }
  if (lower.includes('erc20 capability is missing')) {
    return 'Gas policy misconfiguration (ERC-20 paymaster). Contact support.';
  }
  if (lower.includes('policy') && lower.includes('erc20')) {
    return 'Gas policy type mismatch. Check VITE_ALCHEMY_GAS_POLICY_TYPE.';
  }
  if (lower.includes('transaction failed')) {
    const base = 'On-chain transaction failed.';
    return txHash ? `${base} Tx: ${ARBISCAN_TX_BASE}${txHash}` : base;
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'Network timeout. Check your connection and try again.';
  }
  if (lower.includes('rate limit') || lower.includes('429')) {
    return 'RPC rate limit reached. Wait a moment and try again.';
  }

  return raw.length > 240 ? `${raw.slice(0, 237)}…` : raw;
}
