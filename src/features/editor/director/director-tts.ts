/**
 * Utility for local browser-based Text-to-Speech (TTS) using SpeechSynthesis.
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

export function speakText(
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
  if (isSpeechSynthesisSupported()) {
    window.speechSynthesis.cancel()
  }
}
