export interface DirectorPastSession {
  sessionId: string
  projectId: string | null
  promptPreview: string
  status: 'streaming' | 'completed' | 'failed'
  audioUri: string | null
  createdAt: string
  updatedAt: string
}

export async function fetchDirectorPastSessions(input: {
  walletAddress: string
  projectId?: string
  limit?: number
}): Promise<DirectorPastSession[]> {
  const params = new URLSearchParams({ wallet: input.walletAddress })
  if (input.projectId) params.set('projectId', input.projectId)
  if (input.limit != null) params.set('limit', String(input.limit))

  const response = await fetch(`/api/director-sessions?${params.toString()}`)
  if (!response.ok) return []

  const data = (await response.json()) as { sessions?: DirectorPastSession[] }
  return Array.isArray(data.sessions) ? data.sessions : []
}
