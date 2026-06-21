import { useCallback } from 'react';
import { useSmartWalletClient } from '@account-kit/react';
import { toHex } from 'viem';
import type { Address, Hex } from 'viem';
import { buildGasPaymasterCapabilities } from '@/config/gas-sponsorship';
import { createLogger } from '@/shared/logging/logger';

const log = createLogger('smart-wallet-ops');

export interface SmartWalletOp {
  target: Address;
  data: Hex;
  value: bigint;
}

export interface SendOpsResult {
  /** Mined transaction hash containing the user operation. */
  txHash: Hex;
  /** All unique receipt tx hashes (batched calls may expose more than one). */
  txHashes: Hex[];
}

interface ClientWithAccount {
  account: { address: Address };
}

type SmartWalletClient = NonNullable<ReturnType<typeof useSmartWalletClient>>;
type PreparedCalls = Awaited<ReturnType<SmartWalletClient['prepareCalls']>>;

interface PrepareCallsRequest {
  calls: Array<{ to: Address; data?: Hex; value?: Hex }>;
  capabilities?: unknown;
  paymasterPermitSignature?: unknown;
}

/**
 * prepareCalls is generic over whether the client is account-bound, which makes
 * its params type unrepresentable here; the request shape matches the
 * wallet_prepareCalls wire format documented by Alchemy.
 */
function callPrepareCalls(
  client: { prepareCalls: (params: never) => Promise<PreparedCalls> },
  request: PrepareCallsRequest
): Promise<PreparedCalls> {
  return client.prepareCalls(request as never);
}

/**
 * Sends batched calls through the Alchemy Smart Wallets API
 * (wallet_prepareCalls → sign → wallet_sendPreparedCalls) and waits for the
 * mined transaction.
 *
 * Unlike useSendUserOperation, this passes explicit paymaster capabilities so
 * ERC-20 gas policies work: Account Kit's default path only injects the
 * policyId and Alchemy rejects ERC-20 policies with "erc20 capability is
 * missing". It also handles the paymaster permit round-trip when the gas
 * policy operates in pre-op (permit) mode.
 */
export function useSmartWalletOps(client: ClientWithAccount | undefined) {
  const smartWalletClient = useSmartWalletClient({
    account: client?.account.address,
  });

  const sendOps = useCallback(
    async (ops: SmartWalletOp[]): Promise<SendOpsResult> => {
      if (!smartWalletClient) throw new Error('Wallet not ready');

      const capabilities = buildGasPaymasterCapabilities(
        smartWalletClient.chain.id
      );

      let prepared = await callPrepareCalls(smartWalletClient, {
        calls: ops.map((op) => ({
          to: op.target,
          data: op.data,
          value: op.value ? toHex(op.value) : undefined,
        })),
        ...(capabilities ? { capabilities } : {}),
      });

      // ERC-20 gas policies in pre-op mode return a permit signature request
      // that must be signed and folded back into a second prepareCalls.
      if (prepared.type === 'paymaster-permit') {
        log.warn('Paymaster requested ERC-20 permit; signing and re-preparing');
        const signature = await smartWalletClient.signSignatureRequest(
          prepared.signatureRequest
        );
        prepared = await callPrepareCalls(smartWalletClient, {
          calls: prepared.modifiedRequest.calls as PrepareCallsRequest['calls'],
          capabilities: prepared.modifiedRequest.capabilities,
          paymasterPermitSignature: signature,
        });
      }

      const signed = await smartWalletClient.signPreparedCalls(prepared);
      const { id } = await smartWalletClient.sendPreparedCalls(signed);

      const status = await smartWalletClient.waitForCallsStatus({ id });
      if (status.status !== 'success') {
        throw new Error(
          `Transaction failed (status ${String(status.statusCode)})`
        );
      }
      const txHashes = [
        ...new Set(
          (status.receipts ?? [])
            .map((r) => r.transactionHash)
            .filter((h): h is Hex => Boolean(h))
        ),
      ];
      const txHash = txHashes[txHashes.length - 1];
      if (!txHash) throw new Error('Transaction confirmed without a receipt');
      return { txHash, txHashes };
    },
    [smartWalletClient]
  );

  return { sendOps, ready: Boolean(smartWalletClient) };
}
