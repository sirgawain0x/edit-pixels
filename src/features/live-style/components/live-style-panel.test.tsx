// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vite-plus/test'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Address } from 'viem'

const mockCreate = vi.fn()
const mockSendOps = vi.fn()

vi.mock('@/features/live-style/api/live-style-client', () => ({
  createLiveStyleSessionClient: (...args: unknown[]) => mockCreate(...args),
}))

vi.mock('@/hooks/use-smart-wallet-ops', () => ({
  useSmartWalletOps: () => ({
    sendOps: mockSendOps,
    ready: true,
  }),
}))

vi.mock('@/context/wallet-context', () => ({
  useWalletContext: () => ({
    getAccessToken: async () => 'token',
    account: '0xSmart00000000000000000000000000000001' as Address,
    chain: { id: 8453 },
  }),
}))

vi.mock('@/features/live-style/lib/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/live-style/lib/config')>()
  return {
    ...actual,
    isLiveStyleEnabledClient: () => true,
  }
})

import { LiveStylePanel } from './live-style-panel'

describe('LiveStylePanel', () => {
  beforeEach(() => {
    mockCreate.mockReset()
    mockSendOps.mockReset()
    mockSendOps.mockResolvedValue({ txHash: '0xabc' })
    mockCreate.mockResolvedValue({
      sessionId: 'ls_test',
      connect: { kind: 'websocket', websocketUrl: 'mock://local-echo' },
    })
  })

  it('creates session with smart account address', async () => {
    render(<LiveStylePanel />)
    fireEvent.click(screen.getByRole('button', { name: /start/i }))
    await waitFor(() => expect(mockCreate).toHaveBeenCalled())
    const firstCall = mockCreate.mock.calls[0]?.[0] as { walletAddress: string }
    expect(firstCall.walletAddress).toBe('0xSmart00000000000000000000000000000001')
  })
})
