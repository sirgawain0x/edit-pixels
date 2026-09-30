import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { formatUnits, parseUnits } from 'viem'
import { useQueryClient } from '@tanstack/react-query'
import { base } from 'viem/chains'
import { useWalletContext } from '@/context/wallet-context'
import { useSmartWalletOps } from '@/hooks/use-smart-wallet-ops'
import { useUsdcBalance } from '@/hooks/use-usdc-balance'
import { useCrtvaiBalance } from '@/hooks/use-crtvai-balance'
import {
  CRTVAI_DECIMALS,
  USDC_DECIMALS,
  readCrtvaiCurrentPrice,
  readCrtvaiMintQuote,
} from '@/config/metoken'
import { buildBuyMetokenOps } from '@/features/metoken/api/buy-metoken'
import { moveUsdcToSmartWalletPreferGasless } from '@/hooks/usdc-wallet-transfers'
import { totalUsdcForPurchase } from '@/features/metoken/deps/credits-contract'
import {
  getErrorMessage,
  invalidateUsdcBalance,
  invalidateWalletTokenBalances,
} from '@/hooks/invalidate-wallet-balances'

const BASE_CHAIN_ID = base.id

export function useBuyMetokenForm(
  open: boolean,
  onOpenChange: (open: boolean) => void,
  initialUsdcAmount?: string,
) {
  const { account, signerAddress, chain, walletClient, switchChain } = useWalletContext()
  const queryClient = useQueryClient()
  const { sendOps, ready: walletReady } = useSmartWalletOps()
  const { balance: usdcBalance, formatted: usdcFormatted } = useUsdcBalance(chain, account)
  const { balance: signerUsdcBalance, formatted: signerUsdcFormatted } = useUsdcBalance(
    chain,
    signerAddress,
  )
  const { formatted: crtvaiFormatted, symbol } = useCrtvaiBalance(account)

  const [usdcInput, setUsdcInput] = useState('')
  const [estimatedOutput, setEstimatedOutput] = useState<string | null>(null)
  const [currentPrice, setCurrentPrice] = useState<string | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [minting, setMinting] = useState(false)
  const [transferring, setTransferring] = useState(false)

  const onBase = chain?.id === BASE_CHAIN_ID

  const requiredUsdc6 = useMemo(() => {
    if (!usdcInput || !onBase || !chain?.id) return 0
    try {
      const inputUsdc6 = Number(parseUnits(usdcInput, USDC_DECIMALS))
      return totalUsdcForPurchase(inputUsdc6, chain.id)
    } catch {
      return 0
    }
  }, [usdcInput, onBase, chain?.id])

  const hasSufficientUsdc = useMemo(() => {
    if (!usdcInput || !usdcBalance || requiredUsdc6 === 0) return true
    try {
      const balanceRaw = parseUnits(usdcBalance, USDC_DECIMALS)
      return BigInt(requiredUsdc6) <= balanceRaw
    } catch {
      return false
    }
  }, [usdcInput, usdcBalance, requiredUsdc6])

  const needsEoaTransfer = useMemo(() => {
    if (!onBase || !signerUsdcBalance || !usdcBalance || requiredUsdc6 === 0) return false
    try {
      const smartRaw = parseUnits(usdcBalance, USDC_DECIMALS)
      const eoaRaw = parseUnits(signerUsdcBalance, USDC_DECIMALS)
      return smartRaw < BigInt(requiredUsdc6) && eoaRaw > 0n
    } catch {
      return false
    }
  }, [onBase, signerUsdcBalance, usdcBalance, requiredUsdc6])

  useEffect(() => {
    if (!open) return
    if (initialUsdcAmount) setUsdcInput(initialUsdcAmount)
    if (!onBase) return
    let cancelled = false
    void (async () => {
      try {
        const price = await readCrtvaiCurrentPrice()
        if (!cancelled) {
          setCurrentPrice(formatUnits(price, USDC_DECIMALS))
        }
      } catch {
        // Price read failed — non-fatal
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, onBase, initialUsdcAmount])

  useEffect(() => {
    if (!open || !onBase || !usdcInput) {
      setEstimatedOutput(null)
      return
    }
    let usdcRaw: bigint
    try {
      usdcRaw = parseUnits(usdcInput, USDC_DECIMALS)
    } catch {
      setEstimatedOutput(null)
      return
    }
    if (usdcRaw <= 0n) {
      setEstimatedOutput(null)
      return
    }
    let cancelled = false
    setQuoting(true)
    const timer = window.setTimeout(async () => {
      try {
        const quote = await readCrtvaiMintQuote(usdcRaw)
        if (!cancelled) {
          setEstimatedOutput(formatUnits(quote, CRTVAI_DECIMALS))
        }
      } catch {
        if (!cancelled) setEstimatedOutput(null)
      } finally {
        if (!cancelled) setQuoting(false)
      }
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      if (!cancelled) setQuoting(false)
    }
  }, [open, onBase, usdcInput])

  const handleMoveUsdcToSmartWallet = useCallback(async () => {
    if (!walletClient || !account || !signerAddress || !signerUsdcBalance || !chain) return

    setTransferring(true)
    try {
      if (chain.id !== BASE_CHAIN_ID) {
        await switchChain(BASE_CHAIN_ID)
      }
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
    usdcBalance,
    requiredUsdc6,
    chain,
    switchChain,
    sendOps,
    queryClient,
  ])

  const handleMint = useCallback(async () => {
    if (!account || !usdcInput || !onBase) return
    let usdcRaw: bigint
    try {
      usdcRaw = parseUnits(usdcInput, USDC_DECIMALS)
    } catch {
      toast.error('Invalid USDC amount')
      return
    }
    if (usdcRaw <= 0n) {
      toast.error('Amount must be greater than 0')
      return
    }
    setMinting(true)
    try {
      const { ops } = buildBuyMetokenOps(usdcRaw, account)
      await sendOps(ops)
      toast.success(`Minted CRTVAI with ${usdcInput} USDC`)
      setUsdcInput('')
      onOpenChange(false)
      invalidateWalletTokenBalances(queryClient, chain?.id, account)
    } catch (error) {
      toast.error(`Mint failed: ${getErrorMessage(error)}`)
    } finally {
      setMinting(false)
    }
  }, [account, usdcInput, onBase, chain?.id, sendOps, onOpenChange, queryClient])

  const canMint =
    onBase && walletReady && usdcInput && hasSufficientUsdc && !quoting && !minting && !transferring

  return {
    usdcInput,
    setUsdcInput,
    estimatedOutput,
    currentPrice,
    quoting,
    minting,
    transferring,
    onBase,
    usdcFormatted,
    signerUsdcFormatted,
    crtvaiFormatted,
    symbol,
    hasSufficientUsdc,
    needsEoaTransfer,
    handleMoveUsdcToSmartWallet,
    handleMint,
    canMint,
  }
}
