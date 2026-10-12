/// <reference types="node" />
/**
 * Bind on-chain CRTVAI payer to the Privy-verified signer (EOA or predicted Alchemy SMA).
 */
import type { Address } from 'viem'
import { getAddress } from 'viem'
import { predictPixelsSmartAccountForSigner } from './_pixels-smart-account.js'

export function assertPaymentPayerMatchesSigner(
  payerAddress: string,
  verifiedSignerAddress: string,
): { ok: true } | { ok: false; reason: string } {
  const payer = getAddress(payerAddress)
  const signer = getAddress(verifiedSignerAddress)

  if (payer === signer) {
    return { ok: true }
  }

  const smartAccount = predictPixelsSmartAccountForSigner(signer)
  if (payer === smartAccount) {
    return { ok: true }
  }

  return {
    ok: false,
    reason: 'Payment payer is not linked to the authenticated wallet',
  }
}
