import type { LiveStyleTransportConnectInfo } from '../transport'

export interface LiveStyleProviderCreateParams {
  sessionId: string
  prompt?: string
  stylePreset?: string
}

export interface LiveStyleProviderSession {
  providerSessionId: string
  connect: LiveStyleTransportConnectInfo
}

export interface LiveStyleProviderStatus {
  alive: boolean
  /** Provider-reported seconds (optional); broker uses server clock for billing. */
  seconds?: number
}

export interface LiveStyleProviderAdapter {
  readonly id: string
  create(params: LiveStyleProviderCreateParams): Promise<LiveStyleProviderSession>
  update(providerSessionId: string, params: { prompt?: string }): Promise<void>
  end(providerSessionId: string): Promise<void>
  status(providerSessionId: string): Promise<LiveStyleProviderStatus>
}
