import {
  createPublicClient,
  decodeEventLog,
  http,
  parseAbiItem,
  type Hex,
  type Log,
} from 'viem';
import { arbitrum } from 'viem/chains';
import { getPaymentContractAddress } from '@/config/billing';

const CREDITS_PURCHASED = parseAbiItem(
  'event CreditsPurchased(address indexed buyer, uint8 indexed packId, uint256 credits, uint256 usdcPaid)'
);

const apiKey = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined;

function getArbitrumRpcUrl(): string {
  if (apiKey) return `https://arb-mainnet.g.alchemy.com/v2/${apiKey}`;
  return 'https://arb1.arbitrum.io/rpc';
}

function findCreditsPurchasedLog(
  logs: Log[],
  contractAddress: string
): boolean {
  const target = contractAddress.toLowerCase();
  for (const log of logs) {
    if (log.address.toLowerCase() !== target) continue;
    try {
      const decoded = decodeEventLog({
        abi: [CREDITS_PURCHASED],
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'CreditsPurchased') return true;
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Orders batched smart-wallet receipt hashes for credit sync.
 * Hashes whose receipts emit CreditsPurchased come first; never drops candidates
 * so callers can retry others when RPC indexing lags.
 */
export async function rankCreditsPurchaseTxHashes(
  txHashes: readonly Hex[]
): Promise<Hex[]> {
  const unique = [...new Set(txHashes.filter(Boolean))];
  if (unique.length <= 1) return unique;

  const paymentContract = getPaymentContractAddress();
  if (!paymentContract) return unique;

  const client = createPublicClient({
    chain: arbitrum,
    transport: http(getArbitrumRpcUrl()),
  });

  const withEvent: Hex[] = [];
  const withoutEvent: Hex[] = [];

  for (const hash of unique) {
    try {
      const receipt = await client.getTransactionReceipt({ hash });
      if (
        receipt.status === 'success' &&
        findCreditsPurchasedLog(receipt.logs, paymentContract)
      ) {
        withEvent.push(hash);
      } else {
        withoutEvent.push(hash);
      }
    } catch {
      withoutEvent.push(hash);
    }
  }

  return [...withEvent, ...withoutEvent];
}
