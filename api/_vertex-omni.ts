/// <reference types="node" />
/**
 * Vertex AI Interactions API client for Gemini Omni 1.2 Flash (gemini-omni-1.2-flash).
 */
// fallow-ignore-file complexity,unused-export

import { getVertexAccessToken, getVertexProject } from './_vertex-auth.js'
import {
  clampOmniDuration,
  GEMINI_OMNI_MODEL,
  normalizeOmniQuality,
} from './_generative-pricing.js'
import type { ImageBytesInput, VeoPollResult } from './_vertex-generative.js'

const INTERACTION_FLOW_MAX_SEC = 10

interface InteractionContentItem {
  type?: string
  text?: string
  data?: string
  uri?: string
  mime_type?: string
}

interface InteractionStep {
  type?: string
  content?: InteractionContentItem[]
}

interface InteractionResponse {
  id?: string
  status?: string
  error?: { message?: string }
  steps?: InteractionStep[]
  outputs?: InteractionContentItem[]
}

function interactionsBaseUrl(): string {
  const project = getVertexProject()
  return `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/interactions`
}

async function interactionsFetch<T>(url: string, init: RequestInit): Promise<T> {
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
    throw new Error(`Vertex Omni error ${response.status}: ${text}`)
  }
  return (await response.json()) as T
}

export function normalizeOmniAspectRatio(raw?: string): '16:9' | '9:16' {
  return raw?.trim() === '9:16' ? '9:16' : '16:9'
}

export function toOmniApiResolution(quality?: string): '360p' | '720p' | '1080p' | '4k' {
  const normalized = normalizeOmniQuality(quality ?? '720p')
  return normalized === '4K' ? '4k' : normalized
}

export function buildOmniPrompt(prompt: string, hasStart: boolean, hasEnd: boolean): string {
  const trimmed = prompt.trim()
  const lower = trimmed.toLowerCase()
  if (lower.includes('starting frame') || lower.includes('first frame')) {
    return trimmed
  }
  const sep = !trimmed || /[.!?]$/.test(trimmed) ? '' : '.'
  if (hasStart && hasEnd) {
    return `${trimmed}${sep} Use the first image as the starting frame and the second image as the final frame.`.trim()
  }
  if (hasStart) {
    return `${trimmed}${sep} Use this image as the starting frame.`.trim()
  }
  return trimmed
}

export interface StartOmniVideoParams {
  prompt: string
  startImage?: ImageBytesInput
  endImage?: ImageBytesInput
  duration: number
  quality?: string
  aspectRatio?: string
}

export interface OmniInteractionStart {
  interactionId: string
  modelId: string
}

/** Start an async Gemini Omni 1.2 Flash video generation via Vertex Interactions API. */
export async function startOmniVideo(params: StartOmniVideoParams): Promise<OmniInteractionStart> {
  const hasStart = Boolean(params.startImage)
  const hasEnd = Boolean(params.startImage && params.endImage)
  const clamped = clampOmniDuration(params.duration)
  const duration = hasEnd ? Math.min(INTERACTION_FLOW_MAX_SEC, clamped) : clamped

  const content: Array<Record<string, unknown>> = []
  if (params.startImage) {
    content.push({
      type: 'image',
      data: params.startImage.bytes.toString('base64'),
      mime_type: params.startImage.mimeType,
    })
  }
  if (params.endImage) {
    content.push({
      type: 'image',
      data: params.endImage.bytes.toString('base64'),
      mime_type: params.endImage.mimeType,
    })
  }
  content.push({
    type: 'text',
    text: buildOmniPrompt(params.prompt, hasStart, hasEnd),
  })

  const result = await interactionsFetch<InteractionResponse>(interactionsBaseUrl(), {
    method: 'POST',
    body: JSON.stringify({
      model: GEMINI_OMNI_MODEL,
      background: true,
      input: [{ type: 'user_input', content }],
      response_format: {
        type: 'video',
        aspect_ratio: normalizeOmniAspectRatio(params.aspectRatio),
        resolution: toOmniApiResolution(params.quality),
        duration: `${duration}s`,
      },
    }),
  })

  if (!result.id) {
    throw new Error('Gemini Omni did not return an interaction id')
  }

  return {
    interactionId: result.id,
    modelId: GEMINI_OMNI_MODEL,
  }
}

function findVideoContent(result: InteractionResponse): InteractionContentItem | undefined {
  const steps = result.steps ?? []
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i]
    if (step?.type !== 'model_output' || !Array.isArray(step.content)) continue
    const found = step.content.find(
      (item) => item.type === 'video' || item.mime_type?.startsWith('video/'),
    )
    if (found) return found
  }

  const outputs = result.outputs ?? []
  return outputs.find((item) => item.type === 'video' || item.mime_type?.startsWith('video/'))
}

/** Poll a Vertex AI Interactions task for Gemini Omni video output. */
export async function pollOmniInteraction(interactionId: string): Promise<VeoPollResult> {
  const url = `${interactionsBaseUrl()}/${encodeURIComponent(interactionId)}`
  const result = await interactionsFetch<InteractionResponse>(url, { method: 'GET' })
  const status = result.status?.toLowerCase() ?? ''

  if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
    return {
      status: 'failed',
      progress: 100,
      errorMessage: result.error?.message ?? `Gemini Omni generation ${status}`,
    }
  }

  if (status === 'completed') {
    const video = findVideoContent(result)
    if (!video) {
      return {
        status: 'failed',
        progress: 100,
        errorMessage: 'Gemini Omni completed without video output',
      }
    }
    if (video.data) {
      return {
        status: 'completed',
        progress: 100,
        videoBase64: video.data,
        mimeType: video.mime_type ?? 'video/mp4',
      }
    }
    if (video.uri) {
      return {
        status: 'completed',
        progress: 100,
        videoUri: video.uri,
        mimeType: video.mime_type ?? 'video/mp4',
      }
    }
    return {
      status: 'failed',
      progress: 100,
      errorMessage: 'Gemini Omni output missing video data',
    }
  }

  if (status === 'queued' || status === 'pending') {
    return { status: 'pending', progress: 5 }
  }

  return { status: 'processing', progress: 35 }
}

/** Best-effort cancellation of a background Gemini Omni interaction. */
export async function cancelOmniInteraction(interactionId: string): Promise<void> {
  if (!interactionId.trim()) return
  const url = `${interactionsBaseUrl()}/${encodeURIComponent(interactionId)}/cancel`
  try {
    const token = await getVertexAccessToken()
    await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })
  } catch {
    // Best-effort cancel; local job state still marks cancelled.
  }
}

/** Download video bytes if Interactions API returns a gs:// or Google URI instead of inline base64. */
export async function downloadVertexMediaBytes(
  uri: string,
): Promise<{ bytes: Buffer; mimeType: string }> {
  const token = await getVertexAccessToken()
  let targetUrl = uri.trim()
  const headers: Record<string, string> = {}

  if (targetUrl.startsWith('gs://')) {
    const withoutScheme = targetUrl.slice('gs://'.length)
    const slashIdx = withoutScheme.indexOf('/')
    if (slashIdx <= 0) {
      throw new Error(`Invalid gs:// URI: ${uri}`)
    }
    const bucket = withoutScheme.slice(0, slashIdx)
    const objectName = withoutScheme.slice(slashIdx + 1)
    targetUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}?alt=media`
    headers.Authorization = `Bearer ${token}`
  } else if (
    targetUrl.includes('googleapis.com/') ||
    targetUrl.includes('generativelanguage.googleapis.com/')
  ) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(targetUrl, { headers })
  if (!response.ok) {
    throw new Error(`Failed to download Omni video (${response.status})`)
  }
  const mimeType = response.headers.get('content-type') ?? 'video/mp4'
  const bytes = Buffer.from(await response.arrayBuffer())
  return { bytes, mimeType }
}
