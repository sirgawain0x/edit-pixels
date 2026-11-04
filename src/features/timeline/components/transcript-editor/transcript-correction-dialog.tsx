import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { mediaTranscriptionService } from '../../deps/media-transcription-service'

export interface TranscriptCorrectionTarget {
  mediaId: string
  start: number
  end: number
  text: string
  expectedUpdatedAt: number
  wordCount?: number
  indices?: number[]
}

export function TranscriptCorrectionDialog({
  target,
  onClose,
}: {
  target: TranscriptCorrectionTarget
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState(target.text)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timingChanges =
    text.trim().split(/\s+/u).length !==
    (target.wordCount ?? target.text.trim().split(/\s+/u).length)

  const save = async () => {
    if (saving || !text.trim()) return
    setSaving(true)
    setError(null)
    try {
      const previous = await mediaTranscriptionService.getTranscript(target.mediaId)
      const saved = await mediaTranscriptionService.updateTranscriptWords(target.mediaId, {
        ...target,
        text,
      })
      toast.success(
        t('transcript.correctionSaved', { defaultValue: 'Correction saved and captions updated' }),
        previous
          ? {
              action: {
                label: t('transcript.undoCorrection', { defaultValue: 'Undo correction' }),
                onClick: () => {
                  void mediaTranscriptionService
                    .restoreTranscriptWords(previous, saved.updatedAt)
                    .catch((failure: unknown) => {
                      toast.error(
                        failure instanceof Error
                          ? failure.message
                          : t('transcript.correctionFailed', {
                              defaultValue: 'Could not save correction. Try again.',
                            }),
                      )
                    })
                },
              },
            }
          : undefined,
      )
      onClose()
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : t('transcript.correctionFailed', {
              defaultValue: 'Could not save correction. Try again.',
            }),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
    >
      <DialogContent hideCloseButton={saving}>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('transcript.editWords', { defaultValue: 'Edit words' })}</DialogTitle>
            <DialogDescription>
              {t('transcript.correctionHint', {
                defaultValue:
                  'Correct the transcript and captions. The recorded audio stays the same. Corrections apply to every use of this source and survive regeneration.',
              })}
            </DialogDescription>
          </DialogHeader>
          <Input
            className="my-4"
            autoFocus
            value={text}
            disabled={saving}
            aria-label={t('transcript.correctedWords', { defaultValue: 'Corrected words' })}
            onChange={(event) => setText(event.target.value)}
          />
          <p className="mb-4 text-xs text-muted-foreground" role="status">
            {timingChanges
              ? t('transcript.estimatedCorrectionTiming', {
                  defaultValue:
                    'Word count changed. Word timing will be estimated within the original selection; review playback before cutting these words.',
                })
              : t('transcript.preservedCorrectionTiming', {
                  defaultValue: 'Existing word timing will be preserved.',
                })}
          </p>
          {error && (
            <p role="alert" className="mb-4 text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving || !text.trim() || text.trim() === target.text}>
              {saving
                ? t('transcript.savingCorrection', { defaultValue: 'Saving…' })
                : t('transcript.saveCorrection', { defaultValue: 'Save correction' })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
