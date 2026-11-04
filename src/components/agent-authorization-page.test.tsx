import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { AgentAuthorizationPage } from './agent-authorization-page'

const wallet = vi.hoisted(() => ({
  configured: true,
  ready: true,
  authenticated: true,
  connect: vi.fn(),
  disconnect: vi.fn(),
  user: { email: { address: 'creator@example.com' } },
  getAccessToken: vi.fn(),
}))
vi.mock('@/context/wallet-context', () => ({ useWalletContext: () => wallet }))
const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  wallet.configured = true
  wallet.ready = true
  wallet.authenticated = true
  wallet.getAccessToken.mockResolvedValue('user-access-token')
  fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_PRIVY_APP_ID', 'test-app-id')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('AgentAuthorizationPage', () => {
  it('requires sign-in and never approves automatically', () => {
    wallet.authenticated = false
    render(<AgentAuthorizationPage initialCode="ABCD-1234" />)
    expect(screen.getByLabelText('Device code')).toHaveValue('ABCD-1234')
    expect(screen.queryByRole('button', { name: 'Approve access' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to continue' }))
    expect(wallet.connect).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['approve', 'deny'] as const)(
    'sends an explicit %s with only the user token',
    async (action) => {
      render(<AgentAuthorizationPage initialCode=" ABCD-1234 " />)
      expect(screen.getByText('Signed in as creator@example.com')).toBeTruthy()
      expect(fetchMock).not.toHaveBeenCalled()
      fireEvent.click(
        screen.getByRole('button', {
          name: action === 'approve' ? 'Approve access' : 'Deny access',
        }),
      )
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(
          action === 'approve' ? 'Access approved' : 'Access denied',
        ),
      )
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        'https://auth.privy.io/api/oauth/v2/device_verify',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'privy-app-id': 'test-app-id',
            Authorization: 'Bearer user-access-token',
          },
          body: JSON.stringify({ user_code: 'ABCD-1234', action }),
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        }),
      )
      expect(screen.queryByRole('button', { name: 'Approve access' })).toBeNull()
    },
  )

  it('accepts a manually entered code and blocks an empty code', async () => {
    render(<AgentAuthorizationPage initialCode="" />)
    expect(screen.getByRole('button', { name: 'Approve access' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Deny access' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Device code'), { target: { value: 'EFGH-5678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve access' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ user_code: 'EFGH-5678', action: 'approve' }),
      }),
    )
  })

  it('disables decisions while waiting and prevents duplicate requests', async () => {
    let finish!: (response: Response) => void
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        finish = resolve
      }),
    )
    render(<AgentAuthorizationPage initialCode="ABCD-1234" />)
    const approve = screen.getByRole('button', { name: 'Approve access' })
    fireEvent.click(approve)
    fireEvent.click(approve)
    expect(screen.getByRole('button', { name: 'Deny access' })).toBeDisabled()
    expect(screen.getByLabelText('Device code')).toBeDisabled()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    finish(new Response(null, { status: 200 }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Access approved'))
  })

  it('explains invalid or expired codes without showing success', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 400 }))
    render(<AgentAuthorizationPage initialCode="ABCD-1234" />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve access' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('invalid or expired'))
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: 'Approve access' })).toBeEnabled()
  })

  it('requires a valid session token', async () => {
    wallet.getAccessToken.mockResolvedValue(null)
    render(<AgentAuthorizationPage initialCode="ABCD-1234" />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve access' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('session has expired'))
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(wallet.disconnect).toHaveBeenCalledOnce()
  })

  it('handles network errors and allows retry', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(<AgentAuthorizationPage initialCode="ABCD-1234" />)
    fireEvent.click(screen.getByRole('button', { name: 'Deny access' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Check your connection'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Deny access' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Access denied'))
  })

  it.each(['unconfigured', 'loading'] as const)('blocks decisions when %s', (state) => {
    wallet.configured = state !== 'unconfigured'
    wallet.ready = state !== 'loading'
    render(<AgentAuthorizationPage initialCode="ABCD-1234" />)
    expect(screen.queryByRole('button', { name: 'Approve access' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
