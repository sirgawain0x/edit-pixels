import type { Address, Hex } from 'viem';
import type {
  SwapActions,
  RequestQuoteV0Params,
} from '@alchemy/wallet-apis/experimental';
import type { SmartWalletClient as BaseSmartWalletClient } from '@alchemy/wallet-apis';

export type SmartWalletClient = BaseSmartWalletClient & SwapActions;

interface PaymasterPermitResult {
  type: 'paymaster-permit';
  signatureRequest: { address: Address };
  modifiedRequest: {
    account: Address;
    calls: Array<{ to: Address; data?: Hex; value?: bigint }>;
    capabilities?: Record<string, unknown>;
  };
}

function isPaymasterPermitRuntime(
  result: unknown
): result is PaymasterPermitResult {
  return (
    typeof result === 'object' &&
    result !== null &&
    'type' in result &&
    (result as { type: string }).type === 'paymaster-permit'
  );
}

export interface SwapQuoteParams
  extends Omit<RequestQuoteV0Params, 'capabilities'> {
  capabilities?: unknown;
}

/**
 * Executes a v5 requestQuoteV0 swap with paymaster-permit retry handling.
 *
 * The exported RequestQuoteV0Result type is not discriminated, so this helper
 * uses runtime checks plus casts to safely handle the permit round-trip.
 */
export async function executeSwapQuote(
  client: SmartWalletClient,
  params: SwapQuoteParams
): Promise<void> {
  let prepared = await client.requestQuoteV0(params as RequestQuoteV0Params);

  if (isPaymasterPermitRuntime(prepared)) {
    const signature = await client.signSignatureRequest(
      prepared.signatureRequest as Parameters<SmartWalletClient['signSignatureRequest']>[0]
    );
    const signatureHex = (typeof signature === 'string' ? signature : signature.data) as Hex;
    prepared = await client.requestQuoteV0({
      ...params,
      capabilities: prepared.modifiedRequest.capabilities,
      paymasterPermitSignature: signatureHex as never,
    } as RequestQuoteV0Params);

    if (isPaymasterPermitRuntime(prepared)) {
      throw new Error('Paymaster still requested a permit after signing');
    }
  }

  type SignPreparedCallsParams = Parameters<
    SmartWalletClient['signPreparedCalls']
  >[0];

  const signed = await client.signPreparedCalls(
    prepared as unknown as SignPreparedCallsParams
  );
  const { id } = await client.sendPreparedCalls(signed);
  const status = await client.waitForCallsStatus({ id });
  if (status.status !== 'success') {
    throw new Error(`Swap failed (status ${String(status.statusCode)})`);
  }
}
