import { addCredits } from './_credit-store';
import { getRedis, isRedisConfigured } from './_redis-client';

export function isPromoStoreConfigured(): boolean {
  return isRedisConfigured();
}

export interface PromoCodeMeta {
  credits: number;
  maxRedemptions: number;
  expiresAt: number;
  /** If true, code can only be redeemed once globally. */
  singleUse?: boolean;
}

function promoMetaKey(code: string): string {
  return `promo:${code.toUpperCase()}`;
}

function promoCountKey(code: string): string {
  return `promo-count:${code.toUpperCase()}`;
}

function promoRedeemedKey(code: string, address: string): string {
  return `promo-redeemed:${code.toUpperCase()}:${address.toLowerCase()}`;
}

function promoLogKey(code: string, address: string): string {
  return `promo-log:${code.toUpperCase()}:${address.toLowerCase()}`;
}

export async function createPromoCode(
  code: string,
  meta: PromoCodeMeta
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  const normalized = code.toUpperCase();
  await redis.set(promoMetaKey(normalized), JSON.stringify(meta));
  return true;
}

export interface RedeemPromoResult {
  ok: boolean;
  creditsGranted: number;
  balance: number;
  reason?:
    | 'disabled'
    | 'invalid_code'
    | 'expired'
    | 'exhausted'
    | 'already_redeemed'
    | 'single_use_taken';
}

export async function redeemPromoCode(
  code: string,
  address: string
): Promise<RedeemPromoResult> {
  const redis = getRedis();
  if (!redis) {
    return { ok: false, creditsGranted: 0, balance: 0, reason: 'disabled' };
  }

  const normalized = code.trim().toUpperCase();
  if (!normalized || normalized.length < 4) {
    return { ok: false, creditsGranted: 0, balance: 0, reason: 'invalid_code' };
  }

  const rawMeta = await redis.get<string>(promoMetaKey(normalized));
  if (!rawMeta) {
    return { ok: false, creditsGranted: 0, balance: 0, reason: 'invalid_code' };
  }

  let meta: PromoCodeMeta;
  try {
    meta = JSON.parse(rawMeta) as PromoCodeMeta;
  } catch {
    return { ok: false, creditsGranted: 0, balance: 0, reason: 'invalid_code' };
  }

  if (Date.now() > meta.expiresAt) {
    return { ok: false, creditsGranted: 0, balance: 0, reason: 'expired' };
  }

  const walletRedeemed = await redis.get<string>(
    promoRedeemedKey(normalized, address)
  );
  if (walletRedeemed) {
    return {
      ok: false,
      creditsGranted: 0,
      balance: 0,
      reason: 'already_redeemed',
    };
  }

  const countKey = promoCountKey(normalized);
  const count = await redis.incr(countKey);
  if (count === 1 && meta.singleUse) {
    // first redemption on single-use code is fine
  }
  if (meta.singleUse && count > 1) {
    await redis.decr(countKey);
    return {
      ok: false,
      creditsGranted: 0,
      balance: 0,
      reason: 'single_use_taken',
    };
  }
  if (count > meta.maxRedemptions) {
    await redis.decr(countKey);
    return { ok: false, creditsGranted: 0, balance: 0, reason: 'exhausted' };
  }

  await redis.set(promoRedeemedKey(normalized, address), '1');
  await redis.set(
    promoLogKey(normalized, address),
    JSON.stringify({ at: Date.now(), credits: meta.credits })
  );

  const balance = await addCredits(address, meta.credits);
  return { ok: true, creditsGranted: meta.credits, balance };
}
