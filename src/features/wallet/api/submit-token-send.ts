import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  getErrorMessage,
  invalidateUsdcBalance,
  invalidateWalletTokenBalances,
} from '@/hooks/invalidate-wallet-balances'
import {
  executeTokenSend,
  type ExecuteTokenSendParams,
} from '@/features/wallet/api/execute-token-send'

function truncateTxHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`
}

export async function submitTokenSend(
  params: ExecuteTokenSendParams & {
    queryClient: QueryClient
    amountInput: string
    tokenSymbol: string
    onOpenChange: (open: boolean) => void
    clearForm: () => void
  },
): Promise<void> {
  const { queryClient, amountInput, tokenSymbol, onOpenChange, clearForm, chain, ...sendParams } =
    params

  const { usedSigner, txHash } = await executeTokenSend({ chain, ...sendParams })
  const successSuffix = txHash ? ` · ${truncateTxHash(txHash)}` : ''
  toast.success(
    usedSigner
      ? `Sent ${amountInput} ${tokenSymbol} from signer wallet`
      : `Sent ${amountInput} ${tokenSymbol}${successSuffix}`,
  )
  clearForm()
  onOpenChange(false)

  if (usedSigner && sendParams.signerAddress) {
    invalidateUsdcBalance(queryClient, chain.id, sendParams.signerAddress)
  }
  if (sendParams.account) {
    invalidateUsdcBalance(queryClient, chain.id, sendParams.account)
    if (!usedSigner) {
      invalidateWalletTokenBalances(queryClient, chain.id, sendParams.account)
    }
  }
}

export function tokenSendErrorMessage(error: unknown): string {
  return `Send failed: ${getErrorMessage(error)}`
}
