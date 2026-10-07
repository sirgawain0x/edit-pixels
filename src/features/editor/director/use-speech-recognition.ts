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

interface UseSpeechRecognitionOptions {
  onTranscript: (transcript: string) => void
  onError?: (error: string) => void
}

export function useSpeechRecognition({ onTranscript, onError }: UseSpeechRecognitionOptions) {
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onTranscriptRef.current = onTranscript
    onErrorRef.current = onError
  }, [onTranscript, onError])

  const isSupported = Boolean(getSpeechRecognitionConstructor())

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
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

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort()
      } catch {
        // ignore
      }
    }

    try {
      const recognition = new Ctor()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US'

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        const transcript = extractTranscriptFromEvent(event)
        if (transcript) {
          onTranscriptRef.current(transcript)
        }
      }

      recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
        if (event.error === 'not-allowed') {
          onErrorRef.current?.('Microphone access was denied. Please allow microphone access.')
        } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
          onErrorRef.current?.(`Speech recognition error: ${event.error}`)
        }
        setIsListening(false)
      }

      recognition.onend = () => {
        setIsListening(false)
      }

      recognition.start()
      recognitionRef.current = recognition
      setIsListening(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start speech recognition'
      onErrorRef.current?.(message)
      setIsListening(false)
    }
  }, [])

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening()
    } else {
      startListening()
    }
  }, [isListening, startListening, stopListening])

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort()
        } catch {
          // ignore
        }
      }
    }
  }, [])

  return {
    isSupported,
    isListening,
    startListening,
    stopListening,
    toggleListening,
  }
}
