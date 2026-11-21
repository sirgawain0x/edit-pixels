import { memo, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight, History, Loader2, MessageSquare, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/shared/ui/cn'
import {
  briefTitleFromPrompt,
  deleteDirectorPastSession,
  fetchDirectorPastSessions,
  fetchDirectorSessionTranscript,
  type DirectorPastSession,
  type DirectorSessionTranscript,
} from './director-past-sessions'
import type { DirectorConversation } from './director-store'

interface DirectorHistoryAuthProps {
  walletAddress?: string
  signerAddress?: string
  getAccessToken: () => Promise<string | null | undefined>
}

function formatWhen(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const diffMin = Math.round((Date.now() - ms) / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.round(diffH / 24)
  if (diffD < 7) return `${diffD}d ago`
  return new Date(ms).toLocaleDateString()
}

/**
 * Modal with conversations open in this window plus the wallet's saved briefs.
 * Clicking a saved brief loads its full transcript into the Director so you can keep going.
 */
export const DirectorHistoryDialog = memo(function DirectorHistoryDialog({
  open,
  onOpenChange,
  walletAddress,
  signerAddress,
  getAccessToken,
  projectId,
  activeSessionId,
  busy,
  parkedConversations,
  onOpenTranscript,
  onSwitchConversation,
  onDeleted,
}: DirectorHistoryAuthProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId?: string
  activeSessionId: string | null
  busy: boolean
  parkedConversations: DirectorConversation[]
  onOpenTranscript: (transcript: DirectorSessionTranscript) => void
  onSwitchConversation: (key: string) => void
  onDeleted: (sessionId: string) => void
}) {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<DirectorPastSession[]>([])
  const [loading, setLoading] = useState(false)
  const [allProjects, setAllProjects] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<DirectorPastSession | null>(null)
  const [deleting, setDeleting] = useState(false)

  const resolveAuth = useCallback(async () => {
    if (!walletAddress?.startsWith('0x') || !signerAddress?.startsWith('0x')) return null
    const accessToken = (await getAccessToken())?.trim()
    return accessToken ? { walletAddress, signerAddress, accessToken } : null
  }, [getAccessToken, signerAddress, walletAddress])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      const auth = await resolveAuth()
      const rows = auth
        ? await fetchDirectorPastSessions({
            ...auth,
            projectId: allProjects ? undefined : projectId,
            limit: 30,
          })
        : []
      if (!cancelled) {
        setSessions(rows)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, allProjects, projectId, resolveAuth])

  const handleOpen = useCallback(
    async (session: DirectorPastSession) => {
      if (busy || openingId) return
      if (session.sessionId === activeSessionId) {
        onOpenChange(false)
        return
      }
      const parked = parkedConversations.find((c) => c.sessionId === session.sessionId)
      if (parked) {
        onSwitchConversation(parked.key)
        onOpenChange(false)
        return
      }
      const auth = await resolveAuth()
      if (!auth) {
        toast.error('Connect your wallet to open past briefs.')
        return
      }
      setOpeningId(session.sessionId)
      try {
        const transcript = await fetchDirectorSessionTranscript({
          ...auth,
          sessionId: session.sessionId,
        })
        onOpenTranscript(transcript)
        onOpenChange(false)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not open that brief.')
      } finally {
        setOpeningId(null)
      }
    },
    [
      activeSessionId,
      busy,
      onOpenChange,
      onOpenTranscript,
      onSwitchConversation,
      openingId,
      parkedConversations,
      resolveAuth,
    ],
  )

  const confirmDelete = useCallback(async () => {
    const target = pendingDelete
    if (!target) return
    const auth = await resolveAuth()
    if (!auth) {
      toast.error('Connect your wallet to delete past briefs.')
      return
    }
    setDeleting(true)
    try {
      await deleteDirectorPastSession({ ...auth, sessionId: target.sessionId })
      setSessions((rows) => rows.filter((row) => row.sessionId !== target.sessionId))
      onDeleted(target.sessionId)
      toast.success('Brief deleted')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete that brief.')
    } finally {
      setDeleting(false)
      setPendingDelete(null)
    }
  }, [onDeleted, pendingDelete, resolveAuth])

  const signedIn = Boolean(walletAddress?.startsWith('0x') && signerAddress?.startsWith('0x'))

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[80vh] max-w-xl flex-col gap-3 overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <History className="h-4 w-4" />
              {t('director.history.title', { defaultValue: 'Briefs & conversations' })}
            </DialogTitle>
            <DialogDescription className="text-[12px]">
              {busy
                ? t('director.history.busy', {
                    defaultValue: 'Wait for the Director to finish replying before switching.',
                  })
                : t('director.history.description', {
                    defaultValue:
                      'Open a past brief to read the full conversation and keep building on it.',
                  })}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            {parkedConversations.length > 0 && (
              <section className="space-y-1.5">
                <h4 className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                  {t('director.history.openNow', { defaultValue: 'Open in this window' })}
                </h4>
                <ul className="space-y-1">
                  {parkedConversations.map((conversation) => (
                    <li key={conversation.key}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          onSwitchConversation(conversation.key)
                          onOpenChange(false)
                        }}
                        className="flex w-full items-center gap-2 rounded-md border border-border/70 bg-secondary/20 px-2.5 py-2 text-left text-[12px] text-foreground transition-colors hover:bg-secondary/40 disabled:opacity-50"
                      >
                        <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {conversation.messages.length} msgs
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                  {t('director.history.past', { defaultValue: 'Past briefs' })}
                </h4>
                {projectId ? (
                  <button
                    type="button"
                    onClick={() => setAllProjects((value) => !value)}
                    className="text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {allProjects
                      ? t('director.history.thisProject', { defaultValue: 'This project only' })
                      : t('director.history.allProjects', { defaultValue: 'Show all projects' })}
                  </button>
                ) : null}
              </div>

              {!signedIn ? (
                <p className="py-6 text-center text-[12px] text-muted-foreground">
                  {t('director.history.signIn', {
                    defaultValue: 'Connect your wallet to see past briefs.',
                  })}
                </p>
              ) : loading ? (
                <div className="flex justify-center py-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : sessions.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-muted-foreground">
                  {t('director.history.empty', { defaultValue: 'No past briefs yet.' })}
                </p>
              ) : (
                <ul className="space-y-1">
                  {sessions.map((session) => {
                    const active = session.sessionId === activeSessionId
                    const title = briefTitleFromPrompt(session.promptPreview) || 'Untitled brief'
                    return (
                      <li
                        key={session.sessionId}
                        className={cn(
                          'group flex items-stretch gap-1 rounded-md border transition-colors',
                          active
                            ? 'border-primary/40 bg-primary/10'
                            : 'border-border/70 bg-secondary/20 hover:bg-secondary/40',
                        )}
                      >
                        <button
                          type="button"
                          disabled={busy || openingId !== null}
                          onClick={() => void handleOpen(session)}
                          className="flex min-w-0 flex-1 items-start gap-2 px-2.5 py-2 text-left disabled:opacity-60"
                        >
                          {openingId === session.sessionId ? (
                            <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
                          ) : (
                            <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-2 text-[12px] text-foreground">
                              {title}
                            </span>
                            <span className="mt-0.5 flex gap-2 text-[10px] text-muted-foreground">
                              <span>{formatWhen(session.updatedAt)}</span>
                              {active ? <span className="text-primary">Current</span> : null}
                              {session.status === 'failed' ? (
                                <span className="text-destructive">Failed</span>
                              ) : null}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={busy && active}
                          onClick={() => setPendingDelete(session)}
                          className="flex w-8 shrink-0 items-center justify-center rounded-r-md text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100 hover:text-destructive disabled:opacity-30"
                          aria-label={t('director.history.delete', {
                            defaultValue: 'Delete brief',
                          })}
                          title={t('director.history.delete', { defaultValue: 'Delete brief' })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(value) => {
          if (!value && !deleting) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('director.history.deleteTitle', { defaultValue: 'Delete this brief?' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('director.history.deleteDescription', {
                defaultValue:
                  'The saved conversation and storyboard for this brief will be removed. This cannot be undone.',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                void confirmDelete()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t('director.history.deleteConfirm', { defaultValue: 'Delete' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
})

/** Thin strip of other open conversations so you can hop back with one click. */
export const DirectorConversationSwitcher = memo(function DirectorConversationSwitcher({
  conversations,
  busy,
  onSwitch,
}: {
  conversations: DirectorConversation[]
  busy: boolean
  onSwitch: (key: string) => void
}) {
  const { t } = useTranslation()
  if (conversations.length === 0) return null
  return (
    <div className="relative z-10 flex items-center gap-1.5 overflow-x-auto border-b border-border/60 px-3 py-1.5">
      <span className="shrink-0 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        {t('director.switcher.label', { defaultValue: 'Also open' })}
      </span>
      {conversations.map((conversation) => (
        <button
          key={conversation.key}
          type="button"
          disabled={busy}
          onClick={() => onSwitch(conversation.key)}
          title={conversation.title}
          className="flex max-w-[180px] shrink-0 items-center gap-1 rounded-full border border-border/70 bg-secondary/30 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground disabled:opacity-50"
        >
          <ArrowLeftRight className="h-3 w-3 shrink-0" />
          <span className="truncate">{conversation.title}</span>
        </button>
      ))}
    </div>
  )
})
