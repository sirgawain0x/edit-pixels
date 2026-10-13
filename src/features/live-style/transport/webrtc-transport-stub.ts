import type { LiveStyleTransportAdapter, LiveStyleTransportConnectInfo } from '@/features/live-style/lib/transport'

/** Optional WebRTC adapter — not used when ingress is HTTP-only (e.g. Cloud Run). */
export class WebRtcTransportStub implements LiveStyleTransportAdapter {
  readonly kind = 'webrtc' as const

  async connect(info: LiveStyleTransportConnectInfo): Promise<void> {
    if (!info.webrtc?.whipUrl) {
      throw new Error('WebRTC connect info missing')
    }
    throw new Error('WebRTC adapter not enabled in this build')
  }

  async sendFrame(): Promise<void> {
    throw new Error('WebRTC adapter not enabled')
  }

  onFrame(): void {}

  async close(): Promise<void> {}
}
