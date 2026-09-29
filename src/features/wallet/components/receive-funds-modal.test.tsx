import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { arbitrum, base } from 'viem/chains'
import type { Address } from 'viem'
import type { SmartAccountStatus } from '@/context/wallet-context'
import { ReceiveFundsModal } from './receive-funds-modal'

const SMART_WALLET = '0x04F5C5691E2F3e79246B08b98e912b3D2a786696' as Address

const walletState = vi.hoisted(() => ({
  account: '0x04F5C5691E2F3e79246B08b98e912b3D2a786696' as Address | undefined,
  chain: { id: 8453, name: 'Base' },
  switchChain: vi.fn<(chainId: number) => Promise<void>>(async () => {}),
  smartAccountStatus: 'ready' as SmartAccountStatus,
}))

vi.mock('@/context/wallet-context', () => ({
  useWalletContext: () => walletState,
}))

vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <svg data-testid="receive-qr" data-value={value} />,
}))

describe('ReceiveFundsModal', () => {
  beforeEach(() => {
    walletState.account = SMART_WALLET
    walletState.chain = { id: base.id, name: base.name }
    walletState.smartAccountStatus = 'ready'
    walletState.switchChain.mockReset()
    walletState.switchChain.mockResolvedValue(undefined)
  })

  it('encodes the plain smart-wallet address in the QR on Base', () => {
    render(<ReceiveFundsModal open onOpenChange={() => {}} />)

    expect(screen.getByTestId('receive-qr')).toHaveAttribute('data-value', SMART_WALLET)
    expect(screen.getByText(SMART_WALLET)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view on explorer/i })).toHaveAttribute(
      'href',
      `https://basescan.org/address/${SMART_WALLET}`,
    )
    expect(screen.getByText('Set the network to Base.')).toBeInTheDocument()
  })

  it('asks to switch to Base and hides the address on Arbitrum', () => {
    walletState.chain = { id: arbitrum.id, name: arbitrum.name }

    render(<ReceiveFundsModal open onOpenChange={() => {}} />)

    expect(screen.queryByTestId('receive-qr')).not.toBeInTheDocument()
    expect(screen.queryByText(SMART_WALLET)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Base' }))
    expect(walletState.switchChain).toHaveBeenCalledWith(base.id)
    expect(screen.queryByText(SMART_WALLET)).not.toBeInTheDocument()
  })
})
