/**
 * GET /api/generate-task?id=...   — Poll Vertex Veo or Gemini Omni operation status.
 * GET /api/generate-task?media=... — Stream stored Gemini Omni MP4 on same origin.
 */
// fallow-ignore-file complexity

import { toGenerativeTaskDetail } from './_generative-task-response.js'
import { isVertexGenerativeConfigured, pollVeoOperation } from './_vertex-generative.js'
import { downloadVertexMediaBytes, pollOmniInteraction } from './_vertex-omni.js'
import { serveOmniVideoMedia, storeOmniVideoMedia } from './_omni-media-store.js'
import {
  getGenerativeTaskMeta,
  getGenerativeTaskOwner,
  updateGenerativeTaskMeta,
  type GenerativeTaskMeta,
} from './_task-registry.js'
import { syncPixelsVeoJobFromPoll } from './_pixels-generate-veo-sync.js'
import { authenticateGenerativeGet } from './_pixels-generate-route-auth.js'

async function resolveOmniPollDetail(taskId: string, meta: GenerativeTaskMeta, origin: string) {
  if (meta.mediaUrl) {
    return toGenerativeTaskDetail(taskId, meta.modelId, {
      status: 'completed',
      progress: 100,
      videoUri: meta.mediaUrl,
      mimeType: 'video/mp4',
    })
  }

  const poll = await pollOmniInteraction(meta.interactionId ?? meta.operationName)
  if (poll.status !== 'completed') {
    return toGenerativeTaskDetail(taskId, meta.modelId, poll)
  }

  const media = poll.videoBase64
    ? {
        bytes: Buffer.from(poll.videoBase64, 'base64'),
        mimeType: poll.mimeType ?? 'video/mp4',
      }
    : poll.videoUri
      ? await downloadVertexMediaBytes(poll.videoUri)
      : null

  if (!media || media.bytes.byteLength === 0) {
    return toGenerativeTaskDetail(taskId, meta.modelId, {
      status: 'failed',
      progress: 100,
      errorMessage: 'Gemini Omni completed without video data',
    })
  }

  const mediaUrl = await storeOmniVideoMedia({
    bytes: media.bytes,
    mimeType: media.mimeType,
    origin,
  })
  await updateGenerativeTaskMeta(taskId, { mediaUrl })

  return toGenerativeTaskDetail(taskId, meta.modelId, {
    status: 'completed',
    progress: 100,
    videoUri: mediaUrl,
    mimeType: media.mimeType,
  })
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const mediaToken = url.searchParams.get('media')?.trim()
  if (mediaToken) {
    return serveOmniVideoMedia(request, mediaToken)
  }

  if (!isVertexGenerativeConfigured()) {
    return Response.json({ error: 'service unavailable' }, { status: 503 })
  }

  const taskId = url.searchParams.get('id')?.trim()
  if (!taskId) {
    return Response.json({ error: 'id required' }, { status: 400 })
  }

  const authenticated = await authenticateGenerativeGet(request)
  if (!authenticated.ok) return authenticated.response
  const { signer } = authenticated

  const owner = await getGenerativeTaskOwner(taskId)
  if (!owner) {
    return Response.json({ error: 'task not found' }, { status: 404 })
  }
  if (owner !== signer.toLowerCase()) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  const meta = await getGenerativeTaskMeta(taskId)
  if (!meta) {
    return Response.json({ error: 'task metadata not found' }, { status: 404 })
  }

  try {
    const detail =
      meta.kind === 'omni'
        ? await resolveOmniPollDetail(taskId, meta, url.origin)
        : toGenerativeTaskDetail(
            taskId,
            meta.modelId,
            await pollVeoOperation(meta.operationName, meta.modelId),
          )
    await syncPixelsVeoJobFromPoll(taskId, detail)
    return Response.json(detail)
  } catch (e) {
    console.error('generate-task error', e)
    return Response.json({ error: 'poll failed' }, { status: 502 })
  }
}
