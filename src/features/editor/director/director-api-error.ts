/**
 * Turn a Director API failure into text safe to render.
 * Vercel invocation failures use `{ error: { code, message } }`. Rendering that
 * object as a React child throws minified error #31 and hides the real failure.
 */

function textField(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function directorFailureMessage(status: number, body: unknown): string {
  const fallback = `Director request failed (${status})`
  if (!body || typeof body !== 'object') return fallback

  const record = body as Record<string, unknown>
  const errorText = textField(record.error)
  if (errorText) return errorText

  if (record.error && typeof record.error === 'object') {
    const nested = record.error as Record<string, unknown>
    const code = textField(nested.code)
    if (code === 'FUNCTION_INVOCATION_FAILED') {
      return 'Director crashed before streaming. If you were charged, retry once — contact support if payment is rejected as already used.'
    }
    const nestedMessage = textField(nested.message)
    if (nestedMessage && nestedMessage !== 'A server error has occurred') {
      return nestedMessage
    }
    if (nestedMessage) {
      return 'Director crashed before streaming. If you were charged, retry once — contact support if payment is rejected as already used.'
    }
    if (code) return `${fallback}: ${code}`
  }

  return textField(record.message) ?? fallback
}
