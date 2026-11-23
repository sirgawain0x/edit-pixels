/**
 * Fill the Precision payment slot with the app's wallet.
 *
 * Mounted once, where the wallet already is. Everything downstream — the media library, the
 * transcript panel, and the two timeline utilities that start a transcription with no options
 * at all — then pays through this, without any of them learning about the wallet.
 */
import { useEffect } from 'react'
import { useSmartWalletOps } from '@/hooks/use-smart-wallet-ops'
import { buildCrtvaiTransferOp } from '@/shared/web3/build-metoken-payment-op'
import { registerPrecisionPayment } from '../lib/precision-payment'

export function usePrecisionPaymentBridge(): void {
  const { sendOps, ready } = useSmartWalletOps()

  useEffect(() => {
    // Registering before the wallet can send would swap one failure (unregistered) for a
    // worse one (a payment that throws mid-run, after the quote was already priced).
    if (!ready) return undefined

    return registerPrecisionPayment(async (quote) => {
      // The quote's minimum is the floor of a signed price: paying less than it is a run the
      // server will refuse, so send exactly what the server pinned.
      const { txHash } = await sendOps([buildCrtvaiTransferOp(BigInt(quote.minCrtvaiWei))])
      return txHash
    })
  }, [ready, sendOps])
}
