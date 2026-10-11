import type { LiveStyleTransportAdapter, LiveStyleTransportConnectInfo } from '@/features/live-style/lib/transport'

/** Binary WebSocket frame transport (default for Cloud Run GPU path). */
export class WebSocketFrameTransport implements LiveStyleTransportAdapter {
  readonly kind = 'websocket' as const
  private ws: WebSocket | null = null
  private handler: ((bytes: ArrayBuffer) => void) | null = null

  async connect(info: LiveStyleTransportConnectInfo): Promise<void> {
    const url = info.websocketUrl
    if (!url || url.startsWith('mock://')) {
      throw new Error('WebSocket URL not configured')
    }
    this.ws = new WebSocket(url)
    this.ws.binaryType = 'arraybuffer'
    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error('ws missing'))
      this.ws.onopen = () => resolve()
      this.ws.onerror = () => reject(new Error('websocket failed'))
    })
    this.ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) this.handler?.(ev.data)
    }
  }

  async sendFrame(bytes: ArrayBuffer): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('websocket not open')
    }
    this.ws.send(bytes)
  }

  onFrame(handler: (bytes: ArrayBuffer) => void): void {
    this.handler = handler
  }

  async close(): Promise<void> {
    this.ws?.close()
    this.ws = null
    this.handler = null
  }
}
