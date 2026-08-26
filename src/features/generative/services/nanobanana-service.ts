import { createLogger } from '@/shared/logging/logger'
import { proxyGetTask, proxySubmitImage, type SignedRequestParams } from './generative-proxy-client'
import type {
  NanobananaResponse,
  NanobananaSize,
  NanobananaQuality,
  NanobananaThinking,
  EvolinkTaskDetail,
} from '../types'

const log = createLogger('NanobananaService')

export interface GenerateImageParams {
  prompt: string
  size?: NanobananaSize
  quality?: NanobananaQuality
  imageUrls?: string[]
  thinkingLevel?: NanobananaThinking
}

export async function submitImageGeneration(
  params: GenerateImageParams,
  auth: SignedRequestParams,
  signal?: AbortSignal,
): Promise<NanobananaResponse> {
  const { prompt, size = 'auto', quality = '2K', imageUrls } = params

  log.info('Submitting image generation', { size, quality, hasRef: !!imageUrls?.length })
  return proxySubmitImage(
    auth,
    {
      prompt,
      size,
      quality,
      ...(imageUrls?.length ? { image_urls: imageUrls } : {}),
    },
    signal,
  ) as Promise<NanobananaResponse>
}

export async function getImageTaskDetail(
  taskId: string,
  signal?: AbortSignal,
): Promise<EvolinkTaskDetail> {
  return proxyGetTask(taskId, signal)
}
