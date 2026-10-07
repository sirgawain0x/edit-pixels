import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { DirectorMessageActions } from './director-message-actions'

describe('DirectorMessageActions', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders speech and copy buttons', () => {
    const { getByRole, getByTitle } = render(
      <DirectorMessageActions text="Here is your storyboard." />,
    )
    expect(getByTitle(/Read aloud with local TTS/)).toBeInTheDocument()
    expect(getByTitle(/Copy response/)).toBeInTheDocument()
    expect(getByRole('button', { name: /Copy response/ })).toBeInTheDocument()
  })

  it('copies text to clipboard when copy button is clicked', async () => {
    const { getByRole } = render(<DirectorMessageActions text="Here is your storyboard." />)
    const copyButton = getByRole('button', { name: /Copy response/ })
    await act(async () => {
      fireEvent.click(copyButton)
    })

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Here is your storyboard.')
  })
})
