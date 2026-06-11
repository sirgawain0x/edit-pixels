import type {
  NanobananaQuality,
  SeedanceQuality,
  SeedanceSpeed,
} from '@/features/generative/types';

/** Milli-credits (3 decimal places) for fractional Live AI debits. 1000 milli = 1 credit. */
export const MILLI_CREDITS_PER_CREDIT = 1000;

/** ~1.11 credits/min → 50 credits ≈ 45 min Live AI. */
export const LIVE_AI_MILLI_CREDITS_PER_MINUTE = 1110;

/** Debit interval while Live AI is streaming (ms). */
export const LIVE_AI_DEBIT_INTERVAL_MS = 60_000;

/** Milli-credits debited each Live AI billing tick (1 minute). */
export const LIVE_AI_MILLI_CREDITS_PER_TICK = LIVE_AI_MILLI_CREDITS_PER_MINUTE;

export interface CreditPackDefinition {
  id: number;
  name: string;
  /** USDC amount with 6 decimals (e.g. 5_000_000 = $5). */
  usdc6: number;
  credits: number;
  description: string;
}

/** Must match on-chain PaymentContract pack ids (0, 1, 2). */
export const CREDIT_PACKS: readonly CreditPackDefinition[] = [
  {
    id: 0,
    name: 'Starter',
    usdc6: 5_000_000,
    credits: 50,
    description: '~45 min Live AI',
  },
  {
    id: 1,
    name: 'Pro',
    usdc6: 15_000_000,
    credits: 175,
    description: '~2.6 hr Live AI',
  },
  {
    id: 2,
    name: 'Studio',
    usdc6: 40_000_000,
    credits: 500,
    description: '~7.5 hr Live AI',
  },
] as const;

export function getCreditPack(packId: number): CreditPackDefinition | undefined {
  return CREDIT_PACKS.find((p) => p.id === packId);
}

/** Estimated Live AI minutes remaining from credit balance. */
export function creditsToLiveAiMinutes(credits: number): number {
  if (credits <= 0) return 0;
  const milli = credits * MILLI_CREDITS_PER_CREDIT;
  return milli / LIVE_AI_MILLI_CREDITS_PER_MINUTE;
}

export function formatLiveAiTimeFromCredits(credits: number): string {
  const minutes = creditsToLiveAiMinutes(credits);
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `~${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `~${h}h ${m}m` : `~${h}h`;
}

const QUALITY_MULTIPLIER: Record<SeedanceQuality, number> = {
  '480p': 1,
  '720p': 1.6,
  '1080p': 2.5,
};

const SPEED_MULTIPLIER: Record<SeedanceSpeed, number> = {
  standard: 1,
  fast: 0.75,
};

/** Base credits per second of Seedance output (retail ~$0.10/credit). */
const SEEDANCE_BASE_CREDITS_PER_SECOND = 1.4;

export interface SeedanceCreditQuoteParams {
  duration: number;
  quality: SeedanceQuality;
  speed: SeedanceSpeed;
  generateAudio: boolean;
}

/** Quote Seedance i2v generation cost in whole credits (rounded up). */
export function quoteSeedanceCredits(params: SeedanceCreditQuoteParams): number {
  const { duration, quality, speed, generateAudio } = params;
  let credits =
    duration *
    SEEDANCE_BASE_CREDITS_PER_SECOND *
    QUALITY_MULTIPLIER[quality] *
    SPEED_MULTIPLIER[speed];
  if (generateAudio) credits *= 1.15;
  return Math.max(1, Math.ceil(credits));
}

const NANO_QUALITY_CREDITS: Record<NanobananaQuality, number> = {
  '0.5K': 5,
  '1K': 8,
  '2K': 12,
  '4K': 18,
};

/** Quote Nanobanana image generation cost in whole credits. */
export function quoteNanobananaCredits(quality: NanobananaQuality): number {
  return NANO_QUALITY_CREDITS[quality] ?? 10;
}

/** Default contest promo template (admin CLI). */
export const DEFAULT_CONTEST_PROMO = {
  credits: 5,
  maxRedemptions: 1000,
  expiryDays: 30,
} as const;
