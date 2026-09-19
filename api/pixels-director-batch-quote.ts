/**
 * POST /api/pixels-director-batch-quote — CRTVAI estimates for N storyboard shots (no spend).
 */
// fallow-ignore-file complexity

import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js'
import { isSeedanceGenerateEnabled } from './_seedance-pricing.js'
import { quoteDirectorStoryboardBatch } from './_director-batch-quote-core.js'
import type { DirectorStoryboardShotInput } from './_director-generate-map.js'

function parseShots(raw: unknown): DirectorStoryboardShotInput[] | null {
  if (!Array.isArray(raw)) return null
  const shots: DirectorStoryboardShotInput[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null
    const shot = item as Record<string, unknown>
    if (typeof shot.shotId !== 'string' || typeof shot.prompt !== 'string') return null
    shots.push({
      shotId: shot.shotId,
      prompt: shot.prompt,
      duration: typeof shot.duration === 'number' ? shot.duration : undefined,
      aspectRatio:
        typeof shot.aspectRatio === 'string'
          ? shot.aspectRatio
          : typeof shot.aspect_ratio === 'string'
            ? shot.aspect_ratio
            : undefined,
      consistentCharacter:
        shot.consistentCharacter === true || shot.consistent_character === true,
      resolution: shot.resolution === '480p' ? '480p' : shot.resolution === '720p' ? '720p' : undefined,
    })
  }
  return shots
}

export async function POST(request: Request): Promise<Response> {
  if (!isSeedanceGenerateEnabled()) {
    return Response.json({ error: 'feature_disabled' }, { status: 404 })
  }

  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return Response.json({ error: 'invalid body' }, { status: 400 })
    }
    body = parsed as Record<string, unknown>
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }

  const token = getBearerToken(request) || (typeof body.token === 'string' ? body.token : null)
  if (!token) {
    return Response.json({ error: 'missing authorization' }, { status: 401 })
  }

  const auth = await verifyPrivyAccessToken(
    token,
    typeof body.walletAddress === 'string' ? body.walletAddress : undefined,
  )
  if (!auth) {
    return Response.json({ error: 'invalid authorization' }, { status: 401 })
  }

  const shots = parseShots(body.shots)
  if (!shots) {
    return Response.json({ error: 'invalid shots' }, { status: 400 })
  }

  const providerPreference =
    body.providerPreference === 'veo' || body.providerPreference === 'seedance'
      ? body.providerPreference
      : body.provider_preference === 'veo' || body.provider_preference === 'seedance'
        ? body.provider_preference
        : null

  const result = await quoteDirectorStoryboardBatch({
    wallet: auth.address,
    shots,
    providerPreference,
    storyboardId:
      typeof body.storyboardId === 'string'
        ? body.storyboardId
        : typeof body.storyboard_id === 'string'
          ? body.storyboard_id
          : null,
    defaultResolution: body.resolution === '480p' ? '480p' : '720p',
  })

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 })
  }

  return Response.json(result.quote)
}
