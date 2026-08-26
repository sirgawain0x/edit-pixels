import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Clapperboard, Loader2, Send, Square, Trash2, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/shared/ui/cn'
import { useWalletContext } from '@/context/wallet-context'
import { useCredits } from '@/features/editor/deps/credits-contract'
import {
  useItemsStore,
  useTimelineSettingsStore,
} from '@/features/editor/deps/timeline-store-contract'
import { useSmartWalletOps } from '@/hooks/use-smart-wallet-ops'
import { buildDirectorPaymentOp, getDirectorTreasuryAddress } from './build-director-payment'
import { quoteDirectorBrief, type DirectorQuote } from './director-pricing'
import { useDirectorStore } from './director-store'
import {
  buildDirectorTimelineAudioContext,
  formatTimelineAudioForPrompt,
  publicAudioUriForDirector,
} from './timeline-audio'

const SUGGESTIONS: { key: string; text: string; label: string }[] = [
  {
    key: 'storyboard',
    label: 'Storyboard',
    text: 'Storyboard a beat-synced music video for this track',
  },
  {
    key: 'mood',
    label: 'Mood board',
    text: 'Research visual references for a dark synthwave mood',
  },
  {
    key: 'cuts',
    label: 'Cut points',
    text: 'Propose cut points every 4 bars at 120 BPM',
  },
]

interface PendingInvoice {
  brief: string
  apiPrompt: string
  audioUri?: string
  quote: DirectorQuote
}

function statusLabel(
  phase: string,
  streamingText: string,
  runningTools: number,
  paying: boolean,
  t: (key: string, opts?: { defaultValue: string }) => string,
): string {
  if (paying) {
    return t('director.status.paying', { defaultValue: 'Paying' })
  }
  if (phase === 'streaming' && runningTools > 0) {
    return t('director.status.working', { defaultValue: 'Working' })
  }
  if (phase === 'streaming' && streamingText) {
    return t('director.status.writing', { defaultValue: 'Writing' })
  }
  if (phase === 'streaming') {
    return t('director.status.thinking', { defaultValue: 'Thinking' })
  }
  return t('director.status.ready', { defaultValue: 'Ready' })
}

function AgentMark({ variant = 'agent' }: { variant?: 'agent' | 'tool' | 'error' | 'busy' }) {
  return (
    <div
      className={cn(
        'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
        variant === 'error' && 'border-destructive/40 bg-destructive/10 text-destructive',
        variant === 'tool' && 'border-border bg-secondary/40 text-muted-foreground',
        (variant === 'agent' || variant === 'busy') &&
          'border-primary/30 bg-primary/10 text-primary',
      )}
    >
      {variant === 'tool' ? (
        <Wrench className="h-3 w-3" />
      ) : variant === 'busy' ? (
        <Loader2 className="h-3 w-3 animate-spin text-primary" />
      ) : (
        <Clapperboard className="h-3 w-3" strokeWidth={1.75} />
      )}
    </div>
  )
}

function DirectorMessage({
  role,
  content,
}: {
  role: 'user' | 'assistant' | 'tool' | 'error'
  content: string
}) {
  if (role === 'user') {
    return (
      <div className="flex justify-end gap-2.5">
        <div className="max-w-[88%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap text-primary-foreground">
          {content}
        </div>
      </div>
    )
  }

  const markVariant = role === 'tool' ? 'tool' : role === 'error' ? 'error' : 'agent'

  return (
    <div className="flex justify-start gap-2.5">
      <AgentMark variant={markVariant} />
      <div
        className={cn(
          'max-w-[88%] whitespace-pre-wrap text-[12px] leading-relaxed',
          role === 'assistant' && 'pt-0.5 text-foreground/95',
          role === 'tool' &&
            'rounded-md border border-border/80 bg-secondary/25 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground',
          role === 'error' &&
            'rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-destructive',
        )}
      >
        {content}
      </div>
    </div>
  )
}

function DirectorInvoiceCard({
  invoice,
  balance,
  canPayOnChain,
  paying,
  onConfirm,
  onCancel,
  t,
}: {
  invoice: PendingInvoice
  balance: number
  canPayOnChain: boolean
  paying: boolean
  onConfirm: () => void
  onCancel: () => void
  t: (key: string, opts?: { defaultValue: string; [key: string]: string | number }) => string
}) {
  const { quote } = invoice
  const insufficient = balance < quote.crtvaiDisplay

  return (
    <div className="rounded-xl border border-primary/35 bg-secondary/30 p-3.5">
      <p className="font-mono text-[10px] tracking-[0.18em] text-primary/85 uppercase">
        {t('director.invoice.eyebrow', { defaultValue: 'Invoice' })}
      </p>
      <h4 className="mt-1 text-[14px] font-semibold tracking-tight text-foreground">
        {t('director.invoice.title', { defaultValue: 'Confirm Director brief' })}
      </h4>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        {t('director.invoice.blurb', {
          defaultValue:
            'Charged in CRTVAI from your wallet before generation. Price is per minute of timeline audio.',
        })}
      </p>

      <dl className="mt-3 space-y-1.5 font-mono text-[11px]">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Audio</dt>
          <dd className="text-foreground">
            {quote.audioDurationSeconds.toFixed(1)}s · {quote.billableMinutes} min
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Rate</dt>
          <dd className="text-foreground">
            {(quote.usdc6PerMinute / 1_000_000).toFixed(2)} USD / min
          </dd>
        </div>
        <div className="flex justify-between gap-3 border-t border-border/60 pt-1.5">
          <dt className="text-muted-foreground">Due</dt>
          <dd className="font-semibold text-foreground">
            {quote.crtvaiDisplay.toFixed(quote.crtvaiDisplay < 1 ? 3 : 2)} CRTVAI
            <span className="ml-1.5 font-normal text-muted-foreground">({quote.formattedUsd})</span>
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Balance</dt>
          <dd className={cn(insufficient ? 'text-destructive' : 'text-foreground')}>
            {balance.toFixed(2)} CRTVAI
          </dd>
        </div>
      </dl>

      {insufficient && (
        <p className="mt-2 text-[11px] text-destructive">
          {t('director.invoice.insufficient', {
            defaultValue: 'Insufficient CRTVAI. Buy credits, then confirm again.',
          })}
        </p>
      )}

      {!canPayOnChain && (
        <p className="mt-2 text-[11px] text-amber-200/90">
          {t('director.invoice.softPay', {
            defaultValue:
              'Treasury not configured — balance is checked, on-chain charge is skipped in this environment.',
          })}
        </p>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-[11px]"
          disabled={paying}
          onClick={onCancel}
        >
          {t('director.invoice.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8 text-[11px]"
          disabled={paying || insufficient}
          onClick={onConfirm}
        >
          {paying ? (
            <>
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              {t('director.invoice.paying', { defaultValue: 'Paying…' })}
            </>
          ) : (
            t('director.invoice.confirm', {
              defaultValue: 'Pay {{amount}} CRTVAI',
              amount: quote.crtvaiDisplay.toFixed(quote.crtvaiDisplay < 1 ? 3 : 2),
            })
          )}
        </Button>
      </div>
    </div>
  )
}

export const DirectorChatPanel = memo(function DirectorChatPanel() {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const messages = useDirectorStore((s) => s.messages)
  const phase = useDirectorStore((s) => s.phase)
  const streamingText = useDirectorStore((s) => s.streamingText)
  const toolCalls = useDirectorStore((s) => s.toolCalls)
  const submit = useDirectorStore((s) => s.submit)
  const reportLocalError = useDirectorStore((s) => s.reportLocalError)
  const cancel = useDirectorStore((s) => s.cancel)
  const clearChat = useDirectorStore((s) => s.clearChat)

  const { account, connect, authenticated, configured: walletConfigured } = useWalletContext()
  const { balance, refreshBalance } = useCredits()
  const { sendOps, ready: walletOpsReady } = useSmartWalletOps()
  const treasury = getDirectorTreasuryAddress()
  const canPayOnChain = Boolean(treasury && walletOpsReady)

  const timelineItems = useItemsStore((s) => s.items)
  const fps = useTimelineSettingsStore((s) => s.fps)
  const audioContext = useMemo(
    () => buildDirectorTimelineAudioContext(timelineItems, fps),
    [timelineItems, fps],
  )
  const hasTimelineAudio = audioContext.hasAudio

  const [input, setInput] = useState('')
  const [pendingInvoice, setPendingInvoice] = useState<PendingInvoice | null>(null)
  const [paying, setPaying] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const busy = phase !== 'idle' || paying || pendingInvoice !== null
  const runningTools = toolCalls.filter((call) => call.status === 'running')
  const isEmpty = messages.length === 0 && phase === 'idle' && !pendingInvoice
  const status = statusLabel(phase, streamingText, runningTools.length, paying, t)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, phase, streamingText, toolCalls, pendingInvoice, paying])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`
  }, [input])

  const queueInvoice = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      if (!hasTimelineAudio || !audioContext.primary) {
        reportLocalError(
          t('director.error.noTimelineAudio', {
            defaultValue:
              'Add an audio clip (or unmuted video) to the timeline before briefing the Director. Beat-synced storyboards need a track on the timeline.',
          }),
        )
        return
      }

      if (walletConfigured && !authenticated) {
        connect()
        reportLocalError(
          t('director.error.connectWallet', {
            defaultValue: 'Connect your wallet to pay for the Director in CRTVAI.',
          }),
        )
        return
      }

      const quote = quoteDirectorBrief({
        audioDurationSeconds: audioContext.primary.durationSeconds,
      })
      if (!quote) {
        reportLocalError(
          t('director.error.noQuote', {
            defaultValue: 'Could not price this brief from timeline audio.',
          }),
        )
        return
      }

      setInput('')
      setPendingInvoice({
        brief: trimmed,
        apiPrompt: `${trimmed}\n\n${formatTimelineAudioForPrompt(audioContext)}`,
        audioUri: publicAudioUriForDirector(audioContext.primary.src),
        quote,
      })
    },
    [audioContext, authenticated, connect, hasTimelineAudio, reportLocalError, t, walletConfigured],
  )

  const cancelInvoice = useCallback(() => {
    setPendingInvoice(null)
    setPaying(false)
  }, [])

  const confirmInvoice = useCallback(async () => {
    if (!pendingInvoice || paying) return
    const { brief, apiPrompt, audioUri, quote } = pendingInvoice

    if (balance < quote.crtvaiDisplay) {
      reportLocalError(
        t('director.error.insufficientCrtvai', {
          defaultValue: 'Insufficient CRTVAI balance for this Director invoice.',
        }),
      )
      return
    }

    setPaying(true)
    try {
      let paymentTxHash: string | undefined
      if (canPayOnChain) {
        const { txHash } = await sendOps([buildDirectorPaymentOp(quote.crtvaiWei)])
        paymentTxHash = txHash
        refreshBalance()
      }

      setPendingInvoice(null)
      await submit(brief, {
        apiPrompt,
        ...(audioUri ? { audioUri } : {}),
        audioDurationSeconds: quote.audioDurationSeconds,
        ...(paymentTxHash ? { paymentTxHash } : {}),
        ...(account ? { walletAddress: account } : {}),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Payment failed'
      reportLocalError(message)
    } finally {
      setPaying(false)
    }
  }, [
    account,
    balance,
    canPayOnChain,
    paying,
    pendingInvoice,
    refreshBalance,
    reportLocalError,
    sendOps,
    submit,
    t,
  ])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        if (!busy) queueInvoice(input)
      }
    },
    [busy, input, queueInvoice],
  )

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-10%,oklch(0.68_0.19_45_/_0.14),transparent_55%),linear-gradient(180deg,oklch(0.14_0_0)_0%,oklch(0.12_0_0)_100%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent"
      />

      <header className="relative z-10 flex shrink-0 items-center gap-3 border-b border-border/60 px-3 py-2.5">
        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/35 bg-primary/10">
          <Clapperboard className="h-4 w-4 text-primary" strokeWidth={1.75} />
          <span
            className={cn(
              'absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-[oklch(0.14_0_0)]',
              phase !== 'idle' || paying
                ? 'bg-primary'
                : hasTimelineAudio
                  ? 'bg-emerald-400/90'
                  : 'bg-amber-400/90',
              (phase !== 'idle' || paying) && !reduceMotion && 'animate-pulse',
            )}
            aria-hidden
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="truncate text-[13px] font-semibold tracking-tight text-foreground">
              {t('director.identity.name', { defaultValue: 'Creative Director' })}
            </h2>
            <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
              {status}
            </span>
          </div>
          <p className="truncate text-[11px] text-muted-foreground">
            {paying
              ? t('director.identity.paying', {
                  defaultValue: 'Confirming CRTVAI payment…',
                })
              : phase !== 'idle'
                ? t('director.identity.busy', {
                    defaultValue: 'Planning against Vertex Agent Engine…',
                  })
                : hasTimelineAudio
                  ? t('director.identity.idleWithAudio', {
                      defaultValue: 'Timeline audio ready · priced per audio minute',
                    })
                  : t('director.identity.idleNeedsAudio', {
                      defaultValue: 'Place audio on the timeline to unlock the Director',
                    })}
          </p>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground"
            onClick={() => {
              cancelInvoice()
              clearChat()
            }}
            disabled={phase !== 'idle' || paying}
            aria-label={t('director.clear', { defaultValue: 'Clear session' })}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </header>

      <div
        ref={scrollRef}
        className="relative z-10 min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4"
      >
        <AnimatePresence mode="wait">
          {isEmpty && (
            <motion.div
              key="empty"
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
              transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
              className="flex min-h-[70%] flex-col justify-center gap-6 py-2"
            >
              <div className="space-y-2">
                <p className="font-mono text-[10px] tracking-[0.2em] text-primary/80 uppercase">
                  {t('director.empty.eyebrow', { defaultValue: 'Session' })}
                </p>
                <h3 className="text-[22px] leading-tight font-semibold tracking-tight text-foreground">
                  {t('director.empty.title', {
                    defaultValue: 'Brief the Director',
                  })}
                </h3>
                <p className="max-w-[22rem] text-[12px] leading-relaxed text-muted-foreground">
                  {hasTimelineAudio
                    ? t('director.empty.intro', {
                        defaultValue:
                          'Describe the cut you want. You’ll see a CRTVAI invoice priced by timeline audio minutes before generation starts.',
                      })
                    : t('director.empty.introNeedsAudio', {
                        defaultValue:
                          'Drop a track onto the timeline first. The Director builds beat-synced storyboards from audio already in your edit.',
                      })}
                </p>
              </div>

              <ul className="space-y-1.5">
                {SUGGESTIONS.map((suggestion, index) => (
                  <motion.li
                    key={suggestion.key}
                    initial={reduceMotion ? false : { opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      delay: reduceMotion ? 0 : 0.08 + index * 0.05,
                      duration: 0.3,
                      ease: [0.23, 1, 0.32, 1],
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => queueInvoice(suggestion.text)}
                      disabled={!hasTimelineAudio || busy}
                      className={cn(
                        'group flex w-full items-center gap-3 rounded-md border border-border/70 bg-secondary/20 px-3 py-2.5 text-left transition-colors',
                        hasTimelineAudio
                          ? 'hover:border-primary/40 hover:bg-primary/5'
                          : 'cursor-not-allowed opacity-45',
                      )}
                    >
                      <span className="font-mono text-[10px] text-muted-foreground tabular-nums group-hover:text-primary">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] font-medium text-foreground">
                          {suggestion.label}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {suggestion.text}
                        </span>
                      </span>
                    </button>
                  </motion.li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>

        {messages.map((message) => (
          <DirectorMessage key={message.id} role={message.role} content={message.content} />
        ))}

        {pendingInvoice && (
          <DirectorInvoiceCard
            invoice={pendingInvoice}
            balance={balance}
            canPayOnChain={canPayOnChain}
            paying={paying}
            onConfirm={() => void confirmInvoice()}
            onCancel={cancelInvoice}
            t={t}
          />
        )}

        {phase === 'streaming' && streamingText && (
          <div className="flex justify-start gap-2.5">
            <AgentMark />
            <div className="max-w-[88%] whitespace-pre-wrap pt-0.5 text-[12px] leading-relaxed text-foreground/95">
              {streamingText}
              <span
                className={cn(
                  'ml-0.5 inline-block h-3 w-[2px] translate-y-0.5 bg-primary align-middle',
                  !reduceMotion && 'animate-pulse',
                )}
                aria-hidden
              />
            </div>
          </div>
        )}

        {phase === 'streaming' && !streamingText && runningTools.length === 0 && (
          <div className="flex items-center gap-2.5 text-[12px] text-muted-foreground">
            <AgentMark variant="busy" />
            {t('director.status.planning', { defaultValue: 'Director is planning…' })}
          </div>
        )}

        {runningTools.length > 0 && (
          <div className="ml-8 space-y-1.5">
            {runningTools.map((call) => (
              <div
                key={call.id}
                className="inline-flex items-center gap-2 rounded-md border border-border/70 bg-secondary/30 px-2.5 py-1 font-mono text-[11px] text-muted-foreground"
              >
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                <span className="text-foreground/80">{call.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="relative z-10 shrink-0 border-t border-border/60 bg-[oklch(0.13_0_0_/_0.85)] px-3 py-2.5 backdrop-blur-sm">
        <label className="sr-only" htmlFor="director-prompt">
          {t('director.composer.placeholder', { defaultValue: 'Brief the Director…' })}
        </label>
        <div className="flex items-end gap-2 rounded-xl border border-border/80 bg-secondary/30 p-1.5 transition-colors focus-within:border-primary/45">
          <textarea
            id="director-prompt"
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={Boolean(pendingInvoice) || paying}
            placeholder={
              hasTimelineAudio
                ? t('director.composer.placeholder', {
                    defaultValue: 'Brief the Director…',
                  })
                : t('director.composer.placeholderNeedsAudio', {
                    defaultValue: 'Add timeline audio first…',
                  })
            }
            className="max-h-28 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-2 text-[12px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70 disabled:opacity-50"
          />
          {phase === 'streaming' ? (
            <Button
              size="icon"
              variant="secondary"
              className="h-9 w-9 shrink-0 rounded-lg"
              onClick={cancel}
              aria-label={t('director.cancel', { defaultValue: 'Stop' })}
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="h-9 w-9 shrink-0 rounded-lg"
              disabled={busy || !input.trim() || !hasTimelineAudio}
              onClick={() => queueInvoice(input)}
              aria-label={t('director.send', { defaultValue: 'Send brief' })}
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="mt-1.5 px-0.5 font-mono text-[10px] tracking-wide text-muted-foreground/80">
          {hasTimelineAudio
            ? t('director.composer.hintPaid', {
                defaultValue: 'Enter queues an invoice · CRTVAI charged per audio minute',
              })
            : t('director.composer.hintNeedsAudio', {
                defaultValue: 'Timeline audio required for beat-synced storyboards',
              })}
        </p>
      </div>
    </div>
  )
})
