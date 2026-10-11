/**
 * Live Style frame transport — WebSocket default; WebRTC optional adapter.
 */

export type LiveStyleTransportKind = 'websocket' | 'webrtc'

export interface LiveStyleTransportConnectInfo {
  kind: LiveStyleTransportKind
  /** Provider WebSocket URL (binary JPEG/WebP frames). */
  websocketUrl?: string
  /** ICE / WHIP hints when using WebRTC adapter. */
  webrtc?: {
    whipUrl?: string
    playbackId?: string
    turnUrls?: string[]
  }
}

export interface LiveStyleTransportAdapter {
  readonly kind: LiveStyleTransportKind
  connect(info: LiveStyleTransportConnectInfo): Promise<void>
  sendFrame(bytes: ArrayBuffer): Promise<void>
  onFrame(handler: (bytes: ArrayBuffer) => void): void
  close(): Promise<void>
}

export interface LiveStyleFrameTransportFactory {
  create(kind: LiveStyleTransportKind): LiveStyleTransportAdapter
}
