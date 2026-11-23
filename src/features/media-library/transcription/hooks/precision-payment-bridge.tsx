/**
 * Mount point for the Precision payment bridge.
 *
 * Renders nothing. It exists so the registration effect has a stable home inside the wallet
 * provider: the media library, the transcript panel, and the two timeline utilities that start
 * a transcription all reach the same slot, and none of them has a wallet in scope.
 */
import { usePrecisionPaymentBridge } from './use-precision-payment-bridge'

export function PrecisionPaymentBridge(): null {
  usePrecisionPaymentBridge()
  return null
}
