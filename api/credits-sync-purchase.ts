/**
 * POST /api/credits-sync-purchase
 * Verifies CreditsPurchased on-chain and idempotently credits the buyer.
 * Body: { address, txHash }
 */

import type { Log } from 'viem';
import { ADDRESS_REGEX } from './_address.js';
import { validateCreditPurchaseEvent } from './_credit-packs.js';
import { creditFromPurchase, isCreditStoreConfigured } from './_credit-store.js';

const TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;

const CREDITS_PURCHASED_EVENT =
  'event CreditsPurchased(address indexed buyer, uint8 indexed packId, uint256 credits, uint256 usdcPaid)';

function getPaymentContract(): `0x${string}` | null {
  const v =
    process.env.VITE_ARBITRUM_PAYMENT_CONTRACT ||
    process.env.ARBITRUM_PAYMENT_CONTRACT;
  if (!v || !v.startsWith('0x')) return null;
  return v as `0x${string}`;
}

function getArbitrumRpcUrl(): string {
  const apiKey =
    process.env.ALCHEMY_API_KEY || process.env.VITE_ALCHEMY_API_KEY;
  if (apiKey) return `https://arb-mainnet.g.alchemy.com/v2/${apiKey}`;
  return 'https://arb1.arbitrum.io/rpc';
}

type CreditsPurchasedLog = {
  eventName: 'CreditsPurchased';
  args: {
    buyer: `0x${string}`;
    packId: number;
    credits: bigint;
    usdcPaid: bigint;
  };
};

async function findCreditsPurchasedLog(
  logs: Log[],
  contractAddress: string
): Promise<CreditsPurchasedLog | null> {
  const { decodeEventLog, parseAbiItem } = await import('viem');
  const creditsPurchased = parseAbiItem(CREDITS_PURCHASED_EVENT);
  const target = contractAddress.toLowerCase();
  for (const log of logs) {
    if (log.address.toLowerCase() !== target) continue;
    try {
      const decoded = decodeEventLog({
        abi: [creditsPurchased],
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'CreditsPurchased') {
        return decoded as CreditsPurchasedLog;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function POST(request: Request): Promise<Response> {
  if (!isCreditStoreConfigured()) {
    return Response.json(
      { ok: false, reason: 'disabled' },
      { status: 503 }
    );
  }

  const contractAddress = getPaymentContract();
  if (!contractAddress) {
    return Response.json(
      { ok: false, reason: 'contract_not_configured' },
      { status: 503 }
    );
  }

  let address: string | undefined;
  let txHash: string | undefined;
  try {
    const body = (await request.json()) as {
      address?: unknown;
      txHash?: unknown;
    };
    if (typeof body?.address === 'string') address = body.address.trim();
    if (typeof body?.txHash === 'string') txHash = body.txHash.trim();
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  if (!address || !ADDRESS_REGEX.test(address)) {
    return Response.json({ error: 'invalid address' }, { status: 400 });
  }
  if (!txHash || !TX_HASH_REGEX.test(txHash)) {
    return Response.json({ error: 'invalid txHash' }, { status: 400 });
  }

  try {
    const { createPublicClient, http } = await import('viem');
    const { arbitrum } = await import('viem/chains');
    const client = createPublicClient({
      chain: arbitrum,
      transport: http(getArbitrumRpcUrl()),
    });

    const receipt = await client.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    });
    if (receipt.status !== 'success') {
      return Response.json({ ok: false, reason: 'tx_failed' }, { status: 400 });
    }

    const decoded = await findCreditsPurchasedLog(receipt.logs, contractAddress);
    if (!decoded || decoded.eventName !== 'CreditsPurchased') {
      return Response.json(
        { ok: false, reason: 'event_not_found' },
        { status: 400 }
      );
    }

    const buyer = decoded.args.buyer.toLowerCase();
    const packId = Number(decoded.args.packId);
    const credits = Number(decoded.args.credits);
    const usdcPaid = Number(decoded.args.usdcPaid);

    if (buyer !== address.toLowerCase()) {
      return Response.json(
        {
          ok: false,
          reason: 'buyer_mismatch',
          expectedBuyer: buyer,
        },
        { status: 400 }
      );
    }

    if (!validateCreditPurchaseEvent(packId, credits, usdcPaid)) {
      console.error('credits-sync-purchase pack mismatch', {
        packId,
        credits,
        usdcPaid,
        txHash,
      });
      return Response.json(
        { ok: false, reason: 'pack_mismatch' },
        { status: 400 }
      );
    }

    const result = await creditFromPurchase(buyer, txHash, credits);
    if (!result.ok) {
      const status = result.reason === 'disabled' ? 503 : 500;
      return Response.json(
        {
          ok: false,
          creditsAdded: 0,
          balance: result.balance,
          reason: result.reason ?? 'error',
        },
        { status }
      );
    }
    return Response.json(
      {
        ok: true,
        creditsAdded: result.creditsAdded,
        balance: result.balance,
        reason: result.reason,
      },
      { status: 200 }
    );
  } catch (e) {
    console.error('credits-sync-purchase error', e);
    return Response.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
