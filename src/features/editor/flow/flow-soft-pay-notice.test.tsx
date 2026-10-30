// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vite-plus/test'
import { fireEvent, render, screen } from '@testing-library/react'
import { FlowSoftPayNotice, resolveFlowSoftPayState } from './flow-soft-pay-notice'

describe('resolveFlowSoftPayState', () => {
  const ready = {
    canPayOnChain: false,
    walletConfigured: true,
    walletReady: true,
    authenticated: true,
    walletOpsReady: true,
    smartAccountStatus: 'ready' as const,
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

  it('waits for session hydration before offering sign-in', () => {
    expect(
      resolveFlowSoftPayState({
        ...ready,
        walletReady: false,
        authenticated: false,
        walletOpsReady: false,
      }),
    ).toBe('initializing-wallet')
  })

  it('shows a wallet error after failed provisioning, even without a treasury', () => {
    expect(
      resolveFlowSoftPayState({
        ...ready,
        walletOpsReady: false,
        smartAccountStatus: 'error',
        hasTreasury: false,
      }),
    ).toBe('wallet-error')
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
  const walletState = {
    walletReady: true,
    smartAccountStatus: 'ready' as const,
    onRetryWallet: vi.fn(),
  }

  it('hides sign-in until hydration completes and shows the loaded session', () => {
    const onSignIn = vi.fn()
    const props = {
      ...walletState,
      canPayOnChain: false,
      walletConfigured: true,
      walletReady: false,
      authenticated: false,
      walletOpsReady: false,
      hasTreasury: true,
      onSignIn,
    }
    const { rerender } = render(<FlowSoftPayNotice {...props} />)
    expect(screen.getByRole('status').textContent).toMatch(/Loading your wallet/i)
    expect(screen.queryByRole('button', { name: /Sign in/i })).toBeNull()
    expect(onSignIn).not.toHaveBeenCalled()

    rerender(<FlowSoftPayNotice {...props} walletReady authenticated />)
    expect(screen.getByRole('status').textContent).toMatch(/Connecting your wallet/i)
    expect(screen.queryByRole('button', { name: /Sign in/i })).toBeNull()

    rerender(<FlowSoftPayNotice {...props} walletReady />)
    expect(screen.getByRole('button', { name: /Sign in/i })).toBeTruthy()
  })

  it('offers retry after a wallet error and returns to connecting during retry', () => {
    const onRetryWallet = vi.fn()
    const props = {
      ...walletState,
      canPayOnChain: false,
      walletConfigured: true,
      authenticated: true,
      walletOpsReady: false,
      hasTreasury: true,
      onSignIn: vi.fn(),
      onRetryWallet,
    }
    const { rerender } = render(<FlowSoftPayNotice {...props} smartAccountStatus="error" />)
    expect(screen.getByRole('alert').textContent).toMatch(/couldn't connect your wallet/i)
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Retry wallet connection/i }))
    expect(onRetryWallet).toHaveBeenCalledOnce()
    expect(props.onSignIn).not.toHaveBeenCalled()

    rerender(<FlowSoftPayNotice {...props} smartAccountStatus="pending" />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: /Retry wallet connection/i })).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/Connecting your wallet/i)

    rerender(<FlowSoftPayNotice {...props} walletOpsReady canPayOnChain />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows sign-in prompt and triggers Privy login', () => {
    const onSignIn = vi.fn()
    render(
      <FlowSoftPayNotice
        {...walletState}
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
        {...walletState}
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
        {...walletState}
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
        {...walletState}
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
