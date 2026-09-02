import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { isAddress } from 'viem'
import { useQueryClient } from '@tanstack/react-query'
import { base } from 'viem/chains'
import { useWalletContext } from '@/context/wallet-context'
import { useSmartWalletOps } from '@/hooks/use-smart-wallet-ops'
import { useUsdcBalance } from '@/hooks/use-usdc-balance'
import { useCrtvaiBalance } from '@/hooks/use-crtvai-balance'
import { getErrorMessage, invalidateWalletTokenBalances } from '@/hooks/invalidate-wallet-balances'
import { USDC_ADDRESS_BY_CHAIN_ID } from '@/config/chains'
import { CRTVAI_DECIMALS, CRTVAI_METOKEN_ADDRESS, USDC_DECIMALS } from '@/config/metoken'
import { getPurchaseGasBufferUsdc6 } from '@/config/gas-sponsorship'
import { buildErc20TransferOp } from '@/features/wallet/api/build-erc20-transfer-op'
import {
  computeMaxSendableWei,
  formatMaxSendAmount,
  hasInsufficientSendBalance,
  parsePositiveAmountWei,
  type SendToken,
} from '@/features/wallet/lib/send-token-math'

const BASE_CHAIN_ID = base.id

function truncateTxHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`
}

export function useSendTokenForm(open: boolean, onOpenChange: (open: boolean) => void) {
  const { account, chain } = useWalletContext()
  const queryClient = useQueryClient()
  const { sendOps, ready: walletReady } = useSmartWalletOps()
  const { balance: usdcBalance, formatted: usdcFormatted } = useUsdcBalance(chain, account)
  const {
    balance: crtvaiBalance,
    formatted: crtvaiFormatted,
    symbol: crtvaiSymbol,
  } = useCrtvaiBalance(account)

  const [token, setToken] = useState<SendToken>('usdc')
  const [recipient, setRecipient] = useState('')
  const [amountInput, setAmountInput] = useState('')
  const [sending, setSending] = useState(false)

  const onBase = chain?.id === BASE_CHAIN_ID
  const crtvaiAvailable = onBase
  const decimals = token === 'usdc' ? USDC_DECIMALS : CRTVAI_DECIMALS
  const balanceFormatted = token === 'usdc' ? usdcFormatted : crtvaiFormatted
  const tokenSymbol = token === 'usdc' ? 'USDC' : crtvaiSymbol
  const gasBufferUsdc6 = chain?.id ? getPurchaseGasBufferUsdc6(chain.id) : 0

  useEffect(() => {
    if (!open) {
      setRecipient('')
      setAmountInput('')
      setSending(false)
    }
  }, [open])

  useEffect(() => {
    if (token === 'crtvai' && !crtvaiAvailable) {
      setToken('usdc')
    }
  }, [token, crtvaiAvailable])

  const maxSendableWei = useMemo(
    () => computeMaxSendableWei(token, usdcBalance, crtvaiBalance, gasBufferUsdc6),
    [token, crtvaiBalance, usdcBalance, gasBufferUsdc6],
  )

  const amountWei = useMemo(
    () => parsePositiveAmountWei(amountInput, decimals),
    [amountInput, decimals],
  )

  const recipientValid = isAddress(recipient)
  const sendToSelf = recipientValid && account && recipient.toLowerCase() === account.toLowerCase()
  const insufficientBalance = useMemo(
    () =>
      amountWei
        ? hasInsufficientSendBalance(token, amountWei, usdcBalance, crtvaiBalance, gasBufferUsdc6)
        : false,
    [amountWei, token, crtvaiBalance, usdcBalance, gasBufferUsdc6],
  )

  const handleMax = useCallback(() => {
    setAmountInput(formatMaxSendAmount(maxSendableWei, decimals))
  }, [maxSendableWei, decimals])

  const handleSend = useCallback(async () => {
    if (!account || !chain || !amountWei || !recipientValid || sendToSelf) return

    const tokenAddress =
      token === 'usdc' ? USDC_ADDRESS_BY_CHAIN_ID[chain.id] : CRTVAI_METOKEN_ADDRESS
    if (!tokenAddress) {
      toast.error('Token not available on this network')
      return
    }

    setSending(true)
    try {
      const op = buildErc20TransferOp(tokenAddress, recipient, amountWei)
      const { txHash } = await sendOps([op])
      toast.success(`Sent ${amountInput} ${tokenSymbol} · ${truncateTxHash(txHash)}`)
      setRecipient('')
      setAmountInput('')
      onOpenChange(false)
      invalidateWalletTokenBalances(queryClient, chain.id, account)
    } catch (error) {
      toast.error(`Send failed: ${getErrorMessage(error)}`)
    } finally {
      setSending(false)
    }
  }, [
    account,
    chain,
    amountWei,
    recipient,
    recipientValid,
    sendToSelf,
    token,
    sendOps,
    amountInput,
    tokenSymbol,
    onOpenChange,
    queryClient,
  ])

  const canSend =
    walletReady &&
    recipientValid &&
    !sendToSelf &&
    amountWei !== null &&
    !insufficientBalance &&
    !sending &&
    (token !== 'crtvai' || onBase)

  return {
    token,
    setToken,
    recipient,
    setRecipient,
    amountInput,
    setAmountInput,
    sending,
    crtvaiAvailable,
    balanceFormatted,
    tokenSymbol,
    gasBufferUsdc6,
    maxSendableWei,
    recipientValid,
    sendToSelf,
    insufficientBalance,
    onBase,
    handleMax,
    handleSend,
    canSend,
  }
}
