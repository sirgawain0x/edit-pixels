/**
 * Cross-feature dependency contract: Live Style (flagged off by default).
 */
export { LiveStylePanel, isLiveStyleEnabledClient } from '@/features/live-style'
export { createLiveStyleSessionClient } from '@/features/live-style/api/live-style-client'
export { WebSocketFrameTransport } from '@/features/live-style/transport/ws-transport'
export { WebRtcTransportStub } from '@/features/live-style/transport/webrtc-transport-stub'
export {
  buildLiveStyleCapApprovalOps,
  preferredLiveStyleSpendAuthMethod,
} from '@/features/live-style/wallet/spend-authorization'
