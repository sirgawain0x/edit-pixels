// fallow-ignore-file unused-export
import { createLogger } from '@/shared/logging/logger'
import { proxyGetTask, proxySubmitVideo, type SignedRequestParams } from './generative-proxy-client'
import type {
  VeoResponse,
  VeoTier,
  VeoQuality,
  VeoAspectRatio,
  GenerativeTaskDetail,
} from '../types'

const log = createLogger('VeoService')

export interface GenerateVideoParams {
  prompt: string
  imageUrls: string[]
  tier?: VeoTier
  duration?: number
  quality?: VeoQuality
  aspectRatio?: VeoAspectRatio
}

export async function submitVideoGeneration(
  params: GenerateVideoParams,
  auth: SignedRequestParams,
  signal?: AbortSignal,
): Promise<VeoResponse> {
  const {
    prompt,
    imageUrls,
    tier = 'standard',
    duration = 8,
    quality = '720p',
    aspectRatio = '16:9',
  } = params

  if (imageUrls.length === 0 || imageUrls.length > 2) {
    throw new Error('Veo image-to-video requires 1 or 2 image URLs.')
  }

  log.info('Submitting video generation', { duration, quality, tier, imageCount: imageUrls.length })
  return proxySubmitVideo(
    auth,
    {
      prompt,
      image_urls: imageUrls,
      duration,
      quality,
      tier,
      aspect_ratio: aspectRatio,
    },
    signal,
  ) as Promise<VeoResponse>
}

export async function getVideoTaskDetail(
  taskId: string,
  signal?: AbortSignal,
  auth?: SignedRequestParams,
): Promise<GenerativeTaskDetail> {
  return proxyGetTask(taskId, signal, auth)
}
