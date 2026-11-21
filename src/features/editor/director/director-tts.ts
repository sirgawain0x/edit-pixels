/**
 * Director read-aloud: Gemini TTS via `/api/director-tts` (natural voice), with
 * browser `speechSynthesis` as a fallback.
 */

export function cleanMarkdownForSpeech(text: string): string {
  if (!text) return ''
  return (
    text
      // Remove markdown code blocks
      .replace(/```[\s\S]*?```/g, '')
      // Remove images before links (![alt](url))
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      // Remove links [text](url) -> text
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // Remove markdown table separator lines like | --- | :---: |
      .replace(/^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$/gm, '')
      // Strip leading and trailing table pipes on each line
      .replace(/^\s*\|/gm, '')
      .replace(/\|\s*$/gm, '')
      // Replace remaining inner table cell pipes with comma space
      .replace(/\|/g, ', ')
      // Remove inline code ticks
      .replace(/`([^`]+)`/g, '$1')
      // Remove headings (#, ##, ###, etc.)
      .replace(/^#{1,6}\s+/gm, '')
      // Remove horizontal rules (---, ***, ___)
      .replace(/^(?:[-*_]\s*){3,}$/gm, '')
      // Remove bold and italic markers (***, **, *, __, _)
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      // Remove bullet points (*, -, +)
      .replace(/^\s*[-*+]\s+/gm, '')
      // Remove numbered lists (1., 2., etc.)
      .replace(/^\s*\d+\.\s+/gm, '')
      // Remove blockquotes (>)
      .replace(/^\s*>\s+/gm, '')
      // Clean up multiple commas, whitespace, and line breaks
      .replace(/,\s*,+/g, ', ')
      .replace(/[ \t]+/g, ' ')
      .replace(/^\s*,\s*/gm, '')
      .replace(/,\s*$/gm, '')
      .replace(/\n\s*\n/g, '\n')
      .trim()
  )
}

export function isSpeechSynthesisSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    'SpeechSynthesisUtterance' in window
  )
}

function speakText(
  text: string,
  callbacks?: {
    onStart?: () => void
    onEnd?: () => void
    onError?: (error: unknown) => void
  },
): (() => void) | null {
  if (!isSpeechSynthesisSupported()) {
    callbacks?.onError?.(new Error('SpeechSynthesis is not supported in this browser'))
    return null
  }

  const cleanText = cleanMarkdownForSpeech(text)
  if (!cleanText) {
    callbacks?.onEnd?.()
    return null
  }

  // Cancel any existing playback
  window.speechSynthesis.cancel()

  const utterance = new SpeechSynthesisUtterance(cleanText)
  utterance.lang = navigator.language || 'en-US'
  utterance.rate = 1.0
  utterance.pitch = 1.0

  utterance.onstart = () => {
    callbacks?.onStart?.()
  }

  utterance.onend = () => {
    callbacks?.onEnd?.()
  }

  utterance.onerror = (event) => {
    // Interrupted by cancel() is not a user error
    if (event.error !== 'interrupted' && event.error !== 'canceled') {
      callbacks?.onError?.(event)
    }
    callbacks?.onEnd?.()
  }

  window.speechSynthesis.speak(utterance)

  return () => {
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      window.speechSynthesis.cancel()
    }
  }
}

export function stopSpeech(): void {
  cancelActiveGeminiSession()
  if (isSpeechSynthesisSupported()) {
    window.speechSynthesis.cancel()
  }
}

// ---------------------------------------------------------------------------
// Gemini TTS (server: POST /api/director-tts) with browser-speech fallback
// ---------------------------------------------------------------------------

export interface DirectorTtsAuth {
  token: string
  signerAddress?: string | null
}

/** Per-request chunk size — keeps first audio fast and stays under the server cap (2,000). */
const DIRECTOR_TTS_CHUNK_CHARS = 1_200
/** Cost guard: longest reply we will narrate with Gemini in one click. */
const DIRECTOR_TTS_MAX_CHUNKS = 15

/** Split cleaned speech text into ≤`maxChars` chunks on line / sentence / word boundaries. */
export function splitTextForSpeech(text: string, maxChars = DIRECTOR_TTS_CHUNK_CHARS): string[] {
  const chunks: string[] = []
  let current = ''
  const push = () => {
    const trimmed = current.trim()
    if (trimmed) chunks.push(trimmed)
    current = ''
  }
  const sentences = text
    .split(/\n+/)
    .flatMap((line) => line.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [line])
    .map((s) => s.trim())
    .filter(Boolean)

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      push()
      let rest = sentence
      while (rest.length > maxChars) {
        const cut = rest.lastIndexOf(' ', maxChars)
        const at = cut > maxChars / 2 ? cut : maxChars
        chunks.push(rest.slice(0, at).trim())
        rest = rest.slice(at).trim()
      }
      current = rest
      continue
    }
    if (current.length + sentence.length + 1 > maxChars) push()
    current = current ? `${current} ${sentence}` : sentence
  }
  push()
  return chunks
}

interface GeminiSession {
  cancelled: boolean
  audio: HTMLAudioElement | null
  controllers: Set<AbortController>
  objectUrls: string[]
  /** Notifies the owning button when another message (or stop) cancels this session. */
  onCancel?: () => void
}

let activeGeminiSession: GeminiSession | null = null

function cancelActiveGeminiSession(): void {
  const session = activeGeminiSession
  if (!session) return
  activeGeminiSession = null
  session.cancelled = true
  for (const controller of session.controllers) controller.abort()
  session.controllers.clear()
  if (session.audio) {
    session.audio.onended = null
    session.audio.onerror = null
    session.audio.pause()
    session.audio = null
  }
  for (const url of session.objectUrls) URL.revokeObjectURL(url)
  session.objectUrls = []
  const onCancel = session.onCancel
  session.onCancel = undefined
  onCancel?.()
}

async function fetchGeminiChunk(
  session: GeminiSession,
  auth: DirectorTtsAuth,
  text: string,
): Promise<Blob> {
  const controller = new AbortController()
  session.controllers.add(controller)
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`,
    }
    if (auth.signerAddress) headers['x-pixels-signer'] = auth.signerAddress
    const response = await fetch('/api/director-tts', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text }),
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`director-tts ${response.status}`)
    }
    return await response.blob()
  } finally {
    session.controllers.delete(controller)
  }
}

function playBlob(session: GeminiSession, blob: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    session.objectUrls.push(url)
    const audio = new Audio(url)
    session.audio = audio
    audio.onended = () => resolve()
    audio.onerror = () => reject(new Error('audio playback failed'))
    audio.play().catch(reject)
  })
}

/**
 * Read a Director reply aloud with Gemini TTS (natural voice). Falls back to the
 * browser `speechSynthesis` voice when unauthenticated, unconfigured, or on error
 * before any Gemini audio has played. Returns a stop function.
 */
export function speakDirectorText(
  text: string,
  options: {
    getAuth?: () => Promise<DirectorTtsAuth | null>
    onStart?: () => void
    onEnd?: () => void
    onError?: (error: unknown) => void
  } = {},
): () => void {
  stopSpeech()

  const cleanText = cleanMarkdownForSpeech(text)
  if (!cleanText) {
    options.onEnd?.()
    return () => {}
  }

  const session: GeminiSession = {
    cancelled: false,
    audio: null,
    controllers: new Set(),
    objectUrls: [],
    onCancel: options.onEnd,
  }
  activeGeminiSession = session

  const fallback = () => {
    if (session.cancelled) return
    session.onCancel = undefined
    if (activeGeminiSession === session) activeGeminiSession = null
    speakText(cleanText, options)
  }

  void (async () => {
    const auth = options.getAuth ? await options.getAuth().catch(() => null) : null
    if (session.cancelled) return
    if (!auth?.token) {
      fallback()
      return
    }

    const chunks = splitTextForSpeech(cleanText).slice(0, DIRECTOR_TTS_MAX_CHUNKS)
    let started = false
    try {
      let next: Promise<Blob> | null = fetchGeminiChunk(session, auth, chunks[0] ?? '')
      for (let i = 0; i < chunks.length; i++) {
        const blob: Blob = await (next as Promise<Blob>)
        if (session.cancelled) return
        // Prefetch the following chunk while this one plays.
        next = i + 1 < chunks.length ? fetchGeminiChunk(session, auth, chunks[i + 1] ?? '') : null
        next?.catch(() => {})
        if (!started) {
          started = true
          options.onStart?.()
        }
        await playBlob(session, blob)
        if (session.cancelled) return
      }
      session.onCancel = undefined
      if (activeGeminiSession === session) cancelActiveGeminiSession()
      options.onEnd?.()
    } catch (error) {
      if (session.cancelled) return
      session.onCancel = undefined
      if (!started) {
        if (activeGeminiSession === session) cancelActiveGeminiSession()
        session.cancelled = false
        fallback()
        return
      }
      if (activeGeminiSession === session) cancelActiveGeminiSession()
      options.onError?.(error)
      options.onEnd?.()
    }
  })()

  return () => {
    if (activeGeminiSession === session) cancelActiveGeminiSession()
    session.cancelled = true
    if (isSpeechSynthesisSupported()) window.speechSynthesis.cancel()
  }
}
