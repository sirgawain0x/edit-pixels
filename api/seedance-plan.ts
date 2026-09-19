/**
 * POST /api/seedance-plan — Gemini shot brief for Seedance (no Higgsfield).
 */
// fallow-ignore-file complexity

import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js'
import { isSeedanceGenerateEnabled } from './_seedance-pricing.js'
import { isVertexGenerativeConfigured, planSeedanceShotBrief } from './_vertex-generative.js'

export async function POST(request: Request): Promise<Response> {
  if (!isSeedanceGenerateEnabled()) {
    return Response.json({ error: 'feature_disabled' }, { status: 404 })
  }
  if (!isVertexGenerativeConfigured()) {
    return Response.json({ error: 'service unavailable' }, { status: 503 })
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

  const idea = typeof body.idea === 'string' ? body.idea.trim() : ''
  if (!idea) {
    return Response.json({ error: 'idea required' }, { status: 400 })
  }

  const timelineContext =
    typeof body.timelineContext === 'string' ? body.timelineContext.trim() : undefined

  try {
    const brief = await planSeedanceShotBrief(idea, timelineContext)
    return Response.json({ brief })
  } catch (e) {
    console.error('seedance-plan error', e)
    return Response.json(
      { error: e instanceof Error ? e.message : 'planning failed' },
      { status: 502 },
    )
  }
}
