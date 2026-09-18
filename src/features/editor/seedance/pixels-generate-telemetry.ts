import { createLogger, createOperationId } from '@/shared/logging/logger'
import type { PixelsRenderProvider } from '@/config/pixels-render'

const log = createLogger('PixelsGenerate')

export interface PixelsGenerateTelemetryContext {
  provider: PixelsRenderProvider
  durationSec: number
  costUsdc6: number
  resolution?: string
}

export function startPixelsGenerateEvent(ctx: PixelsGenerateTelemetryContext) {
  const event = log.startEvent('pixels_generate', createOperationId())
  event.merge({
    provider: ctx.provider,
    duration_sec: ctx.durationSec,
    cost_usdc6: ctx.costUsdc6,
    ...(ctx.resolution ? { resolution: ctx.resolution } : {}),
  })
  return event
}

export function mapPixelsGenerateError(error: unknown): {
  code: string
  message: string
} {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { code: 'user_cancelled', message: 'Generation cancelled' }
  }

  const message = error instanceof Error ? error.message : 'Generation failed'

  if (message.includes('insufficient_crtvai') || message.toLowerCase().includes('insufficient')) {
    return { code: 'insufficient_crtvai', message: 'Insufficient CRTVAI for this generation.' }
  }
  if (message.includes('payment_required') || message.includes('Payment')) {
    return { code: 'payment_required', message: 'Payment is required before generating.' }
  }
  if (message.includes('quote_mismatch')) {
    return { code: 'quote_mismatch', message: 'Quote expired — re-plan and pick a provider again.' }
  }

  return { code: 'provider_failed', message }
}
