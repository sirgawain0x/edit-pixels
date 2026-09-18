/// <reference types="node" />
/**
 * Vertex AI generative helpers — Gemini image stills + Veo 3.1 video (LRO).
 */
// fallow-ignore-file complexity,unused-export

import {
  getVertexAccessToken,
  getVertexLocation,
  getVertexProject,
  isVertexAuthConfigured,
} from './_vertex-auth.js'
import {
  clampFlowDuration,
  normalizeVeoQuality,
  veoModelId,
  type FlowDurationSec,
  type VeoQuality,
  type VeoTier,
} from './_generative-pricing.js'

const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image'
const GEMINI_TEXT_MODEL = 'gemini-2.5-flash'

export function isVertexGenerativeConfigured(): boolean {
  return isVertexAuthConfigured() && Boolean(getVertexProject())
}

function vertexBaseUrl(): string {
  const location = getVertexLocation()
  return `https://${location}-aiplatform.googleapis.com/v1`
}

function modelUrl(modelId: string, method: string): string {
  const project = getVertexProject()
  const location = getVertexLocation()
  return `${vertexBaseUrl()}/projects/${project}/locations/${location}/publishers/google/models/${modelId}:${method}`
}

async function vertexFetch<T>(url: string, init: RequestInit): Promise<T> {
  const token = await getVertexAccessToken()
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Vertex error ${response.status}: ${text}`)
  }
  return (await response.json()) as T
}

function imageSizeFromQuality(quality: string): string {
  const map: Record<string, string> = {
    '0.5K': '512px',
    '1K': '1K',
    '2K': '2K',
    '4K': '4K',
  }
  return map[quality] ?? '2K'
}

export interface GeneratedImageResult {
  mimeType: string
  base64: string
}

/** Generate a still image via Vertex Gemini. */
export async function generateGeminiImage(
  prompt: string,
  options: { quality?: string; aspectRatio?: string } = {},
): Promise<GeneratedImageResult> {
  const url = modelUrl(GEMINI_IMAGE_MODEL, 'generateContent')
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio: options.aspectRatio ?? '16:9',
        imageSize: imageSizeFromQuality(options.quality ?? '2K'),
      },
    },
  }

  const result = await vertexFetch<{
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> }
    }>
  }>(url, { method: 'POST', body: JSON.stringify(body) })

  const parts = result.candidates?.[0]?.content?.parts ?? []
  for (const part of parts) {
    const inline = part.inlineData
    if (inline?.data) {
      return {
        mimeType: inline.mimeType ?? 'image/png',
        base64: inline.data,
      }
    }
  }
  throw new Error('Gemini image generation returned no image data')
}

export interface SeedanceShotBrief {
  prompt: string
  duration: number
  aspect_ratio: string
  framing: string
}

/** Gemini planning for Seedance — prompt, duration, framing only (no Higgsfield). */
export async function planSeedanceShotBrief(
  idea: string,
  timelineContext?: string,
): Promise<SeedanceShotBrief> {
  const url = modelUrl(GEMINI_TEXT_MODEL, 'generateContent')
  const system = [
    'You are a Creative Director planning a single text-to-video shot for Seedance 2.5.',
    'Return ONLY valid JSON with keys: prompt (string), duration (integer 4-30), aspect_ratio (one of 16:9, 4:3, 1:1, 3:4, 9:16, 21:9), framing (short string describing camera/framing).',
    'The prompt must be vivid, cinematic, and self-contained for a text-to-video model.',
    'Do not mention Higgsfield, APIs, or billing.',
  ].join('\n')

  const userParts = [idea.trim()]
  if (timelineContext?.trim()) {
    userParts.push('\n\nTimeline context:\n', timelineContext.trim())
  }

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: `${system}\n\nCreator idea:\n${userParts.join('')}` }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.7,
    },
  }

  const result = await vertexFetch<{
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }>(url, { method: 'POST', body: JSON.stringify(body) })

  const text = result.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text
  if (!text) {
    throw new Error('Gemini shot planning returned no text')
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error('Gemini shot planning returned invalid JSON')
  }

  const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : ''
  const durationRaw = typeof parsed.duration === 'number' ? parsed.duration : 5
  const aspect_ratio =
    typeof parsed.aspect_ratio === 'string' ? parsed.aspect_ratio.trim() : '16:9'
  const framing = typeof parsed.framing === 'string' ? parsed.framing.trim() : 'Medium shot'

  if (!prompt) {
    throw new Error('Gemini shot planning returned empty prompt')
  }

  const duration = Math.min(30, Math.max(4, Math.round(durationRaw)))

  return { prompt, duration, aspect_ratio, framing }
}

export interface ImageBytesInput {
  bytes: Buffer
  mimeType: string
}

export async function fetchImageBytes(url: string): Promise<ImageBytesInput> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch image (${response.status})`)
  }
  const mimeType = response.headers.get('content-type') ?? 'image/jpeg'
  const bytes = Buffer.from(await response.arrayBuffer())
  return { bytes, mimeType }
}

export interface StartVeoVideoParams {
  tier: VeoTier
  prompt: string
  startImage: ImageBytesInput
  endImage?: ImageBytesInput
  duration: FlowDurationSec
  quality: VeoQuality
  aspectRatio?: string
}

export interface VeoOperationStart {
  operationName: string
  modelId: string
}

/** Start Veo 3.1 image-to-video (optionally start + last frame). */
export async function startVeoVideo(params: StartVeoVideoParams): Promise<VeoOperationStart> {
  const modelId = veoModelId(params.tier)
  const url = modelUrl(modelId, 'predictLongRunning')
  const quality = normalizeVeoQuality(params.quality, params.tier)
  const duration = clampFlowDuration(params.duration)

  const instance: Record<string, unknown> = {
    prompt: params.prompt,
    image: {
      bytesBase64Encoded: params.startImage.bytes.toString('base64'),
      mimeType: params.startImage.mimeType,
    },
  }
  if (params.endImage) {
    instance.lastFrame = {
      bytesBase64Encoded: params.endImage.bytes.toString('base64'),
      mimeType: params.endImage.mimeType,
    }
  }

  const result = await vertexFetch<{ name?: string }>(url, {
    method: 'POST',
    body: JSON.stringify({
      instances: [instance],
      parameters: {
        sampleCount: 1,
        durationSeconds: duration,
        resolution: quality === '4K' ? '4k' : quality,
        aspectRatio: params.aspectRatio ?? '16:9',
        generateAudio: true,
      },
    }),
  })

  if (!result.name) {
    throw new Error('Veo did not return an operation name')
  }
  return { operationName: result.name, modelId }
}

export type VeoPollStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface VeoPollResult {
  status: VeoPollStatus
  progress: number
  videoUri?: string
  videoBase64?: string
  mimeType?: string
  errorMessage?: string
}

function parseGcsUri(uri: string): string {
  if (uri.startsWith('gs://')) {
    return `https://storage.googleapis.com/${uri.slice('gs://'.length)}`
  }
  return uri
}

/** Poll a Veo long-running operation via fetchPredictOperation. */
export async function pollVeoOperation(
  operationName: string,
  modelId: string,
): Promise<VeoPollResult> {
  const url = modelUrl(modelId, 'fetchPredictOperation')
  const result = await vertexFetch<{
    done?: boolean
    error?: { message?: string }
    response?: {
      videos?: Array<{ gcsUri?: string; bytesBase64Encoded?: string; mimeType?: string }>
      generatedVideos?: Array<{ gcsUri?: string; bytesBase64Encoded?: string; mimeType?: string }>
    }
    metadata?: { progressPercent?: number }
  }>(url, {
    method: 'POST',
    body: JSON.stringify({ operationName }),
  })

  if (result.error?.message) {
    return { status: 'failed', progress: 100, errorMessage: result.error.message }
  }

  if (!result.done) {
    const progress =
      typeof result.metadata?.progressPercent === 'number' ? result.metadata.progressPercent : 0
    return { status: 'processing', progress }
  }

  const videos = result.response?.videos ?? result.response?.generatedVideos ?? []
  const video = videos[0]
  if (!video) {
    return { status: 'failed', progress: 100, errorMessage: 'Veo completed without video output' }
  }

  if (video.gcsUri) {
    return {
      status: 'completed',
      progress: 100,
      videoUri: parseGcsUri(video.gcsUri),
      mimeType: video.mimeType ?? 'video/mp4',
    }
  }
  if (video.bytesBase64Encoded) {
    return {
      status: 'completed',
      progress: 100,
      videoBase64: video.bytesBase64Encoded,
      mimeType: video.mimeType ?? 'video/mp4',
    }
  }

  return { status: 'failed', progress: 100, errorMessage: 'Veo output missing video bytes' }
}

/** Blocking poll for inline still generation inside flow-run. */
export async function waitForVeoVideo(
  operationName: string,
  modelId: string,
  maxAttempts = 120,
): Promise<VeoPollResult> {
  for (let i = 0; i < maxAttempts; i++) {
    const detail = await pollVeoOperation(operationName, modelId)
    if (detail.status === 'completed' || detail.status === 'failed') {
      return detail
    }
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error('Veo video generation timed out')
}

export function shortTaskId(operationName: string): string {
  const parts = operationName.split('/')
  return parts[parts.length - 1] ?? operationName
}
