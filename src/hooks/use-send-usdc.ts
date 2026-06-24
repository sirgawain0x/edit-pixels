import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useAccount,
  useChain,
  useSmartAccountClient,
} from '@account-kit/react';
import type { Hex } from 'viem';
import { USDC_ADDRESS_BY_CHAIN_ID } from '@/config/chains';
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
  const { address } = useAccount({ type: 'LightAccount' });
  const { chain } = useChain();
  const { client } = useSmartAccountClient({ type: 'LightAccount' });
  const { sendOps, ready } = useSmartWalletOps(client ?? undefined);
  const queryClient = useQueryClient();

  const usdcAddress = chain ? USDC_ADDRESS_BY_CHAIN_ID[chain.id] : undefined;

  const sendUsdc = useCallback(
    async (
      recipient: string,
      amount: string,
      balance: string | null
    ): Promise<SendUsdcResult> => {
      if (!client || !address || !chain || !usdcAddress) {
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
    [address, chain, client, queryClient, ready, sendOps, usdcAddress]
  );

  return {
    sendUsdc,
    ready: ready && Boolean(usdcAddress),
    usdcAddress,
  };
}
