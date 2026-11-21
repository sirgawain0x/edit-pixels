/// <reference types="node" />
/**
 * POST /api/director-tts — Creative Director read-aloud via Gemini TTS.
 *
 * Body: `{ text: string }` (already markdown-stripped by the client, one chunk).
 * Auth: Privy bearer (+ optional `x-pixels-signer`) — same identity as Director routes.
 * Returns `audio/wav` bytes. 503 when `GEMINI_API_KEY` is not configured so the
 * client can fall back to browser speech synthesis.
 *
 * Env:
 *   GEMINI_API_KEY        - Gemini Developer API key (required)
 *   DIRECTOR_TTS_MODEL    - default `gemini-3.8-flash-tts`
 *   DIRECTOR_TTS_VOICE    - prebuilt voice, default `Kore` (never Puck by default)
 */
import { resolvePixelsIdentity } from './_pixels-identity.js'
import { rateLimitByClientIp, rateLimitByIdentity } from './_rate-limit.js'

const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions'
const DEFAULT_TTS_MODEL = 'gemini-3.8-flash-tts'
const DEFAULT_TTS_VOICE = 'Kore'
/** Hard cap per request; the client chunks long replies into ≤1,200-char pieces. */
const DIRECTOR_TTS_MAX_CHARS = 2_000
const TTS_UPSTREAM_TIMEOUT_MS = 45_000
const DIRECTOR_TTS_STYLE =
  'warm, confident creative director; natural conversational pacing, clear and friendly'

function geminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || null
}

function directorTtsVoice(): string {
  const raw = process.env.DIRECTOR_TTS_VOICE?.trim()
  return raw && /^[A-Za-z0-9_-]{2,64}$/.test(raw) ? raw : DEFAULT_TTS_VOICE
}

function directorTtsModel(): string {
  const raw = process.env.DIRECTOR_TTS_MODEL?.trim()
  return raw && /^[a-z0-9.-]{3,64}$/.test(raw) ? raw : DEFAULT_TTS_MODEL
}

interface InteractionContent {
  type?: string
  data?: string
  mime_type?: string
}

interface InteractionResponse {
  steps?: Array<{ type?: string; content?: InteractionContent[] }>
}

/** Last audio block from an Interactions response (REST: `steps[].content[].data`). */
function extractInteractionAudio(
  payload: InteractionResponse,
): { data: string; mimeType: string } | null {
  let found: { data: string; mimeType: string } | null = null
  for (const step of payload.steps ?? []) {
    for (const part of step.content ?? []) {
      if (part.type === 'audio' && typeof part.data === 'string' && part.data.length > 0) {
        found = { data: part.data, mimeType: part.mime_type || 'audio/wav' }
      }
    }
  }
  return found
}

function buildTtsRequestBody(text: string): string {
  return JSON.stringify({
    model: directorTtsModel(),
    store: false,
    input: [
      {
        type: 'user_input',
        content: [
          {
            type: 'text',
            text,
            annotations: [{ type: 'speech_metadata', style: DIRECTOR_TTS_STYLE }],
          },
        ],
      },
    ],
    response_format: { type: 'audio' },
    generation_config: {
      speech_config: [{ voice: directorTtsVoice() }],
    },
  })
}

/** Validated chunk text, or an error response. */
function readTtsText(
  body: Record<string, unknown>,
): { ok: true; text: string } | { ok: false; response: Response } {
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) {
    return { ok: false, response: Response.json({ error: 'text required' }, { status: 400 }) }
  }
  if (text.length > DIRECTOR_TTS_MAX_CHARS) {
    return {
      ok: false,
      response: Response.json(
        { error: `text too long (max ${DIRECTOR_TTS_MAX_CHARS} chars per request)` },
        { status: 413 },
      ),
    }
  }
  return { ok: true, text }
}

async function synthesizeSpeech(text: string, apiKey: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TTS_UPSTREAM_TIMEOUT_MS)
  try {
    const upstream = await fetch(GEMINI_INTERACTIONS_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: buildTtsRequestBody(text),
    })
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '')
      console.error('Director TTS upstream error', upstream.status, detail.slice(0, 500))
      return Response.json({ error: 'tts_failed' }, { status: 502 })
    }
    const audio = extractInteractionAudio((await upstream.json()) as InteractionResponse)
    if (!audio) {
      console.error('Director TTS: no audio in response')
      return Response.json({ error: 'tts_failed' }, { status: 502 })
    }
    return new Response(Buffer.from(audio.data, 'base64'), {
      status: 200,
      headers: { 'Content-Type': audio.mimeType, 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    console.error('Director TTS fetch error', aborted ? 'timeout' : error)
    return Response.json(
      { error: aborted ? 'tts_timeout' : 'tts_failed' },
      { status: aborted ? 504 : 502 },
    )
  } finally {
    clearTimeout(timer)
  }
}

export async function POST(request: Request): Promise<Response> {
  const ipLimited = await rateLimitByClientIp(request, 'tts')
  if (ipLimited) return ipLimited

  const identity = await resolvePixelsIdentity(request)
  if (!identity.ok) return identity.response

  const identityLimited = await rateLimitByIdentity(request, 'tts', identity.identity.signer)
  if (identityLimited) return identityLimited

  const parsed = readTtsText(identity.body)
  if (!parsed.ok) return parsed.response

  const apiKey = geminiApiKey()
  if (!apiKey) {
    return Response.json({ error: 'tts_unavailable' }, { status: 503 })
  }

  return synthesizeSpeech(parsed.text, apiKey)
}
