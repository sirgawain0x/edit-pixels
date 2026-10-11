import type { LiveStyleProviderId } from '../config'
import { mockLiveStyleProvider } from './mock-provider'
import { createStreamDiffusionStubProvider } from './streamdiffusion-stub'
import type { LiveStyleProviderAdapter } from './types'

export function getLiveStyleProvider(
  id: LiveStyleProviderId,
  env: { providerUrl?: string },
): LiveStyleProviderAdapter {
  switch (id) {
    case 'mock':
    case 'local-echo':
      return mockLiveStyleProvider
    case 'streamdiffusion':
      return createStreamDiffusionStubProvider(env.providerUrl)
    default: {
      const _exhaustive: never = id
      return _exhaustive
    }
  }
}
