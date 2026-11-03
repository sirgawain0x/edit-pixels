import { useRef, useState } from 'react'
import { PixelsLogo } from '@/components/brand/pixels-logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PRIVY_DEFAULT_AUTH_API_URL } from '@/config/privy-api-url'
import { useWalletContext } from '@/context/wallet-context'

type DeviceAction = 'approve' | 'deny'

export function AgentAuthorizationPage({ initialCode }: { initialCode: string }) {
  const { configured, ready, authenticated, connect, disconnect, user, getAccessToken } =
    useWalletContext()
  const [code, setCode] = useState(initialCode)
  const [pending, setPending] = useState<DeviceAction | null>(null)
  const [completed, setCompleted] = useState<DeviceAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const submitting = useRef(false)
  const appId = import.meta.env.VITE_PRIVY_APP_ID
  const userCode = code.trim()
  const identity = user?.email?.address ?? user?.wallet?.address ?? user?.id

  async function signOut() {
    setError(null)
    try {
      await disconnect()
    } catch {
      setError('Unable to sign out. Try again.')
    }
  }

  async function submit(action: DeviceAction) {
    if (
      submitting.current ||
      completed ||
      !configured ||
      !ready ||
      !authenticated ||
      !userCode ||
      !appId
    )
      return
    submitting.current = true
    setPending(action)
    setError(null)
    try {
      const token = await getAccessToken()
      if (!token) {
        setError('Your session has expired. Sign out and sign in again before retrying.')
        return
      }
      // Device authorization uses Privy's public OAuth API, never an app secret.
      const response = await fetch(`${PRIVY_DEFAULT_AUTH_API_URL}/api/oauth/v2/device_verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'privy-app-id': appId,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ user_code: userCode, action }),
        signal: AbortSignal.timeout(15_000),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      })
      if (!response.ok) {
        setError(
          response.status === 400
            ? 'This code is invalid or expired. Restart login in your CLI or agent to get a new code.'
            : response.status === 401
              ? 'Your session has expired. Sign out and sign in again before retrying.'
              : 'Unable to verify device access. Try again, or restart login in your CLI or agent.',
        )
        return
      }
      setCompleted(action)
    } catch {
      setError('Unable to reach the authorization service. Check your connection and try again.')
    } finally {
      submitting.current = false
      setPending(null)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground select-text">
      <section
        className="w-full max-w-md space-y-6 rounded-xl border border-border bg-card p-6 shadow-lg"
        aria-labelledby="authorization-title"
      >
        <PixelsLogo size="md" />
        <div className="space-y-2">
          <h1 id="authorization-title" className="text-2xl font-semibold">
            Authorize CLI or agent access
          </h1>
          <p className="text-sm text-muted-foreground">
            Approve access to your Pixels account and Privy wallet. The CLI or agent may perform
            wallet operations on your behalf.
          </p>
        </div>
        {completed ? (
          <p role="status">
            {completed === 'approve'
              ? 'Access approved. Return to your CLI or agent to continue.'
              : 'Access denied. You can close this page.'}
          </p>
        ) : (
          <>
            <div className="space-y-2">
              <label htmlFor="device-code" className="text-sm font-medium">
                Device code
              </label>
              <Input
                id="device-code"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value)
                  setError(null)
                }}
                disabled={pending !== null}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={128}
                aria-describedby="device-code-help"
              />
              <p id="device-code-help" className="text-sm text-muted-foreground">
                Only approve if you started this request. Confirm this code matches the one shown in
                your CLI or agent.
              </p>
            </div>
            {!configured || !appId ? (
              <p role="alert">Agent authorization is not configured for this app.</p>
            ) : !ready ? (
              <p role="status">Loading sign-in…</p>
            ) : !authenticated ? (
              <Button onClick={connect}>Sign in to continue</Button>
            ) : (
              <>
                {identity ? (
                  <p className="break-all text-sm text-muted-foreground">Signed in as {identity}</p>
                ) : null}
                <div className="flex gap-3">
                  <Button
                    disabled={!userCode || pending !== null}
                    onClick={() => void submit('approve')}
                  >
                    {pending === 'approve' ? 'Approving…' : 'Approve access'}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!userCode || pending !== null}
                    onClick={() => void submit('deny')}
                  >
                    {pending === 'deny' ? 'Denying…' : 'Deny access'}
                  </Button>
                </div>
                <Button variant="ghost" disabled={pending !== null} onClick={() => void signOut()}>
                  Sign out
                </Button>
              </>
            )}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </>
        )}
      </section>
    </main>
  )
}
