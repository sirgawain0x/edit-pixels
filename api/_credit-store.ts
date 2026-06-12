import { getRedis, isRedisConfigured } from './_redis-client';

export function isCreditStoreConfigured(): boolean {
  return isRedisConfigured();
}

function balanceKey(address: string): string {
  return `credits:${address.toLowerCase()}`;
}

function processedTxKey(txHash: string): string {
  return `credits:tx:${txHash.toLowerCase()}`;
}

export async function getCreditBalance(address: string): Promise<number> {
  const redis = await getRedis();
  if (!redis) return 0;
  const raw = await redis.get<number>(balanceKey(address));
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.floor(raw));
}

export interface CreditPurchaseResult {
  ok: boolean;
  creditsAdded: number;
  balance: number;
  reason?: 'already_processed' | 'disabled' | 'invalid';
}

/**
 * Idempotently credits a wallet from an on-chain purchase (by tx hash).
 */
export async function creditFromPurchase(
  address: string,
  txHash: string,
  credits: number
): Promise<CreditPurchaseResult> {
  const redis = await getRedis();
  if (!redis) {
    return { ok: false, creditsAdded: 0, balance: 0, reason: 'disabled' };
  }
  if (credits <= 0) {
    return { ok: false, creditsAdded: 0, balance: 0, reason: 'invalid' };
  }

  const txKey = processedTxKey(txHash);
  const balKey = balanceKey(address);

  const setOk = await redis.set(txKey, '1', { nx: true });
  if (!setOk) {
    const balance = await getCreditBalance(address);
    return { ok: true, creditsAdded: 0, balance, reason: 'already_processed' };
  }

  await redis.incrby(balKey, credits);
  const balance = await getCreditBalance(address);
  return { ok: true, creditsAdded: credits, balance };
}

export interface DebitResult {
  ok: boolean;
  balance: number;
  debited: number;
  reason?: 'insufficient' | 'disabled' | 'invalid';
}

export async function addCredits(
  address: string,
  credits: number
): Promise<number> {
  const redis = await getRedis();
  if (!redis || credits <= 0) return await getCreditBalance(address);
  await redis.incrby(balanceKey(address), credits);
  return await getCreditBalance(address);
}

/**
 * Atomically debit credits. Returns ok=false if balance insufficient.
 */
export async function debitCredits(
  address: string,
  amount: number,
  idempotencyKey?: string
): Promise<DebitResult> {
  const redis = await getRedis();
  if (!redis) {
    return { ok: false, balance: 0, debited: 0, reason: 'disabled' };
  }
  if (amount <= 0) {
    return { ok: false, balance: 0, debited: 0, reason: 'invalid' };
  }

  if (idempotencyKey) {
    const idemKey = `credits:debit:${idempotencyKey}`;
    const seen = await redis.get<string>(idemKey);
    if (seen) {
      const balance = await getCreditBalance(address);
      return { ok: true, balance, debited: 0 };
    }
  }

  const balKey = balanceKey(address);
  const current = await getCreditBalance(address);
  if (current < amount) {
    return { ok: false, balance: current, debited: 0, reason: 'insufficient' };
  }

  const newBalance = await redis.decrby(balKey, amount);
  const balance = typeof newBalance === 'number' ? Math.max(0, newBalance) : 0;

  if (idempotencyKey) {
    await redis.set(`credits:debit:${idempotencyKey}`, '1', { ex: 86400 });
  }

  return { ok: true, balance, debited: amount };
}
