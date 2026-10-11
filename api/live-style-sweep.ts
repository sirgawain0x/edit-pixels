/**
 * POST /api/live-style-sweep — cron hook to stop sessions with missed heartbeats.
 * Auth: `Authorization: Bearer <LIVE_STYLE_SWEEP_SECRET>` (placeholder env).
 */
// fallow-ignore-file complexity,duplicate-export

import { isLiveStyleEnabled } from './_live-style-config.js'
import { runLiveStyleSessionSweep } from './_live-style-sweep.js'

export async function POST(request: Request): Promise<Response> {
  if (!isLiveStyleEnabled()) {
    return Response.json({ error: 'feature_disabled' }, { status: 404 })
  }

  const secret = process.env.LIVE_STYLE_SWEEP_SECRET?.trim()
  if (!secret) {
    return Response.json({ error: 'sweep_not_configured' }, { status: 503 })
  }

  const header = request.headers.get('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (token !== secret) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const result = await runLiveStyleSessionSweep()
  return Response.json({ ok: true, stoppedSessionIds: result.stoppedSessionIds })
}
