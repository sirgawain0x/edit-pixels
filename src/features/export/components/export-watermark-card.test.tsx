import { describe, expect, it, vi } from 'vite-plus/test'
import { render, screen } from '@testing-library/react'
import { ExportWatermarkCard } from './export-watermark-card'

function props(overrides: Partial<Parameters<typeof ExportWatermarkCard>[0]> = {}) {
  return {
    status: 'locked' as const,
    unlocked: false,
    stamped: true,
    priceUsd: 5,
    crtvaiCost: '412.06',
    balanceFormatted: '3.11',
    blockedReason: null,
    error: null,
    expiresAtMs: null,
    hasPendingPayment: false,
    onPay: vi.fn(),
    onRetry: vi.fn(),
    onStampChange: vi.fn(),
    ...overrides,
  }
}

describe('ExportWatermarkCard', () => {
  it('offers the purchase when the project has no permit', () => {
    render(<ExportWatermarkCard {...props()} />)

    expect(screen.getByText('CRTV mark')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Remove · \$5\.00/ })).toBeInTheDocument()
  })

  it('resumes an already-sent payment instead of offering a second one', () => {
    // The money left the wallet but the permit never landed; the balance may now be below the
    // price, so this button must not be gated on it.
    const onPay = vi.fn()
    render(
      <ExportWatermarkCard
        {...props({ hasPendingPayment: true, blockedReason: 'insufficient', onPay })}
      />,
    )

    const button = screen.getByRole('button', { name: 'Finish unlocking' })
    expect(button).toBeEnabled()

    button.click()
    expect(onPay).toHaveBeenCalledTimes(1)
    // No second charge: the pay dialog must not open.
    expect(screen.queryByText('Remove the CRTV mark')).not.toBeInTheDocument()
  })

  it('shows the paid state with an optional stamp', () => {
    render(
      <ExportWatermarkCard
        {...props({ status: 'unlocked', unlocked: true, expiresAtMs: 1_893_456_000_000 })}
      />,
    )

    expect(screen.getByText('Removed for this project')).toBeInTheDocument()
    expect(screen.getByRole('switch')).toBeInTheDocument()
  })

  it('surfaces a failed redemption with the transfer still outstanding', () => {
    render(
      <ExportWatermarkCard
        {...props({ status: 'error', error: 'Request failed (502)', hasPendingPayment: true })}
      />,
    )

    expect(screen.getByText('Request failed (502)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finish unlocking' })).toBeInTheDocument()
  })
})
