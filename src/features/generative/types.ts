// fallow-ignore-file unused-export,unused-type
// ---------------------------------------------------------------------------
// Generative / Vertex AI shared types
// ---------------------------------------------------------------------------

/** Task status from async generative APIs. */
export type GenerativeTaskStatus = 'pending' | 'processing' | 'completed' | 'failed'

/** @deprecated Use GenerativeTaskStatus */
export type EvolinkTaskStatus = GenerativeTaskStatus

/** Unified task detail response (videos + images share this shape). */
export interface GenerativeTaskDetail {
  id: string
  status: GenerativeTaskStatus
  progress: number
  model: string
  /** Present when status === 'completed'. */
  output?: {
    video_url?: string
    image_url?: string
    /** May return multiple images. */
    image_urls?: string[]
  }
  /** Present when status === 'failed'. */
  error?: { code: string; message: string; type: string }
  task_info?: {
    can_cancel?: boolean
    estimated_time?: number
    video_duration?: number
  }
}

/** @deprecated Use GenerativeTaskDetail */
export type EvolinkTaskDetail = GenerativeTaskDetail

// ---------------------------------------------------------------------------
// Veo 3.1 (image-to-video)
// ---------------------------------------------------------------------------

export type VeoTier = 'standard' | 'fast' | 'lite'

export type VeoQuality = '720p' | '1080p' | '4K'

/** @deprecated Use VeoTier */
export type SeedanceSpeed = VeoTier
/** @deprecated Use VeoQuality */
export type SeedanceQuality = VeoQuality

export type VeoAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9' | 'adaptive'

/** @deprecated Use VeoAspectRatio */
export type SeedanceAspectRatio = VeoAspectRatio

export interface VeoRequest {
  model: string
  prompt: string
  image_urls: string[]
  duration?: number
  quality?: VeoQuality
  tier?: VeoTier
  aspect_ratio?: VeoAspectRatio
}

export interface VeoResponse {
  id: string
  model: string
  status: GenerativeTaskStatus
  progress: number
}

/** Maps Veo tier to Vertex model id. */
export function veoModelId(tier: VeoTier): string {
  if (tier === 'fast') return 'veo-3.1-fast-generate-preview'
  if (tier === 'lite') return 'veo-3.1-lite-generate-preview'
  return 'veo-3.1-generate-preview'
}

/** @deprecated Use veoModelId */
export function seedanceModelId(tier: VeoTier): string {
  return veoModelId(tier)
}

// ---------------------------------------------------------------------------
// Gemini image (stills)
// ---------------------------------------------------------------------------

export type NanobananaSize =
  | 'auto'
  | '1:1'
  | '2:3'
  | '3:2'
  | '3:4'
  | '4:3'
  | '4:5'
  | '5:4'
  | '9:16'
  | '16:9'
  | '21:9'

export type NanobananaQuality = '0.5K' | '1K' | '2K' | '4K'

export interface NanobananaRequest {
  model: 'gemini-2.5-flash-image'
  prompt: string
  size?: NanobananaSize
  quality?: NanobananaQuality
  image_urls?: string[]
}

export interface NanobananaResponse {
  id: string
  model: string
  status: GenerativeTaskStatus
  progress: number
}

// ---------------------------------------------------------------------------
// Generative store types
// ---------------------------------------------------------------------------

/** Discriminated union for image sources in Start/End nodes. */
export type ImageSource =
  | { type: 'file'; blob: Blob; objectUrl: string }
  | { type: 'generated'; url: string; prompt: string }

/** State of an async generative task. */
export interface TaskState {
  taskId: string | null
  status: GenerativeTaskStatus | 'idle' | 'cancelled'
  progress: number
  resultUrl: string | null
  error: string | null
}

export const IDLE_TASK: TaskState = {
  taskId: null,
  status: 'idle',
  progress: 0,
  resultUrl: null,
  error: null,
}
