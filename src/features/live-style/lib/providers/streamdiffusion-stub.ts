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
      sessions.set(params.sessionId, { alive: true })
      return {
        providerSessionId: params.sessionId,
        connect: {
          kind: 'websocket',
          websocketUrl: `${base}/ws?style=${encodeURIComponent(params.stylePreset ?? 'default')}`,
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
