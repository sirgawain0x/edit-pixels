import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { TranscriptCorrectionDialog } from './transcript-correction-dialog'

const { updateWords, success, getTranscript, restore } = vi.hoisted(() => ({
  updateWords: vi.fn(),
  getTranscript: vi.fn(),
  restore: vi.fn(),
  success: vi.fn(),
}))
vi.mock('../../deps/media-transcription-service', () => ({
  mediaTranscriptionService: {
    updateTranscriptWords: updateWords,
    getTranscript,
    restoreTranscriptWords: restore,
  },
}))
vi.mock('sonner', () => ({ toast: { success } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}))

const target = { mediaId: 'm', start: 1, end: 2, text: 'wrong', expectedUpdatedAt: 3 }
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  updateWords.mockResolvedValue({ updatedAt: 4 })
  getTranscript.mockResolvedValue({ mediaId: 'm', updatedAt: 3 })
  restore.mockResolvedValue({})
})

describe('TranscriptCorrectionDialog', () => {
  it('keeps typing local and saves once on confirmation with the source interval and version', async () => {
    const close = vi.fn()
    render(<TranscriptCorrectionDialog target={target} onClose={close} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'corrected' } })
    expect(updateWords).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('preserved')
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }))
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1))
    expect(updateWords).toHaveBeenCalledTimes(1)
    expect(updateWords).toHaveBeenCalledWith('m', { ...target, text: 'corrected' })
  })

  it('offers Undo correction using the saved version and previous timed words', async () => {
    render(<TranscriptCorrectionDialog target={target} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'corrected' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }))
    await waitFor(() => expect(success).toHaveBeenCalled())
    const options = success.mock.calls[0]?.[1]
    expect(options.action.label).toBe('Undo correction')
    options.action.onClick()
    expect(restore).toHaveBeenCalledWith({ mediaId: 'm', updatedAt: 3 }, 4)
  })

  it('explains estimated timing when the corrected word count changes', () => {
    render(<TranscriptCorrectionDialog target={target} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'two words' } })
    expect(screen.getByRole('status').textContent).toContain('estimated')
  })

  it('uses the actual selected token count for unspaced languages', () => {
    render(
      <TranscriptCorrectionDialog
        target={{ ...target, text: '你好', wordCount: 2 }}
        onClose={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '您好' } })
    expect(screen.getByRole('status').textContent).toContain('estimated')
  })

  it('keeps failed edits open with the entered text and supports retry', async () => {
    updateWords.mockRejectedValueOnce(new Error('Disk full'))
    const close = vi.fn()
    render(<TranscriptCorrectionDialog target={target} onClose={close} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'corrected' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Disk full'))
    expect(close).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('corrected')
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }))
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1))
  })

  it('prevents empty replacement from silently becoming a media delete', () => {
    render(<TranscriptCorrectionDialog target={target} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: ' ' } })
    expect(
      (screen.getByRole('button', { name: 'Save correction' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
