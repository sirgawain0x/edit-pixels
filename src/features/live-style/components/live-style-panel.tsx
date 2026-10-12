/**
 * Paid Live Style UI — rendered only when VITE_ENABLE_LIVE_STYLE is on.
 */
import { useCallback, useState } from 'react'
import { isLiveStyleEnabledClient, LIVE_STYLE_CAP_PRESETS_USD } from '@/features/live-style/lib/config'
import { createLiveStyleSessionClient } from '@/features/live-style/api/live-style-client'
import {
  buildLiveStyleCapApprovalOps,
  preferredLiveStyleSpendAuthMethod,
  spendAuthProofFromTxHash,
} from '@/features/live-style/wallet/spend-authorization'
import { LocalMockEchoTransport } from '@/features/live-style/transport/local-mock-transport'
import { useWalletContext } from '@/context/wallet-context'
import { useSmartWalletOps } from '@/hooks/use-smart-wallet-ops'

export function LiveStylePanel() {
  const enabled = isLiveStyleEnabledClient()
  const { getAccessToken, account, signerAddress, chain } = useWalletContext()
  const { sendOps, ready } = useSmartWalletOps()
  const [status, setStatus] = useState<string>('idle')

  const startMockSession = useCallback(async () => {
    if (!enabled || !account || !signerAddress) return
    setStatus('authorizing')
    const cap = LIVE_STYLE_CAP_PRESETS_USD[0]
    const ops = buildLiveStyleCapApprovalOps({ chainId: chain.id, capPresetUsd: cap })
    const { txHash } = await sendOps(ops)
    const proof = spendAuthProofFromTxHash(txHash)
    const token = await getAccessToken()
    if (!token) throw new Error('not signed in')
    setStatus('creating session')
    const created = await createLiveStyleSessionClient({
      accessToken: token,
      signerAddress,
      capPresetUsd: cap,
      spendAuthProof: proof,
      spendAuthMethod: preferredLiveStyleSpendAuthMethod(),
      providerId: 'mock',
    })
    const transport = new LocalMockEchoTransport()
    await transport.connect(created.connect)
    setStatus(`session ${created.sessionId} (mock transport ready)`)
    await transport.close()
  }, [enabled, account, signerAddress, chain.id, sendOps, getAccessToken])

  if (!enabled) return null

  return (
    <section className="rounded-md border border-border p-3 text-sm" data-testid="live-style-panel">
      <h2 className="font-medium">Live Style</h2>
      <p className="text-muted-foreground mt-1">
        Real-time camera restyle. Billed per minute from your balance at session rates.
      </p>
      <button
        type="button"
        className="mt-2 rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
        disabled={!ready}
        onClick={() => void startMockSession().catch((e) => setStatus(String(e)))}
      >
        Start (mock)
      </button>
      <p className="mt-2 text-xs text-muted-foreground">{status}</p>
    </section>
  )
}
