import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { isAddress, parseUnits } from 'viem'
import { useQueryClient } from '@tanstack/react-query'
import { base } from 'viem/chains'
import { useWalletContext } from '@/context/wallet-context'
import { useSmartWalletOps } from '@/hooks/use-smart-wallet-ops'
import { useUsdcBalance } from '@/hooks/use-usdc-balance'
import { useCrtvaiBalance } from '@/hooks/use-crtvai-balance'
import { getErrorMessage, invalidateUsdcBalance } from '@/hooks/invalidate-wallet-balances'
import { CRTVAI_DECIMALS, USDC_DECIMALS } from '@/config/metoken'
import { getPurchaseGasBufferUsdc6 } from '@/config/gas-sponsorship'
import { submitTokenSend, tokenSendErrorMessage } from '@/features/wallet/api/submit-token-send'
import { moveUsdcToSmartWalletPreferGasless } from '@/hooks/usdc-wallet-transfers'
import {
  computeMaxSendableWei,
  formatMaxSendAmount,
  hasInsufficientSendBalance,
  needsUsdcMoveToSmartWallet,
  parsePositiveAmountWei,
  type SendToken,
} from '@/features/wallet/lib/send-token-math'

const BASE_CHAIN_ID = base.id

export function useSendTokenForm(open: boolean, onOpenChange: (open: boolean) => void) {
  const { account, signerAddress, chain, walletClient, switchChain } = useWalletContext()
  const queryClient = useQueryClient()
  const { sendOps, ready: walletReady } = useSmartWalletOps()
  const { balance: usdcBalance, formatted: usdcFormatted } = useUsdcBalance(chain, account)
  const { balance: signerUsdcBalance } = useUsdcBalance(chain, signerAddress)
  const {
    balance: crtvaiBalance,
    formatted: crtvaiFormatted,
    symbol: crtvaiSymbol,
  } = useCrtvaiBalance(account)

  const [token, setToken] = useState<SendToken>('usdc')
  const [recipient, setRecipient] = useState('')
  const [amountInput, setAmountInput] = useState('')
  const [sending, setSending] = useState(false)
  const [transferring, setTransferring] = useState(false)

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

  const canSendFromSigner = useMemo(() => {
    if (token !== 'usdc' || !amountWei || !signerUsdcBalance || !onBase) return false
    try {
      const signerRaw = parseUnits(signerUsdcBalance, USDC_DECIMALS)
      return signerRaw >= amountWei && insufficientBalance
    } catch {
      return false
    }
  }, [token, amountWei, signerUsdcBalance, onBase, insufficientBalance])

  const needsMoveToSmartWallet = useMemo(
    () =>
      needsUsdcMoveToSmartWallet({
        onBase,
        token,
        amountWei,
        hasSmartAccount: Boolean(account),
        signerUsdcBalance,
        usdcBalance,
        gasBufferUsdc6,
        canSendFromSigner,
      }),
    [
      onBase,
      token,
      amountWei,
      account,
      signerUsdcBalance,
      usdcBalance,
      gasBufferUsdc6,
      canSendFromSigner,
    ],
  )

  const handleMax = useCallback(() => {
    setAmountInput(formatMaxSendAmount(maxSendableWei, decimals))
  }, [maxSendableWei, decimals])

  const handleMoveUsdcToSmartWallet = useCallback(async () => {
    if (!walletClient || !account || !signerAddress || !signerUsdcBalance || !chain || !amountWei)
      return

    setTransferring(true)
    try {
      if (chain.id !== BASE_CHAIN_ID) {
        await switchChain(BASE_CHAIN_ID)
      }
      const requiredUsdc6 = Number(amountWei + BigInt(gasBufferUsdc6))
      await moveUsdcToSmartWalletPreferGasless({
        walletClient,
        chain: base,
        smartAccount: account,
        signerAddress,
        signerUsdcBalance,
        smartUsdcBalance: usdcBalance,
        requiredUsdc6,
        sendOps,
      })
      toast.success('USDC moved to smart wallet')
      invalidateUsdcBalance(queryClient, BASE_CHAIN_ID, account)
      invalidateUsdcBalance(queryClient, BASE_CHAIN_ID, signerAddress)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setTransferring(false)
    }
  }, [
    walletClient,
    account,
    signerAddress,
    signerUsdcBalance,
    chain,
    switchChain,
    amountWei,
    gasBufferUsdc6,
    usdcBalance,
    sendOps,
    queryClient,
  ])

  const handleSend = useCallback(async () => {
    if (!chain || !amountWei || !recipientValid || sendToSelf) return
    if (!canSendFromSigner && !account) return

    setSending(true)
    try {
      await submitTokenSend({
        token,
        chain,
        amountWei,
        recipient,
        canSendFromSigner,
        walletClient,
        signerAddress,
        account,
        sendOps,
        queryClient,
        amountInput,
        tokenSymbol,
        onOpenChange,
        clearForm: () => {
          setRecipient('')
          setAmountInput('')
        },
      })
    } catch (error) {
      toast.error(tokenSendErrorMessage(error))
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
    canSendFromSigner,
    walletClient,
    signerAddress,
    token,
    sendOps,
    amountInput,
    tokenSymbol,
    onOpenChange,
    queryClient,
  ])

  const canSend =
    (walletReady || canSendFromSigner) &&
    recipientValid &&
    !sendToSelf &&
    amountWei !== null &&
    (!insufficientBalance || canSendFromSigner) &&
    !sending &&
    !transferring &&
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
    handleMoveUsdcToSmartWallet,
    canSend,
    canSendFromSigner,
    needsMoveToSmartWallet,
    transferring,
  }
}
