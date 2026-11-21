export interface DirectorPastSession {
  sessionId: string
  projectId: string | null
  promptPreview: string
  status: 'streaming' | 'completed' | 'failed'
  audioUri: string | null
  createdAt: string
  updatedAt: string
}

export interface DirectorTranscriptMessage {
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface DirectorSessionTranscript {
  sessionId: string
  promptPreview: string
  status: DirectorPastSession['status']
  projectId: string | null
  updatedAt: string
  messages: DirectorTranscriptMessage[]
  source: 'turns' | 'storyboards' | 'empty'
}

interface DirectorSessionsAuth {
  walletAddress: string
  accessToken: string
  signerAddress: string
}

function authHeaders(input: DirectorSessionsAuth): HeadersInit {
  return {
    Authorization: `Bearer ${input.accessToken}`,
    'x-pixels-signer': input.signerAddress,
  }
}

/**
 * Older session previews were saved with the timeline-audio context appended
 * after a blank line — keep only what the user actually typed.
 */
export function briefTitleFromPrompt(prompt: string): string {
  const firstBlock = prompt.trim().split(/\n\s*\n/)[0] ?? ''
  return firstBlock.trim()
}

export async function fetchDirectorPastSessions(
  input: DirectorSessionsAuth & { projectId?: string; limit?: number },
): Promise<DirectorPastSession[]> {
  const params = new URLSearchParams({ wallet: input.walletAddress })
  if (input.projectId) params.set('projectId', input.projectId)
  if (input.limit != null) params.set('limit', String(input.limit))

  const response = await fetch(`/api/director-sessions?${params.toString()}`, {
    headers: authHeaders(input),
  })
  if (!response.ok) return []

  const data = (await response.json()) as { sessions?: DirectorPastSession[] }
  return Array.isArray(data.sessions) ? data.sessions : []
}

export async function fetchDirectorSessionTranscript(
  input: DirectorSessionsAuth & { sessionId: string },
): Promise<DirectorSessionTranscript> {
  const params = new URLSearchParams({ wallet: input.walletAddress, sessionId: input.sessionId })
  const response = await fetch(`/api/director-sessions?${params.toString()}`, {
    headers: authHeaders(input),
  })
  if (!response.ok) {
    throw new Error(
      response.status === 404 ? 'That brief is no longer available.' : 'Could not open that brief.',
    )
  }
  const data = (await response.json()) as { transcript?: DirectorSessionTranscript }
  if (!data.transcript) throw new Error('Could not open that brief.')
  return data.transcript
}

export async function deleteDirectorPastSession(
  input: DirectorSessionsAuth & { sessionId: string },
): Promise<void> {
  const params = new URLSearchParams({ wallet: input.walletAddress, sessionId: input.sessionId })
  const response = await fetch(`/api/director-sessions?${params.toString()}`, {
    method: 'DELETE',
    headers: authHeaders(input),
  })
  // 404 means it is already gone — treat as success.
  if (!response.ok && response.status !== 404) {
    throw new Error('Could not delete that brief.')
  }
}
