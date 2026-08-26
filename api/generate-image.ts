/**
 * POST /api/generate-image — Gemini/Nanobanana stills with CRTVAI payment verify.
 */

import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js'
import { checkMetokenSufficient } from './_metoken-server.js'
import { evolinkServerPost, isEvolinkServerConfigured } from './_evolink-server.js'
import { isFlowBillingEnforced, quoteFlowCreditsUsdc6, verifyFlowPayment } from './flow-billing.js'

function quoteImageCredits(quality: string): number {
  const creditMap: Record<string, number> = {
    '0.5K': 5,
    '1K': 8,
    '2K': 12,
    '4K': 18,
  }
  return creditMap[quality] ?? 10
}

// fallow-ignore-next-line complexity
export async function POST(request: Request): Promise<Response> {
  if (!isEvolinkServerConfigured()) {
    return Response.json({ error: 'service unavailable' }, { status: 503 })
  }

  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return Response.json({ error: 'invalid body' }, { status: 400 })
    }
    body = parsed as Record<string, unknown>
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }

  const token = getBearerToken(request) || (typeof body.token === 'string' ? body.token : null)
  if (!token) {
    return Response.json({ error: 'missing authorization' }, { status: 401 })
  }

  const auth = await verifyPrivyAccessToken(
    token,
    typeof body.walletAddress === 'string' ? body.walletAddress : undefined,
  )
  if (!auth) {
    return Response.json({ error: 'invalid authorization' }, { status: 401 })
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) {
    return Response.json({ error: 'prompt required' }, { status: 400 })
  }

  const requestId =
    typeof body.requestId === 'string' && body.requestId.trim().length > 0
      ? body.requestId.trim()
      : null
  if (!requestId) {
    return Response.json({ error: 'requestId required' }, { status: 400 })
  }

  const quality = typeof body.quality === 'string' ? body.quality : '2K'
  const quote = quoteFlowCreditsUsdc6(quoteImageCredits(quality))
  if (!quote) {
    return Response.json({ error: 'invalid quote' }, { status: 400 })
  }

  if (isFlowBillingEnforced()) {
    const paymentTxHash = typeof body.paymentTxHash === 'string' ? body.paymentTxHash.trim() : ''
    if (!paymentTxHash) {
      return Response.json({ error: 'payment_required' }, { status: 402 })
    }
    const verified = await verifyFlowPayment({
      txHash: paymentTxHash,
      from: auth.address,
      minAmountWei: quote.minCrtvaiWei,
      purpose: 'generate-image',
    })
    if (!verified.ok) {
      return Response.json({ error: verified.reason }, { status: 402 })
    }
  } else {
    try {
      const balanceCheck = await checkMetokenSufficient(auth.address, quote.estimatedUsdc6)
      if (!balanceCheck.sufficient) {
        return Response.json(
          {
            error: 'insufficient_crtvai',
            balance: balanceCheck.balance.toString(),
            requiredMetoken: balanceCheck.requiredMetoken.toString(),
            costUsdc6: quote.estimatedUsdc6,
          },
          { status: 402 },
        )
      }
    } catch (e) {
      console.error('Failed to check meToken balance', e)
      return Response.json({ error: 'failed to verify balance' }, { status: 502 })
    }
  }

  try {
    const result = await evolinkServerPost<Record<string, unknown> & { id?: string }>(
      '/images/generations',
      {
        model: 'gemini-3.1-flash-image-preview',
        prompt,
        size: body.size ?? 'auto',
        quality,
        ...(Array.isArray(body.image_urls) && body.image_urls.length > 0
          ? { image_urls: body.image_urls }
          : {}),
      },
    )

    if (typeof result.id === 'string') {
      const { registerGenerativeTask } = await import('./_task-registry.js')
      await registerGenerativeTask(result.id, auth.address)
    }

    return Response.json({
      ...result,
      costUsdc6: quote.estimatedUsdc6,
      crtvaiRequired: quote.minCrtvaiWei.toString(),
    })
  } catch (e) {
    console.error('generate-image evolink error', e)
    return Response.json({ error: 'generation failed' }, { status: 502 })
  }
}
