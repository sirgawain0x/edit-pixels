import { useCallback, useEffect, useRef, useState } from 'react'

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: {
    length: number
    [index: number]: {
      isFinal?: boolean
      length: number
      [index: number]: {
        transcript: string
      }
    }
  }
}

interface SpeechRecognitionErrorEventLike {
  error: string
  message?: string
}

interface SpeechRecognitionInstance {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return win.SpeechRecognition || win.webkitSpeechRecognition || null
}

function extractTranscriptFromEvent(event: SpeechRecognitionEventLike): string {
  let transcript = ''
  for (let i = 0; i < event.results.length; i++) {
    const item = event.results[i]
    if (item?.[0]?.transcript) {
      transcript += item[0].transcript
    }
  }
  return transcript
}

function clearRecognitionHandlers(recognition: SpeechRecognitionInstance): void {
  recognition.onresult = null
  recognition.onerror = null
  recognition.onend = null
}

interface UseSpeechRecognitionOptions {
  onTranscript: (transcript: string) => void
  onError?: (error: string) => void
}

export function useSpeechRecognition({ onTranscript, onError }: UseSpeechRecognitionOptions) {
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  const onErrorRef = useRef(onError)
  const listeningIntentRef = useRef(false)
  const sessionIdRef = useRef(0)

  useEffect(() => {
    onTranscriptRef.current = onTranscript
    onErrorRef.current = onError
  }, [onTranscript, onError])

  const isSupported = Boolean(getSpeechRecognitionConstructor())

  const disposeRecognition = useCallback((recognition: SpeechRecognitionInstance) => {
    clearRecognitionHandlers(recognition)
    try {
      recognition.abort()
    } catch {
      // ignore abort errors
    }
  }, [])

  const stopListening = useCallback(() => {
    listeningIntentRef.current = false
    sessionIdRef.current += 1
    if (recognitionRef.current) {
      const recognition = recognitionRef.current
      clearRecognitionHandlers(recognition)
      try {
        recognition.stop()
      } catch {
        // ignore stop errors
      }
      recognitionRef.current = null
    }
    setIsListening(false)
  }, [])

  // fallow-ignore-next-line complexity
  const startListening = useCallback(() => {
    const Ctor = getSpeechRecognitionConstructor()
    if (!Ctor) {
      onErrorRef.current?.('Speech recognition is not supported in this browser.')
      return
    }

    listeningIntentRef.current = true

    if (recognitionRef.current) {
      sessionIdRef.current += 1
      disposeRecognition(recognitionRef.current)
      recognitionRef.current = null
    }

    const sessionId = sessionIdRef.current + 1
    sessionIdRef.current = sessionId

    try {
      const recognition = new Ctor()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US'

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        if (sessionId !== sessionIdRef.current) return
        const transcript = extractTranscriptFromEvent(event)
        if (transcript) {
          onTranscriptRef.current(transcript)
        }
      }

      recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
        if (sessionId !== sessionIdRef.current) return
        if (event.error === 'not-allowed') {
          onErrorRef.current?.('Microphone access was denied. Please allow microphone access.')
          listeningIntentRef.current = false
          setIsListening(false)
        } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
          onErrorRef.current?.(`Speech recognition error: ${event.error}`)
          listeningIntentRef.current = false
          setIsListening(false)
        }
      }

      recognition.onend = () => {
        if (sessionId !== sessionIdRef.current) return
        if (!listeningIntentRef.current) {
          setIsListening(false)
          if (recognitionRef.current === recognition) {
            recognitionRef.current = null
          }
          return
        }
        try {
          recognition.start()
        } catch {
          if (sessionId !== sessionIdRef.current || !listeningIntentRef.current) return
          onErrorRef.current?.('Speech recognition ended unexpectedly.')
          listeningIntentRef.current = false
          setIsListening(false)
          recognitionRef.current = null
        }
      }

      recognition.start()
      recognitionRef.current = recognition
      setIsListening(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start speech recognition'
      onErrorRef.current?.(message)
      listeningIntentRef.current = false
      setIsListening(false)
    }
  }, [disposeRecognition])

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening()
    } else {
      startListening()
    }
  }, [isListening, startListening, stopListening])

  useEffect(() => {
    return () => {
      listeningIntentRef.current = false
      sessionIdRef.current += 1
      if (recognitionRef.current) {
        disposeRecognition(recognitionRef.current)
        recognitionRef.current = null
      }
    }
  }, [disposeRecognition])

  return {
    isSupported,
    isListening,
    startListening,
    stopListening,
    toggleListening,
  }
}
