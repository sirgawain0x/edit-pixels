import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { ClientCodec } from '../utils/client-renderer'
import { ExportDialog } from './export-dialog'

const mockStartExport = vi.fn()
const mockCancelExport = vi.fn()
const mockDownloadVideo = vi.fn()
const mockResetState = vi.fn()
const mockGetSupportedCodecs = vi.fn<(...args: unknown[]) => Promise<ClientCodec[]>>()

vi.mock('../hooks/use-client-render', () => ({
  useClientRender: () => ({
    isExporting: false,
    progress: 0,
    renderedFrames: undefined,
    totalFrames: undefined,
    status: 'idle',
    error: null,
    result: null,
    startExport: mockStartExport,
    cancelExport: mockCancelExport,
    downloadVideo: mockDownloadVideo,
    resetState: mockResetState,
    getSupportedCodecs: mockGetSupportedCodecs,
    estimateFileSize: vi.fn(),
  }),
}))

vi.mock('@/features/export/deps/projects', () => ({
  useProjectStore: (
    selector: (state: {
      currentProject: { metadata: { width: number; height: number } }
    }) => unknown,
  ) =>
    selector({
      currentProject: {
        metadata: {
          width: 1920,
          height: 1080,
        },
      },
    }),
}))

vi.mock('@/features/export/deps/timeline', () => ({
  useTimelineStore: (
    selector: (state: {
      fps: number
      items: Array<{ from: number; durationInFrames: number }>
      inPoint: number | null
      outPoint: number | null
    }) => unknown,
  ) =>
    selector({
      fps: 30,
      items: [],
      inPoint: null,
      outPoint: null,
    }),
}))

vi.mock('@/features/export/deps/wallet', () => ({
  useWalletContext: () => ({ account: undefined }),
}))

vi.mock('./export-preview-player', () => ({
  ExportPreviewPlayer: () => <div data-testid="export-preview-player" />,
}))

// The unlock card's own hook talks to the wallet provider and the query client; this suite
// only cares that the dialog renders its state, so the hook is stubbed.
const mockUnlock = vi.fn()
vi.mock('../hooks/use-export-unlock', () => ({
  useExportUnlock: () => mockUnlock(),
}))

function lockedUnlock() {
  return {
    status: 'locked' as const,
    unlocked: false,
    quote: {
      projectId: 'p1',
      priceUsd: 5,
      estimatedUsdc6: 5_000_000,
      minCrtvaiWei: '400000000000000000000',
      expiresAtMs: Date.now() + 60_000,
    },
    crtvaiCost: '400',
    balanceFormatted: '1,000',
    canPay: false,
    blockedReason: 'no-wallet' as const,
    error: null,
    expiresAtMs: null,
    hasPendingPayment: false,
    unlock: vi.fn(),
    refreshQuote: vi.fn(),
  }
}

describe('ExportDialog', () => {
  beforeEach(() => {
    mockStartExport.mockReset()
    mockCancelExport.mockReset()
    mockDownloadVideo.mockReset()
    mockResetState.mockReset()
    mockGetSupportedCodecs.mockReset()
    mockUnlock.mockReset()
    mockUnlock.mockReturnValue(lockedUnlock())

    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = () => {}
    }
  })

  it('defaults to mp4 with H.264 codec', async () => {
    mockGetSupportedCodecs.mockResolvedValue(['avc'])

    render(<ExportDialog open onClose={() => {}} />)

    await waitFor(() => {
      expect(mockGetSupportedCodecs).toHaveBeenCalledWith({
        resolution: { width: 1920, height: 1080 },
        bitrate: 3_000_000,
      })
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Format')).toHaveTextContent('MP4')
      expect(screen.getByLabelText('Codec')).toHaveTextContent('H.264')
    })
  })

  it('disables unsupported format and codec choices in the browser capability matrix', async () => {
    mockGetSupportedCodecs.mockResolvedValue(['avc'])

    render(<ExportDialog open onClose={() => {}} />)

    await waitFor(() => {
      expect(mockGetSupportedCodecs).toHaveBeenCalled()
    })

    fireEvent.keyDown(screen.getByLabelText('Format'), { key: 'ArrowDown' })

    const webmOption = await screen.findByRole('option', { name: /WebM/i })
    expect(webmOption).toHaveAttribute('data-disabled')

    fireEvent.keyDown(screen.getByLabelText('Format'), { key: 'Escape' })
    fireEvent.keyDown(screen.getByLabelText('Codec'), { key: 'ArrowDown' })

    const h265Option = await screen.findByRole('option', { name: /H\.265/i })
    expect(h265Option).toHaveAttribute('data-disabled')
  })

  it('shows the watermark card for video exports and hides it for audio', async () => {
    mockGetSupportedCodecs.mockResolvedValue(['avc'])

    render(<ExportDialog open onClose={() => {}} />)

    expect(await screen.findByText('CRTV mark')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Audio/i }))

    await waitFor(() => {
      expect(screen.queryByText('CRTV mark')).not.toBeInTheDocument()
    })
  })

  it('shows the paid state when the project already holds a permit', async () => {
    mockGetSupportedCodecs.mockResolvedValue(['avc'])
    mockUnlock.mockReturnValue({
      ...lockedUnlock(),
      status: 'unlocked',
      unlocked: true,
      expiresAtMs: Date.now() + 86_400_000,
    })

    render(<ExportDialog open onClose={() => {}} />)

    expect(await screen.findByText('Removed for this project')).toBeInTheDocument()
  })
})
