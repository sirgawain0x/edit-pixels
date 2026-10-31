import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { SmartAccountStatus } from '@/context/wallet-context'

export type FlowSoftPayState =
  | 'initializing-wallet'
  | 'sign-in'
  | 'connecting-wallet'
  | 'wallet-error'
  | 'treasury-not-configured'

export function resolveFlowSoftPayState(input: {
  canPayOnChain: boolean
  walletConfigured: boolean
  walletReady: boolean
  authenticated: boolean
  walletOpsReady: boolean
  smartAccountStatus: SmartAccountStatus
  hasTreasury: boolean
}): FlowSoftPayState | null {
  if (input.canPayOnChain) return null
  if (input.walletConfigured && !input.walletReady) return 'initializing-wallet'
  if (input.walletConfigured && !input.authenticated) return 'sign-in'
  if (input.authenticated && !input.walletOpsReady && input.smartAccountStatus === 'error') {
    return 'wallet-error'
  }
  if (input.authenticated && !input.walletOpsReady) return 'connecting-wallet'
  if (!input.hasTreasury) return 'treasury-not-configured'
  return null
}

export function FlowSoftPayNotice({
  canPayOnChain,
  walletConfigured,
  walletReady,
  authenticated,
  walletOpsReady,
  smartAccountStatus,
  hasTreasury,
  onSignIn,
  onRetryWallet,
}: {
  canPayOnChain: boolean
  walletConfigured: boolean
  walletReady: boolean
  authenticated: boolean
  walletOpsReady: boolean
  smartAccountStatus: SmartAccountStatus
  hasTreasury: boolean
  onSignIn: () => void
  onRetryWallet: () => void
}) {
  const { t } = useTranslation()
  const state = resolveFlowSoftPayState({
    canPayOnChain,
    walletConfigured,
    walletReady,
    authenticated,
    walletOpsReady,
    smartAccountStatus,
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

  if (state === 'wallet-error') {
    return (
      <div className="mt-2 space-y-2">
        <p role="alert" className="text-[10px] text-amber-200/90">
          {t('flow.softPay.walletError', {
            defaultValue: "We couldn't connect your wallet. Try again.",
          })}
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8 w-full text-[11px]"
          onClick={onRetryWallet}
        >
          {t('flow.softPay.retryWallet', { defaultValue: 'Retry wallet connection' })}
        </Button>
      </div>
    )
  }

  if (state === 'initializing-wallet' || state === 'connecting-wallet') {
    return (
      <p role="status" className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-200/90">
        <Loader2 aria-hidden="true" className="h-3 w-3 shrink-0 animate-spin" />
        {state === 'initializing-wallet'
          ? t('flow.softPay.loadingWallet', { defaultValue: 'Loading your wallet…' })
          : t('flow.softPay.connectingWallet', {
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
