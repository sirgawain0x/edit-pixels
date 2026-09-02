/**
 * Map Vertex Veo poll results to client GenerativeTaskDetail shape.
 */
// fallow-ignore-file complexity

import type { VeoPollResult } from './_vertex-generative.js'

export type GenerativeTaskStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface GenerativeTaskDetail {
  id: string
  status: GenerativeTaskStatus
  progress: number
  model: string
  output?: {
    video_url?: string
    image_url?: string
    image_urls?: string[]
  }
  error?: { code: string; message: string; type: string }
}

export function toGenerativeTaskDetail(
  taskId: string,
  model: string,
  poll: VeoPollResult,
): GenerativeTaskDetail {
  if (poll.status === 'failed') {
    return {
      id: taskId,
      status: 'failed',
      progress: poll.progress,
      model,
      error: {
        code: 'generation_failed',
        message: poll.errorMessage ?? 'Generation failed',
        type: 'vertex',
      },
    }
  }

  if (poll.status === 'completed') {
    const videoUrl = poll.videoUri
      ? poll.videoUri
      : poll.videoBase64
        ? `data:${poll.mimeType ?? 'video/mp4'};base64,${poll.videoBase64}`
        : undefined
    return {
      id: taskId,
      status: 'completed',
      progress: 100,
      model,
      output: videoUrl ? { video_url: videoUrl } : undefined,
    }
  }

  return {
    id: taskId,
    status: poll.status === 'pending' ? 'pending' : 'processing',
    progress: poll.progress,
    model,
  }
}

export function completedImageTask(
  taskId: string,
  model: string,
  imageUrl: string,
): GenerativeTaskDetail {
  return {
    id: taskId,
    status: 'completed',
    progress: 100,
    model,
    output: { image_url: imageUrl },
  }
}
