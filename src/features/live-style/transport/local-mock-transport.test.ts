// @vitest-environment node
import { describe, expect, it } from 'vite-plus/test'
import { LocalMockEchoTransport } from './local-mock-transport'

describe('LocalMockEchoTransport', () => {
  it('echoes frames with a simple filter', async () => {
    const transport = new LocalMockEchoTransport()
    await transport.connect({ kind: 'websocket', websocketUrl: 'mock://local-echo' })
    const input = new Uint8Array([10, 100, 20, 30])
    let out: ArrayBuffer | null = null
    transport.onFrame((bytes) => {
      out = bytes
    })
    await transport.sendFrame(input.buffer)
    expect(out).not.toBeNull()
    const view = new Uint8Array(out!)
    expect(view[1]).toBe(155)
    await transport.close()
  })
})
