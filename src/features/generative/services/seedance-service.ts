// fallow-ignore-file unused-file
import { createLogger } from '@/shared/logging/logger'
import { proxyGetTask, proxySubmitVideo, type SignedRequestParams } from './generative-proxy-client'
import type {
  SeedanceResponse,
  SeedanceSpeed,
  SeedanceQuality,
  SeedanceAspectRatio,
  EvolinkTaskDetail,
} from '../types'

const log = createLogger('SeedanceService')

export interface GenerateVideoParams {
  prompt: string
  imageUrls: string[]
  speed?: SeedanceSpeed
  duration?: number
  quality?: SeedanceQuality
  aspectRatio?: SeedanceAspectRatio
  generateAudio?: boolean
}

export async function submitVideoGeneration(
  params: GenerateVideoParams,
  auth: SignedRequestParams,
  signal?: AbortSignal,
): Promise<SeedanceResponse> {
  const {
    prompt,
    imageUrls,
    speed = 'standard',
    duration = 5,
    quality = '720p',
    aspectRatio = 'adaptive',
    generateAudio = true,
  } = params

  if (imageUrls.length === 0 || imageUrls.length > 2) {
    throw new Error('Seedance image-to-video requires 1 or 2 image URLs.')
  }

  log.info('Submitting video generation', { duration, quality, imageCount: imageUrls.length })
  return proxySubmitVideo(
    auth,
    {
      prompt,
      image_urls: imageUrls,
      duration,
      quality,
      speed,
      aspect_ratio: aspectRatio,
      generate_audio: generateAudio,
    },
    signal,
  ) as Promise<SeedanceResponse>
}

export async function getVideoTaskDetail(
  taskId: string,
  signal?: AbortSignal,
): Promise<EvolinkTaskDetail> {
  return proxyGetTask(taskId, signal)
}
