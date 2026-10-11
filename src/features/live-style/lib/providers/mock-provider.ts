import type {
  LiveStyleProviderAdapter,
  LiveStyleProviderCreateParams,
  LiveStyleProviderSession,
  LiveStyleProviderStatus,
} from './types'

const sessions = new Map<string, { alive: boolean }>()

/** In-process mock — connect info tells the client to use local echo transport. */
export const mockLiveStyleProvider: LiveStyleProviderAdapter = {
  id: 'mock',
  async create(params: LiveStyleProviderCreateParams): Promise<LiveStyleProviderSession> {
    sessions.set(params.sessionId, { alive: true })
    return {
      providerSessionId: params.sessionId,
      connect: {
        kind: 'websocket',
        websocketUrl: 'mock://local-echo',
      },
    }
  },
  async update(): Promise<void> {},
  async end(providerSessionId: string): Promise<void> {
    sessions.delete(providerSessionId)
  },
  async status(providerSessionId: string): Promise<LiveStyleProviderStatus> {
    const row = sessions.get(providerSessionId)
    return { alive: Boolean(row?.alive) }
  },
}
