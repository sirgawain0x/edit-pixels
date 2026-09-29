/**
 * Higgsfield Seedance 2.5 text-to-video — server-only credentials.
 */
// fallow-ignore-file complexity,unused-export

import { config, higgsfield } from '@higgsfield/client/v2'
import {
  SEEDANCE_MODEL_ID,
  clampSeedanceDuration,
  type SeedanceAspectRatio,
  type SeedanceResolution,
} from './_seedance-pricing.js'

export interface SeedanceGenerateInput {
  prompt: string
  duration?: number
  resolution?: SeedanceResolution
  aspect_ratio?: SeedanceAspectRatio
  generate_audio?: boolean
}

export interface SeedanceGenerateResult {
  requestId: string
  videoUrl: string
  mock: boolean
}

function readCredentials(): string | null {
  const combined = process.env.HIGGSFIELD_CREDENTIALS?.trim()
  if (combined) return combined
  const keyId = process.env.HIGGSFIELD_KEY_ID?.trim()
  const keySecret = process.env.HIGGSFIELD_KEY_SECRET?.trim()
  if (keyId && keySecret) return `${keyId}:${keySecret}`
  return null
}

export function isHiggsfieldConfigured(): boolean {
  if (process.env.HIGGSFIELD_MOCK === '1' || process.env.HIGGSFIELD_MOCK === 'true') {
    return true
  }
  return Boolean(readCredentials())
}

function mockVideoUrl(): string {
  const override = process.env.HIGGSFIELD_MOCK_VIDEO_URL?.trim()
  if (override) return override
  return 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'
}

export async function generateSeedanceVideo(
  input: SeedanceGenerateInput,
): Promise<SeedanceGenerateResult> {
  const prompt = input.prompt.trim()
  if (!prompt) {
    throw new Error('prompt required')
  }

  const duration = clampSeedanceDuration(input.duration ?? 5)
  const resolution = input.resolution === '480p' ? '480p' : '720p'
  const aspect_ratio = input.aspect_ratio ?? '16:9'
  const generate_audio = input.generate_audio ?? true

  if (process.env.HIGGSFIELD_MOCK === '1' || process.env.HIGGSFIELD_MOCK === 'true') {
    return {
      requestId: `mock-${Date.now()}`,
      videoUrl: mockVideoUrl(),
      mock: true,
    }
  }

  const credentials = readCredentials()
  if (!credentials) {
    throw new Error('Higgsfield credentials not configured')
  }

  config({ credentials })

  const result = await higgsfield.subscribe(SEEDANCE_MODEL_ID, {
    input: {
      prompt,
      duration,
      resolution,
      aspect_ratio,
      output_format: 'mp4',
      generate_audio,
    },
    withPolling: true,
  })

  if (result.status !== 'completed' || !result.video?.url) {
    throw new Error(`Seedance generation failed (${result.status})`)
  }

  return {
    requestId: result.request_id,
    videoUrl: result.video.url,
    mock: false,
  }
}
