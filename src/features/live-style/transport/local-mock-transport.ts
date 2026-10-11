import type { LiveStyleTransportAdapter, LiveStyleTransportConnectInfo } from '@/features/live-style/lib/transport'

/**
 * Client-side mock transport — inverts green channel for visible "styled" output.
 */
export class LocalMockEchoTransport implements LiveStyleTransportAdapter {
  readonly kind = 'websocket' as const
  private handler: ((bytes: ArrayBuffer) => void) | null = null

  async connect(_info: LiveStyleTransportConnectInfo): Promise<void> {}

  async sendFrame(bytes: ArrayBuffer): Promise<void> {
    const out = bytes.slice(0)
    const view = new Uint8Array(out)
    for (let i = 0; i < view.length; i += 4) {
      if (i + 2 < view.length) {
        const g = view[i + 1] ?? 0
        view[i + 1] = 255 - g
      }
    }
    this.handler?.(out)
  }

  onFrame(handler: (bytes: ArrayBuffer) => void): void {
    this.handler = handler
  }

  async close(): Promise<void> {
    this.handler = null
  }
}
