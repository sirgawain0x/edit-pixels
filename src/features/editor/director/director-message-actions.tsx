import { memo, useCallback, useEffect, useState } from 'react'
import { Check, Copy, Volume2, VolumeX } from 'lucide-react'
import { toast } from 'sonner'
import { speakText, stopSpeech, isSpeechSynthesisSupported } from './director-tts'
import { cn } from '@/shared/ui/cn'

interface DirectorMessageActionsProps {
  text: string
  className?: string
}

export const DirectorMessageActions = memo(function DirectorMessageActions({
  text,
  className,
}: DirectorMessageActionsProps) {
  const [copied, setCopied] = useState(false)
  const [speaking, setSpeaking] = useState(false)

  useEffect(() => {
    return () => {
      if (speaking) {
        stopSpeech()
      }
    }
  }, [speaking])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success('Response copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Failed to copy to clipboard')
    }
  }, [text])

  const handleToggleSpeech = useCallback(() => {
    if (!isSpeechSynthesisSupported()) {
      toast.error('Text-to-speech is not supported in this browser.')
      return
    }

    if (speaking) {
      stopSpeech()
      setSpeaking(false)
      return
    }

    speakText(text, {
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    })
  }, [speaking, text])

  return (
    <div className={cn('mt-2 flex items-center gap-1 text-muted-foreground', className)}>
      <button
        type="button"
        onClick={handleToggleSpeech}
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-secondary/60 hover:text-foreground',
          speaking && 'bg-primary/15 text-primary',
        )}
        title={speaking ? 'Stop speaking' : 'Read aloud with local TTS'}
        aria-label={speaking ? 'Stop speech' : 'Read aloud'}
      >
        {speaking ? (
          <VolumeX className="h-3.5 w-3.5 animate-pulse" />
        ) : (
          <Volume2 className="h-3.5 w-3.5" />
        )}
      </button>

      <button
        type="button"
        onClick={() => void handleCopy()}
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-secondary/60 hover:text-foreground',
          copied && 'text-emerald-400',
        )}
        title={copied ? 'Copied' : 'Copy response'}
        aria-label={copied ? 'Copied' : 'Copy response'}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  )
})
