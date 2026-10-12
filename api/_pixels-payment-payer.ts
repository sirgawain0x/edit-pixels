/// <reference types="node" />
/**
 * Bind on-chain CRTVAI payer to the Privy-verified signer (EOA or derived Alchemy smart account).
 */
import type { Address } from 'viem'
import { resolvePixelsSmartAccountForSigner } from './_pixels-smart-account.js'

export async function assertPaymentPayerMatchesSigner(
  payerAddress: string,
  verifiedSignerAddress: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const payer = payerAddress.trim().toLowerCase()
  const signer = verifiedSignerAddress.trim().toLowerCase()
  if (!payer.startsWith('0x') || payer.length < 42) {
    return { ok: false, reason: 'Invalid payer wallet address' }
  }
  if (!signer.startsWith('0x') || signer.length < 42) {
    return { ok: false, reason: 'Invalid verified signer address' }
  }

  if (payer === signer) {
    return { ok: true }
  }

  const smartAccount = await resolvePixelsSmartAccountForSigner(signer as Address)
  if (!smartAccount) {
    return {
      ok: false,
      reason: 'Unable to resolve smart account for the authenticated wallet',
    }
  }
  if (payer === smartAccount.toLowerCase()) {
    return { ok: true }
  }

  return {
    ok: false,
    reason: 'Payment payer is not linked to the authenticated wallet',
  }
}
