import { describe, expect, it } from 'vitest'
import { signLiveStyleWsToken } from '../ws-session-token'
import { createStreamDiffusionStubProvider } from './streamdiffusion-stub'

const SECRET = 'stub-secret'

describe('streamdiffusion stub ws token', () => {
  it('requires token and verifies with secret', async () => {
    const provider = createStreamDiffusionStubProvider('wss://gpu.example')
    const sessionId = 'ls_test'
    const token = signLiveStyleWsToken(
      { sessionId, wallet: '0xabc', expMs: Date.now() + 60_000 },
      SECRET,
    )
    const session = await provider.create({
      sessionId,
      wsToken: token,
      wsTokenSecret: SECRET,
    })
    expect(session.connect.websocketUrl).toContain('token=')
    expect(session.connect.websocketUrl).not.toContain(SECRET)
  })

  it('rejects invalid token when secret provided', async () => {
    const provider = createStreamDiffusionStubProvider('wss://gpu.example')
    await expect(
      provider.create({
        sessionId: 'ls_bad',
        wsToken: 'bad.token',
        wsTokenSecret: SECRET,
      }),
    ).rejects.toThrow()
  })
})
