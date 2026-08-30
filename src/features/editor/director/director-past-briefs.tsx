import { memo, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { History } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { fetchDirectorPastSessions, type DirectorPastSession } from './director-past-sessions'

interface DirectorPastBriefsProps {
  walletAddress?: string
  projectId?: string
  activeSessionId: string | null
  disabled?: boolean
  onResume: (sessionId: string) => void
}

export const DirectorPastBriefs = memo(function DirectorPastBriefs({
  walletAddress,
  projectId,
  activeSessionId,
  disabled,
  onResume,
}: DirectorPastBriefsProps) {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<DirectorPastSession[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!walletAddress?.startsWith('0x')) {
      setSessions([])
      return
    }

    let cancelled = false
    void fetchDirectorPastSessions({ walletAddress, projectId, limit: 12 }).then((rows) => {
      if (!cancelled) setSessions(rows)
    })

    return () => {
      cancelled = true
    }
  }, [walletAddress, projectId, activeSessionId])

  const toggle = useCallback(() => {
    setOpen((value) => !value)
  }, [])

  if (!walletAddress?.startsWith('0x') || sessions.length === 0) return null

  return (
    <div className="relative z-10 border-b border-border/60 px-3 py-2">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        className="flex w-full items-center gap-2 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <History className="h-3.5 w-3.5 shrink-0" />
        <span>
          {t('director.pastBriefs.title', {
            defaultValue: 'Past briefs',
          })}{' '}
          ({sessions.length})
        </span>
      </button>
      {open ? (
        <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto">
          {sessions.map((session) => (
            <li key={session.sessionId}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onResume(session.sessionId)}
                className={cn(
                  'w-full rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors',
                  activeSessionId === session.sessionId
                    ? 'border-primary/40 bg-primary/10 text-foreground'
                    : 'border-border/70 bg-secondary/20 text-muted-foreground hover:bg-secondary/40 hover:text-foreground',
                )}
              >
                <span className="line-clamp-2">{session.promptPreview || session.sessionId}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
})
