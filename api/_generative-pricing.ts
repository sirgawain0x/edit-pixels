/**
 * Server-side generative pricing — mirrors src/config/credits.ts for API routes.
 */
// fallow-ignore-file complexity,unused-export

export type VeoTier = 'standard' | 'fast' | 'lite'
export type VeoQuality = '720p' | '1080p' | '4K'
export type NanobananaQuality = '0.5K' | '1K' | '2K' | '4K'

export const FLOW_ALLOWED_DURATIONS = [4, 6, 8] as const
export type FlowDurationSec = (typeof FLOW_ALLOWED_DURATIONS)[number]

const VEO_USD_PER_SEC: Record<VeoTier, Partial<Record<VeoQuality, number>>> = {
  standard: { '720p': 0.4, '1080p': 0.4, '4K': 0.6 },
  fast: { '720p': 0.1, '1080p': 0.12, '4K': 0.3 },
  lite: { '720p': 0.05, '1080p': 0.08 },
}

const NANO_QUALITY_CREDITS: Record<NanobananaQuality, number> = {
  '0.5K': 1,
  '1K': 1,
  '2K': 1,
  '4K': 2,
}

/** Retail $0.10 per credit. */
const USDC6_PER_CREDIT = 100_000

export function clampFlowDuration(seconds: number): FlowDurationSec {
  if (!Number.isFinite(seconds)) return 8
  const rounded = Math.round(seconds)
  if (FLOW_ALLOWED_DURATIONS.includes(rounded as FlowDurationSec)) {
    return rounded as FlowDurationSec
  }
  return FLOW_ALLOWED_DURATIONS.reduce((best, d) =>
    Math.abs(d - rounded) < Math.abs(best - rounded) ? d : best,
  )
}

export function normalizeVeoQuality(quality: string, tier: VeoTier): VeoQuality {
  const q = quality === '4k' || quality === '4K' ? '4K' : quality === '1080p' ? '1080p' : '720p'
  if (tier === 'lite' && q === '4K') return '1080p'
  return q
}

export function veoModelId(tier: VeoTier): string {
  if (tier === 'fast') return 'veo-3.1-fast-generate-preview'
  if (tier === 'lite') return 'veo-3.1-lite-generate-preview'
  return 'veo-3.1-generate-preview'
}

export function quoteVeoCredits(params: {
  duration: number
  quality: VeoQuality
  tier: VeoTier
}): number {
  const duration = clampFlowDuration(params.duration)
  const quality = normalizeVeoQuality(params.quality, params.tier)
  const usdPerSec = VEO_USD_PER_SEC[params.tier][quality]
  if (!usdPerSec) {
    throw new Error(`Quality ${quality} is not supported for Veo tier ${params.tier}`)
  }
  const usd = duration * usdPerSec
  return Math.max(1, Math.ceil(usd / 0.1))
}

export function quoteNanobananaCredits(quality: NanobananaQuality): number {
  return NANO_QUALITY_CREDITS[quality] ?? 1
}

export function quoteFlowTotalCredits(input: {
  duration: number
  quality: string
  tier: VeoTier
  stillCount: number
  stillQuality?: NanobananaQuality
}): number {
  const stillQuality = input.stillQuality ?? '2K'
  const stillCount = Math.min(2, Math.max(0, Math.floor(input.stillCount)))
  const videoCredits = quoteVeoCredits({
    duration: input.duration,
    quality: normalizeVeoQuality(input.quality, input.tier),
    tier: input.tier,
  })
  const stillCredits = stillCount > 0 ? stillCount * quoteNanobananaCredits(stillQuality) : 0
  return videoCredits + stillCredits
}

export function creditsToUsdc6(credits: number): number {
  if (!Number.isFinite(credits) || credits <= 0) return 0
  return Math.max(1, Math.ceil(credits)) * USDC6_PER_CREDIT
}
