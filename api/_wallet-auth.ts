import type { PublicClient } from 'viem';
import {
  ADDRESS_REGEX,
  HEX_SIG_REGEX,
  MAX_SIG_AGE_MS,
} from './_address.js';

export { ADDRESS_REGEX, HEX_SIG_REGEX, MAX_SIG_AGE_MS };

function getArbitrumRpcUrl(): string {
  const apiKey =
    process.env.ALCHEMY_API_KEY || process.env.VITE_ALCHEMY_API_KEY;
  if (apiKey) return `https://arb-mainnet.g.alchemy.com/v2/${apiKey}`;
  return 'https://arb1.arbitrum.io/rpc';
}

let publicClient: PublicClient | null = null;

async function getPublicClient(): Promise<PublicClient> {
  if (!publicClient) {
    const { createPublicClient, http } = await import('viem');
    const { arbitrum } = await import('viem/chains');
    publicClient = createPublicClient({
      chain: arbitrum,
      transport: http(getArbitrumRpcUrl()),
    });
  }
  return publicClient;
}

export interface WalletAuthPayload {
  address: string;
  timestamp: number;
  nonce: string;
  signature: string;
}

export function parseWalletAuthBody(body: unknown): WalletAuthPayload | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const address = typeof b.address === 'string' ? b.address.trim() : '';
  const timestamp = typeof b.timestamp === 'number' ? b.timestamp : NaN;
  const nonce = typeof b.nonce === 'string' ? b.nonce.trim() : '';
  const signature = typeof b.signature === 'string' ? b.signature.trim() : '';
  if (!ADDRESS_REGEX.test(address)) return null;
  if (!Number.isFinite(timestamp)) return null;
  if (Math.abs(Date.now() - timestamp) > MAX_SIG_AGE_MS) return null;
  if (!nonce || nonce.length < 8 || nonce.length > 128) return null;
  if (!signature || !HEX_SIG_REGEX.test(signature)) return null;
  return { address, timestamp, nonce, signature };
}

export async function verifyWalletMessage(
  address: string,
  message: string,
  signature: string
): Promise<boolean> {
  try {
    const client = await getPublicClient();
    return await client.verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}

/** Build signed-message prefix for credit operations. Keep in sync with client hooks. */
export function buildCreditsAuthMessage(
  action: string,
  address: string,
  timestamp: number,
  nonce: string,
  extra?: string
): string {
  const lines = [
    `Pixels credits ${action}`,
    `address: ${address.toLowerCase()}`,
    `timestamp: ${timestamp}`,
    `nonce: ${nonce}`,
  ];
  if (extra) lines.push(extra);
  return lines.join('\n');
}
