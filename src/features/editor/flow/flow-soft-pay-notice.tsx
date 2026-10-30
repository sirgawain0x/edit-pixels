import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

export type FlowSoftPayState = 'sign-in' | 'connecting-wallet' | 'treasury-not-configured'

export function resolveFlowSoftPayState(input: {
  canPayOnChain: boolean
  walletConfigured: boolean
  authenticated: boolean
  walletOpsReady: boolean
  hasTreasury: boolean
}): FlowSoftPayState | null {
  if (input.canPayOnChain) return null
  if (input.walletConfigured && !input.authenticated) return 'sign-in'
  if (input.authenticated && !input.walletOpsReady) return 'connecting-wallet'
  if (!input.hasTreasury) return 'treasury-not-configured'
  return null
}

export function FlowSoftPayNotice({
  canPayOnChain,
  walletConfigured,
  authenticated,
  walletOpsReady,
  hasTreasury,
  onSignIn,
}: {
  canPayOnChain: boolean
  walletConfigured: boolean
  authenticated: boolean
  walletOpsReady: boolean
  hasTreasury: boolean
  onSignIn: () => void
}) {
  const { t } = useTranslation()
  const state = resolveFlowSoftPayState({
    canPayOnChain,
    walletConfigured,
    authenticated,
    walletOpsReady,
    hasTreasury,
  })

  if (!state) return null

  if (state === 'sign-in') {
    return (
      <div className="mt-2 space-y-2">
        <p className="text-[10px] text-amber-200/90">
          {t('flow.softPay.signInPrompt', {
            defaultValue: 'Sign in to pay on-chain with CRTVAI.',
          })}
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8 w-full text-[11px]"
          onClick={onSignIn}
        >
          {t('flow.softPay.signIn', { defaultValue: 'Sign in' })}
        </Button>
      </div>
    )
  }

  if (state === 'connecting-wallet') {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-200/90">
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        {t('flow.softPay.connectingWallet', {
          defaultValue: 'Connecting your wallet…',
        })}
      </p>
    )
  }

  return (
    <p className="mt-2 text-[10px] text-amber-200/90">
      {t('flow.softPay.treasuryNotConfigured', {
        defaultValue: "Payments aren't configured on this build",
      })}
    </p>
  )
}
