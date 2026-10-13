// fallow-ignore-file unused-export,complexity,code-duplication
import type { LiveStyleProviderId } from '../config.js'
import { mockLiveStyleProvider } from './mock-provider.js'
import { createStreamDiffusionStubProvider } from './streamdiffusion-stub.js'
import type { LiveStyleProviderAdapter } from './types.js'

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
