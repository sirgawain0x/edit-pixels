import { verifyLiveStyleWsSessionToken } from '../ws-session-token'
import type {
  LiveStyleProviderAdapter,
  LiveStyleProviderCreateParams,
  LiveStyleProviderSession,
  LiveStyleProviderStatus,
} from './types'

/**
 * Stub adapter — targets LIVE_STYLE_PROVIDER_URL when configured (G2: GPU host).
 * Does not call the network in this build.
 */
export function createStreamDiffusionStubProvider(providerUrl: string | undefined): LiveStyleProviderAdapter {
  const base = providerUrl?.replace(/\/$/, '') ?? 'https://LIVE_STYLE_PROVIDER_URL'
  const sessions = new Map<string, { alive: boolean }>()

  return {
    id: 'streamdiffusion',
    async create(params: LiveStyleProviderCreateParams): Promise<LiveStyleProviderSession> {
      if (!params.wsToken) {
        throw new Error('live_style_ws_token_required')
      }
      if (params.wsTokenSecret) {
        const verified = verifyLiveStyleWsSessionToken(params.wsToken, params.wsTokenSecret)
        if (!verified.ok) {
          throw new Error(verified.reason)
        }
        if (verified.payload.sessionId !== params.sessionId) {
          throw new Error('ws_token_session_mismatch')
        }
      }

      sessions.set(params.sessionId, { alive: true })
      const style = encodeURIComponent(params.stylePreset ?? 'default')
      const token = encodeURIComponent(params.wsToken)
      return {
        providerSessionId: params.sessionId,
        connect: {
          kind: 'websocket',
          websocketUrl: `${base}/ws?style=${style}&token=${token}`,
        },
      }
    },
    async update(): Promise<void> {},
    async end(providerSessionId: string): Promise<void> {
      sessions.delete(providerSessionId)
    },
    async status(providerSessionId: string): Promise<LiveStyleProviderStatus> {
      return { alive: sessions.has(providerSessionId) }
    },
  }
}
