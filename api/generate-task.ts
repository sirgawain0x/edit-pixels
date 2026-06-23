/**
 * GET /api/generate-task?id=...
 * Poll Evolink task status (no additional credit charge).
 */

import { evolinkServerGet, isEvolinkServerConfigured } from './_evolink-server.js';

export async function GET(request: Request): Promise<Response> {
  if (!isEvolinkServerConfigured()) {
    return Response.json({ error: 'service unavailable' }, { status: 503 });
  }

  const url = new URL(request.url);
  const taskId = url.searchParams.get('id')?.trim();
  if (!taskId) {
    return Response.json({ error: 'id required' }, { status: 400 });
  }

  try {
    const result = await evolinkServerGet<Record<string, unknown>>(`/tasks/${taskId}`);
    return Response.json(result);
  } catch (e) {
    console.error('generate-task error', e);
    return Response.json({ error: 'poll failed' }, { status: 502 });
  }
}
