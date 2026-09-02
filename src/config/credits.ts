/** Milli-credits (3 decimal places) for fractional Live AI debits. 1000 milli = 1 credit. */
// fallow-ignore-file unused-export

export const MILLI_CREDITS_PER_CREDIT = 1000

/** ~1.11 credits/min reference rate (legacy Live AI equivalence; Live AI bills USDC via Superfluid). */
export const LIVE_AI_MILLI_CREDITS_PER_MINUTE = 1110

/** Debit interval while Live AI is streaming (ms). */
export const LIVE_AI_DEBIT_INTERVAL_MS = 60_000

/** Milli-credits debited each Live AI billing tick (1 minute). */
export const LIVE_AI_MILLI_CREDITS_PER_TICK = LIVE_AI_MILLI_CREDITS_PER_MINUTE

export interface CreditPackDefinition {
  id: number
  name: string
  /** USDC amount with 6 decimals (e.g. 5_000_000 = $5). */
  usdc6: number
  credits: number
  description: string
}

/** Must match on-chain PaymentContract pack ids (0, 1, 2). */
export const CREDIT_PACKS: readonly CreditPackDefinition[] = [
  {
    id: 0,
    name: 'Starter',
    usdc6: 5_000_000,
    credits: 50,
    description: '~10 Flow image gens',
  },
  {
    id: 1,
    name: 'Pro',
    usdc6: 15_000_000,
    credits: 175,
    description: '~35 Flow image gens',
  },
  {
    id: 2,
    name: 'Studio',
    usdc6: 40_000_000,
    credits: 500,
    description: '~100 Flow image gens',
  },
] as const

export function getCreditPack(packId: number): CreditPackDefinition | undefined {
  return CREDIT_PACKS.find((p) => p.id === packId)
}

/**
 * Director session packs — USDC to mint as CRTVAI for prepaid Director briefs.
 * `credits` is an informational estimate of retail Director audio-minutes
 * (≈ $0.05/min → 1 credit ≈ 2 min at the legacy $0.10/credit display scale).
 */
export const DIRECTOR_SESSION_PACKS: readonly CreditPackDefinition[] = [
  {
    id: 10,
    name: 'Brief',
    usdc6: 5_000_000,
    credits: 100,
    description: '~100 min retail Director audio',
  },
  {
    id: 11,
    name: 'Session',
    usdc6: 15_000_000,
    credits: 300,
    description: '~300 min retail Director audio',
  },
  {
    id: 12,
    name: 'Production',
    usdc6: 40_000_000,
    credits: 800,
    description: '~800 min retail Director audio',
  },
] as const

export function getDirectorSessionPack(packId: number): CreditPackDefinition | undefined {
  return DIRECTOR_SESSION_PACKS.find((p) => p.id === packId)
}

/** Estimated minutes at legacy Live AI credit rate (informational only). */
export function creditsToLiveAiMinutes(credits: number): number {
  if (credits <= 0) return 0
  const milli = credits * MILLI_CREDITS_PER_CREDIT
  return milli / LIVE_AI_MILLI_CREDITS_PER_MINUTE
}

export function formatLiveAiTimeFromCredits(credits: number): string {
  const minutes = creditsToLiveAiMinutes(credits)
  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `~${Math.round(minutes)} min`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m > 0 ? `~${h}h ${m}m` : `~${h}h`
}

export type VeoTier = 'standard' | 'fast' | 'lite'
export type VeoQuality = '720p' | '1080p' | '4K'
export type NanobananaQuality = '0.5K' | '1K' | '2K' | '4K'

const VEO_USD_PER_SEC: Record<VeoTier, Partial<Record<VeoQuality, number>>> = {
  standard: { '720p': 0.4, '1080p': 0.4, '4K': 0.6 },
  fast: { '720p': 0.1, '1080p': 0.12, '4K': 0.3 },
  lite: { '720p': 0.05, '1080p': 0.08 },
}

export interface VeoCreditQuoteParams {
  duration: number
  quality: VeoQuality
  tier: VeoTier
}

/** Quote Veo 3.1 video generation cost in whole credits (rounded up). */
export function quoteVeoCredits(params: VeoCreditQuoteParams): number {
  const { duration, quality, tier } = params
  const usdPerSec = VEO_USD_PER_SEC[tier][quality]
  if (!usdPerSec) {
    throw new Error(`Quality ${quality} is not supported for Veo tier ${tier}`)
  }
  const usd = duration * usdPerSec
  return Math.max(1, Math.ceil(usd / 0.1))
}

/** @deprecated Use quoteVeoCredits */
export function quoteSeedanceCredits(params: {
  duration: number
  quality: VeoQuality
  speed: VeoTier
  generateAudio: boolean
}): number {
  return quoteVeoCredits({
    duration: params.duration,
    quality: params.quality,
    tier: params.speed,
  })
}

const NANO_QUALITY_CREDITS: Record<NanobananaQuality, number> = {
  '0.5K': 1,
  '1K': 1,
  '2K': 1,
  '4K': 2,
}

/** Quote Gemini image generation cost in whole credits. */
export function quoteNanobananaCredits(quality: NanobananaQuality): number {
  return NANO_QUALITY_CREDITS[quality] ?? 1
}

/** Default contest promo template (admin CLI). */
export const DEFAULT_CONTEST_PROMO = {
  credits: 5,
  promoCode: 'CONTEST2026',
  maxClaims: 100,
  expiresAt: null as string | null,
}

export function normalizeVeoQuality(quality: string, tier: VeoTier): VeoQuality {
  const q = quality === '4k' || quality === '4K' ? '4K' : quality === '1080p' ? '1080p' : '720p'
  if (tier === 'lite' && q === '4K') return '1080p'
  return q
}
