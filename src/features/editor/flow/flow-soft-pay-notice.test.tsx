// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vite-plus/test'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  FlowSoftPayNotice,
  resolveFlowSoftPayState,
} from './flow-soft-pay-notice'

describe('resolveFlowSoftPayState', () => {
  const ready = {
    canPayOnChain: false,
    walletConfigured: true,
    authenticated: true,
    walletOpsReady: true,
    hasTreasury: true,
  }

  it('returns null when on-chain pay is available', () => {
    expect(
      resolveFlowSoftPayState({
        ...ready,
        canPayOnChain: true,
        hasTreasury: true,
        walletOpsReady: true,
      }),
    ).toBeNull()
  })

  it('returns sign-in when wallet is configured but user is not authenticated', () => {
    expect(
      resolveFlowSoftPayState({
        ...ready,
        authenticated: false,
      }),
    ).toBe('sign-in')
  })

  it('returns connecting-wallet when signed in but smart wallet is not ready', () => {
    expect(
      resolveFlowSoftPayState({
        ...ready,
        walletOpsReady: false,
      }),
    ).toBe('connecting-wallet')
  })

  it('returns treasury-not-configured when treasury address is missing', () => {
    expect(
      resolveFlowSoftPayState({
        ...ready,
        hasTreasury: false,
      }),
    ).toBe('treasury-not-configured')
  })

  it('prefers sign-in over wallet connecting when both apply', () => {
    expect(
      resolveFlowSoftPayState({
        ...ready,
        authenticated: false,
        walletOpsReady: false,
      }),
    ).toBe('sign-in')
  })

  it('prefers connecting-wallet over treasury when signed in without wallet ops', () => {
    expect(
      resolveFlowSoftPayState({
        ...ready,
        walletOpsReady: false,
        hasTreasury: false,
      }),
    ).toBe('connecting-wallet')
  })
})

describe('FlowSoftPayNotice', () => {
  it('shows sign-in prompt and triggers Privy login', () => {
    const onSignIn = vi.fn()
    render(
      <FlowSoftPayNotice
        canPayOnChain={false}
        walletConfigured={true}
        authenticated={false}
        walletOpsReady={false}
        hasTreasury={true}
        onSignIn={onSignIn}
      />,
    )
    expect(screen.getByText(/Sign in to pay on-chain with CRTVAI/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }))
    expect(onSignIn).toHaveBeenCalledOnce()
  })

  it('shows connecting wallet message when authenticated but wallet ops not ready', () => {
    render(
      <FlowSoftPayNotice
        canPayOnChain={false}
        walletConfigured={true}
        authenticated={true}
        walletOpsReady={false}
        hasTreasury={true}
        onSignIn={vi.fn()}
      />,
    )
    expect(screen.getByText(/Connecting your wallet/i)).toBeTruthy()
  })

  it('shows treasury not configured when treasury is missing and wallet is ready', () => {
    render(
      <FlowSoftPayNotice
        canPayOnChain={false}
        walletConfigured={true}
        authenticated={true}
        walletOpsReady={true}
        hasTreasury={false}
        onSignIn={vi.fn()}
      />,
    )
    expect(screen.getByText(/Payments aren't configured on this build/i)).toBeTruthy()
    expect(screen.queryByText(/locally/i)).toBeNull()
  })

  it('renders nothing when on-chain pay is ready', () => {
    const { container } = render(
      <FlowSoftPayNotice
        canPayOnChain={true}
        walletConfigured={true}
        authenticated={true}
        walletOpsReady={true}
        hasTreasury={true}
        onSignIn={vi.fn()}
      />,
    )
    expect(container.textContent).toBe('')
  })
})
