// fallow-ignore-file unused-export,complexity,code-duplication
import { verifyLiveStyleWsSessionToken } from '../ws-session-token.js'
import type {
  LiveStyleProviderAdapter,
  LiveStyleProviderCreateParams,
  LiveStyleProviderSession,
  LiveStyleProviderStatus,
} from './types.js'

const sessions = new Map<string, { alive: boolean }>()

/** In-process mock — connect info tells the client to use local echo transport. */
export const mockLiveStyleProvider: LiveStyleProviderAdapter = {
  id: 'mock',
  async create(params: LiveStyleProviderCreateParams): Promise<LiveStyleProviderSession> {
    if (params.wsToken && params.wsTokenSecret) {
      const verified = verifyLiveStyleWsSessionToken(params.wsToken, params.wsTokenSecret)
      if (!verified.ok) {
        throw new Error(verified.reason)
      }
    }
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
