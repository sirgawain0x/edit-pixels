import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Hex } from 'viem';
import { USDC_ADDRESS_BY_CHAIN_ID } from '@/config/chains';
import { useWalletContext } from '@/context/wallet-context';
import { useSmartWalletOps } from '@/hooks/use-smart-wallet-ops';
import {
  buildUsdcTransferCalldata,
  getUsdcGasReserveUsdc6,
  validateUsdcSend,
} from '@/shared/utils/usdc-transfer';

export interface SendUsdcResult {
  ok: boolean;
  txHash?: Hex;
  error?: string;
}

export function useSendUsdc() {
  const { wallet, chain } = useWalletContext();
  const { sendOps, ready } = useSmartWalletOps();
  const queryClient = useQueryClient();

  const address = wallet?.address as `0x${string}` | undefined;
  const usdcAddress = chain ? USDC_ADDRESS_BY_CHAIN_ID[chain.id] : undefined;

  const sendUsdc = useCallback(
    async (
      recipient: string,
      amount: string,
      balance: string | null
    ): Promise<SendUsdcResult> => {
      if (!wallet || !address || !chain || !usdcAddress) {
        return { ok: false, error: 'Wallet not ready on a supported network' };
      }
      if (!ready) {
        return { ok: false, error: 'Wallet not ready' };
      }

      const validation = validateUsdcSend({
        recipient,
        amount,
        balance,
        senderAddress: address,
        gasReserveUsdc6: getUsdcGasReserveUsdc6(chain.id),
      });
      if (!validation.ok) {
        return { ok: false, error: validation.error };
      }

      try {
        const data = buildUsdcTransferCalldata(
          validation.recipient,
          validation.amountUsdc6
        );
        const { txHash } = await sendOps([
          { target: usdcAddress, data, value: 0n },
        ]);
        await queryClient.invalidateQueries({
          queryKey: ['usdc-balance', chain.id, address],
        });
        return { ok: true, txHash };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Transfer failed';
        const lower = message.toLowerCase();
        if (
          lower.includes('insufficient') ||
          lower.includes('balance') ||
          lower.includes('exceeds balance')
        ) {
          return { ok: false, error: 'Insufficient USDC balance' };
        }
        return { ok: false, error: message };
      }
    },
    [address, chain, queryClient, ready, sendOps, usdcAddress, wallet]
  );

  return {
    sendUsdc,
    ready: ready && Boolean(usdcAddress),
    usdcAddress,
  };
}
