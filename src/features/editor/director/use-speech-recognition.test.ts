import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vite-plus/test'
import { useSpeechRecognition } from './use-speech-recognition'

describe('useSpeechRecognition', () => {
  let activeMockInstance: {
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    abort: ReturnType<typeof vi.fn>
    onresult: ((e: unknown) => void) | null
    onerror: ((e: unknown) => void) | null
    onend: (() => void) | null
    continuous: boolean
    interimResults: boolean
    lang: string
  } | null = null

  beforeEach(() => {
    class MockSpeechRecognition {
      start = vi.fn()
      stop = vi.fn()
      abort = vi.fn()
      onresult = null
      onerror = null
      onend = null
      continuous = false
      interimResults = false
      lang = ''
      constructor() {
        activeMockInstance = this
      }
    }

    Object.defineProperty(window, 'SpeechRecognition', {
      value: MockSpeechRecognition,
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    activeMockInstance = null
  })

  it('detects browser support and starts listening', () => {
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useSpeechRecognition({ onTranscript }))

    expect(result.current.isSupported).toBe(true)
    expect(result.current.isListening).toBe(false)

    act(() => {
      result.current.startListening()
    })

    expect(activeMockInstance?.start).toHaveBeenCalled()
    expect(result.current.isListening).toBe(true)
  })

  it('dispatches transcript on speech recognition result', () => {
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useSpeechRecognition({ onTranscript }))

    act(() => {
      result.current.startListening()
    })

    act(() => {
      activeMockInstance?.onresult?.({
        resultIndex: 0,
        results: [
          {
            isFinal: true,
            length: 1,
            0: { transcript: 'Create a synthwave storyboard' },
          },
        ],
      })
    })

    expect(onTranscript).toHaveBeenCalledWith('Create a synthwave storyboard')
  })

  it('stops listening when toggleListening is called while active', () => {
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useSpeechRecognition({ onTranscript }))

    act(() => {
      result.current.startListening()
    })
    expect(result.current.isListening).toBe(true)

    act(() => {
      result.current.toggleListening()
    })
    expect(activeMockInstance?.stop).toHaveBeenCalled()
    expect(result.current.isListening).toBe(false)
  })
})
