import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Info, Loader2, Send, Sparkles, Trash2, Wrench, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/shared/ui/cn'
import { useDirectorStore } from './director-store'

const SUGGESTIONS: { key: string; text: string }[] = [
  { key: 'storyboard', text: 'Storyboard a beat-synced music video for this track' },
  { key: 'mood', text: 'Research visual references for a dark synthwave mood' },
  { key: 'cuts', text: 'Propose cut points every 4 bars at 120 BPM' },
]

export const DirectorChatPanel = memo(function DirectorChatPanel() {
  const { t } = useTranslation()
  const messages = useDirectorStore((s) => s.messages)
  const phase = useDirectorStore((s) => s.phase)
  const streamingText = useDirectorStore((s) => s.streamingText)
  const toolCalls = useDirectorStore((s) => s.toolCalls)
  const submit = useDirectorStore((s) => s.submit)
  const cancel = useDirectorStore((s) => s.cancel)
  const clearChat = useDirectorStore((s) => s.clearChat)

  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const busy = phase !== 'idle'

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, phase, streamingText, toolCalls])

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      setInput('')
      void submit(trimmed)
    },
    [submit],
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        if (!busy) send(input)
      }
    },
    [busy, input, send],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && phase === 'idle' && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary/20 p-2.5">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('director.empty.intro', {
                  defaultValue:
                    'Creative Director plans beat-synced storyboards via Vertex Agent Engine. Traces stream live; timeline edits stay manual for now.',
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion.key}
                  type="button"
                  onClick={() => send(suggestion.text)}
                  className="rounded-full border border-border bg-secondary/30 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                >
                  {suggestion.text}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[85%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-xs leading-relaxed',
                message.role === 'user' && 'bg-primary text-primary-foreground',
                message.role === 'assistant' && 'bg-secondary/40 text-foreground',
                message.role === 'tool' &&
                  'flex items-center gap-1.5 border border-border bg-secondary/20 text-muted-foreground',
                message.role === 'error' &&
                  'border border-destructive/40 bg-destructive/10 text-destructive',
              )}
            >
              {message.role === 'tool' && <Wrench className="h-3 w-3 shrink-0" />}
              {message.content}
            </div>
          </div>
        ))}

        {phase === 'streaming' && streamingText && (
          <div className="flex justify-start">
            <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-secondary/40 px-2.5 py-1.5 text-xs leading-relaxed text-foreground">
              {streamingText}
            </div>
          </div>
        )}

        {phase === 'streaming' && !streamingText && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('director.status.thinking', { defaultValue: 'Director is planning…' })}
          </div>
        )}

        {toolCalls.some((call) => call.status === 'running') && (
          <div className="flex flex-wrap gap-1.5">
            {toolCalls
              .filter((call) => call.status === 'running')
              .map((call) => (
                <span
                  key={call.id}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/30 px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {call.name}
                </span>
              ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-2.5">
        <div className="flex items-end gap-1.5">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 shrink-0 text-muted-foreground"
                aria-label={t('director.empty.infoLabel', {
                  defaultValue: 'About Creative Director',
                })}
              >
                <Info className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" side="top" className="w-64 p-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('director.empty.about', {
                  defaultValue:
                    'Streams from the deployed Creative Director Reasoning Engine. Research and storyboards only — mock production tools are labeled as simulations.',
                })}
              </p>
            </PopoverContent>
          </Popover>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={t('director.composer.placeholder', {
              defaultValue: 'Ask the director to storyboard…',
            })}
            className="max-h-28 min-h-[2.25rem] flex-1 resize-none rounded-md border border-border bg-secondary/30 px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
          />
          {phase === 'streaming' ? (
            <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={cancel}>
              <X className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="h-9 w-9 shrink-0"
              disabled={busy || !input.trim()}
              onClick={() => send(input)}
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
        {messages.length > 0 && (
          <div className="mt-1.5 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
              onClick={clearChat}
              disabled={phase === 'streaming'}
            >
              <Trash2 className="h-3 w-3" />
              {t('director.clear', { defaultValue: 'Clear' })}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
})
