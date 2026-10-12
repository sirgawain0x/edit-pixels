/**
 * POST /api/seedance-plan — Gemini shot brief for Seedance (no Higgsfield).
 */
// fallow-ignore-file complexity,code-duplication

import { authenticateGenerativePost } from './_pixels-generate-route-auth.js'
import { isSeedanceGenerateEnabled } from './_seedance-pricing.js'
import {
  listMissingWifEnvVars,
  vertexAuthFailureHint,
  vertexAuthFailureMessage,
} from './_vertex-auth.js'
import { isVertexGenerativeConfigured, planSeedanceShotBrief } from './_vertex-generative.js'

export async function POST(request: Request): Promise<Response> {
  if (!isSeedanceGenerateEnabled()) {
    return Response.json({ error: 'feature_disabled' }, { status: 404 })
  }
  if (!isVertexGenerativeConfigured()) {
    return Response.json({ error: vertexAuthFailureHint() }, { status: 503 })
  }

  const authenticated = await authenticateGenerativePost(request)
  if (!authenticated.ok) return authenticated.response
  const { body } = authenticated

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
    const message = e instanceof Error ? e.message : 'planning failed'
    const authRelated =
      /access token|Workload Identity|application-default|ADC|OIDC|unauthorized|401|403/i.test(
        message,
      )
    if (process.env.VERCEL && (authRelated || listMissingWifEnvVars().length > 0)) {
      return Response.json({ error: vertexAuthFailureMessage(e) }, { status: 503 })
    }
    return Response.json({ error: message }, { status: 502 })
  }
}
