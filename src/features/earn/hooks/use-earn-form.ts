import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createPublicClient,
  erc20Abi,
  http,
  parseAbi,
  parseUnits,
  type Address,
  type Chain,
} from 'viem'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useWalletContext } from '@/context/wallet-context'
import { useSmartWalletOps } from '@/hooks/use-smart-wallet-ops'
import { useUsdcBalance } from '@/hooks/use-usdc-balance'
import {
  getErrorMessage,
  invalidateUsdcBalance,
  invalidateWalletTokenBalances,
} from '@/hooks/invalidate-wallet-balances'
import { USDC_DECIMALS } from '@/config/metoken'
import { USDC_ADDRESS_BY_CHAIN_ID } from '@/config/chains'
import { ALCHEMY_API_KEY } from '@/config/alchemy'
import { getBasePublicClient } from '@/config/base-client'
import { buildErc20TransferOp } from '@/features/wallet/api/build-erc20-transfer-op'
import { parsePositiveAmountWei } from '@/features/wallet/lib/send-token-math'
import {
  pollEarnActionUntilSettled,
  postEarnDeposit,
  postEarnWithdraw,
} from '@/features/earn/api/earn-client'
import { useEarnVault } from '@/features/earn/hooks/use-earn-vault'
import { useEarnPosition } from '@/features/earn/hooks/use-earn-position'

export type EarnMode = 'deposit' | 'withdraw'

const ERC20_BALANCE_ABI = parseAbi(['function balanceOf(address account) view returns (uint256)'])

function formatApyPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${value.toFixed(2)}%`
}

function getRpcUrl(chain: Chain): string | undefined {
  const alchemyHttp = chain.rpcUrls?.alchemy?.http?.[0]
  const defaultHttp = chain.rpcUrls?.default?.http?.[0]
  if (alchemyHttp && ALCHEMY_API_KEY) {
    return `${alchemyHttp}/${ALCHEMY_API_KEY}`
  }
  return defaultHttp
}

async function readUsdcRawBalance(chain: Chain, address: Address): Promise<bigint> {
  const usdcAddress = USDC_ADDRESS_BY_CHAIN_ID[chain.id]
  if (!usdcAddress) return 0n
  const rpcUrl = getRpcUrl(chain)
  if (!rpcUrl) return 0n
  const client = createPublicClient({ chain, transport: http(rpcUrl) })
  return client.readContract({
    address: usdcAddress,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [address],
  })
}

export function useEarnForm(open: boolean) {
  const {
    account,
    signerAddress,
    chain,
    walletClient,
    getAccessToken,
    switchChain,
    smartAccountStatus,
  } = useWalletContext()
  const queryClient = useQueryClient()
  const { sendOps, ready: walletOpsReady } = useSmartWalletOps()
  const { balance: scaUsdcBalance, formatted: scaUsdcFormatted } = useUsdcBalance(chain, account)

  const vaultQuery = useEarnVault(open)
  const positionQuery = useEarnPosition(open)

  const [mode, setMode] = useState<EarnMode>('deposit')
  const [amountInput, setAmountInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setAmountInput('')
      setBusy(false)
      setStatusMessage(null)
      setMode('deposit')
    }
  }, [open])

  const vault = vaultQuery.data
  const position = positionQuery.data
  const vaultChainId = vault?.chainId ?? null
  const onVaultChain = vaultChainId === null || chain?.id === vaultChainId
  const smartReady = Boolean(account && signerAddress && smartAccountStatus === 'ready')
  const canOperate = smartReady && walletOpsReady && onVaultChain && !busy

  const amountWei = useMemo(() => parsePositiveAmountWei(amountInput, USDC_DECIMALS), [amountInput])

  const scaUsdcWei = useMemo(() => {
    if (!scaUsdcBalance) return 0n
    try {
      return parseUnits(scaUsdcBalance, USDC_DECIMALS)
    } catch {
      return 0n
    }
  }, [scaUsdcBalance])

  const positionWei = useMemo(() => {
    if (!position?.assetsInVault) return 0n
    try {
      return BigInt(position.assetsInVault)
    } catch {
      return 0n
    }
  }, [position?.assetsInVault])

  const insufficientDeposit = mode === 'deposit' && amountWei !== null && amountWei > scaUsdcWei
  const insufficientWithdraw = mode === 'withdraw' && amountWei !== null && amountWei > positionWei

  const invalidateEarn = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['earn-position'] })
    void queryClient.invalidateQueries({ queryKey: ['earn-vault'] })
    if (account && chain) {
      invalidateUsdcBalance(queryClient, chain.id, account)
      invalidateWalletTokenBalances(queryClient, chain.id, account)
    }
    if (signerAddress && chain) {
      invalidateUsdcBalance(queryClient, chain.id, signerAddress)
    }
  }, [account, chain, queryClient, signerAddress])

  const handleMax = useCallback(() => {
    if (mode === 'deposit') {
      setAmountInput(scaUsdcBalance && Number(scaUsdcBalance) > 0 ? scaUsdcBalance : '')
      return
    }
    setAmountInput(position?.assetsInVaultFormatted ?? '')
  }, [mode, position?.assetsInVaultFormatted, scaUsdcBalance])

  const ensureVaultChain = useCallback(async () => {
    if (vaultChainId !== null && chain?.id !== vaultChainId) {
      await switchChain(vaultChainId)
    }
  }, [chain?.id, switchChain, vaultChainId])

  const transferScaToEoa = useCallback(
    async (wei: bigint) => {
      if (!account || !signerAddress || !chain) {
        throw new Error('Wallet not ready')
      }
      const tokenAddress = USDC_ADDRESS_BY_CHAIN_ID[chain.id]
      if (!tokenAddress) throw new Error('USDC not available on this network')
      setStatusMessage('Moving USDC to Privy wallet…')
      const op = buildErc20TransferOp(tokenAddress, signerAddress, wei)
      await sendOps([op])
    },
    [account, chain, sendOps, signerAddress],
  )

  const sweepEoaToSca = useCallback(async () => {
    if (!account || !signerAddress || !chain || !walletClient) return
    setStatusMessage('Returning USDC to smart wallet…')
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    const raw = await readUsdcRawBalance(chain, signerAddress)
    if (raw <= 0n) return
    const usdcAddress = USDC_ADDRESS_BY_CHAIN_ID[chain.id]
    if (!usdcAddress) return
    const hash = await walletClient.writeContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [account, raw],
      chain,
      account: signerAddress,
    })
    // Base has a dedicated client; other chains wait via the same RPC used for balances.
    if (chain.id === 8453) {
      await getBasePublicClient().waitForTransactionReceipt({ hash })
    } else {
      const rpcUrl = getRpcUrl(chain)
      if (rpcUrl) {
        const client = createPublicClient({ chain, transport: http(rpcUrl) })
        await client.waitForTransactionReceipt({ hash })
      }
    }
  }, [account, chain, signerAddress, walletClient])

  const submitDeposit = useCallback(async () => {
    if (!amountWei || !amountInput || insufficientDeposit) return
    setBusy(true)
    try {
      await ensureVaultChain()
      await transferScaToEoa(amountWei)
      setStatusMessage('Depositing into vault…')
      const token = await getAccessToken()
      if (!token) throw new Error('Not authenticated')
      const action = await postEarnDeposit(token, amountInput.trim())
      setStatusMessage('Confirming deposit…')
      const settled = await pollEarnActionUntilSettled(token, action.id)
      if (settled.status === 'succeeded') {
        toast.success(`Deposited ${amountInput} USDC into Earn`)
        setAmountInput('')
      } else if (settled.status === 'rejected') {
        toast.error(settled.failureMessage ?? 'Deposit rejected — you can retry')
      } else {
        toast.error(settled.failureMessage ?? 'Deposit failed')
      }
      invalidateEarn()
    } catch (error) {
      toast.error(`Earn deposit failed: ${getErrorMessage(error)}`)
    } finally {
      setBusy(false)
      setStatusMessage(null)
    }
  }, [
    amountInput,
    amountWei,
    ensureVaultChain,
    getAccessToken,
    insufficientDeposit,
    invalidateEarn,
    transferScaToEoa,
  ])

  const submitWithdraw = useCallback(async () => {
    const isMax =
      Boolean(position?.assetsInVaultFormatted) &&
      amountInput.trim() === position?.assetsInVaultFormatted
    if (!isMax && (!amountWei || insufficientWithdraw)) return
    setBusy(true)
    try {
      await ensureVaultChain()
      setStatusMessage('Withdrawing from vault…')
      const token = await getAccessToken()
      if (!token) throw new Error('Not authenticated')
      const action = isMax
        ? await postEarnWithdraw(token, { max: true })
        : await postEarnWithdraw(token, { amount: amountInput.trim() })
      setStatusMessage('Confirming withdrawal…')
      const settled = await pollEarnActionUntilSettled(token, action.id)
      if (settled.status === 'succeeded') {
        try {
          await sweepEoaToSca()
        } catch (sweepError) {
          console.error('earn sweep to SCA failed', sweepError)
          toast.message('Withdraw succeeded; USDC may still be on your Privy wallet')
        }
        toast.success('Withdrew from Earn')
        setAmountInput('')
      } else if (settled.status === 'rejected') {
        toast.error(settled.failureMessage ?? 'Withdraw rejected — you can retry')
      } else {
        toast.error(settled.failureMessage ?? 'Withdraw failed')
      }
      invalidateEarn()
    } catch (error) {
      toast.error(`Earn withdraw failed: ${getErrorMessage(error)}`)
    } finally {
      setBusy(false)
      setStatusMessage(null)
    }
  }, [
    amountInput,
    amountWei,
    ensureVaultChain,
    getAccessToken,
    insufficientWithdraw,
    invalidateEarn,
    position?.assetsInVaultFormatted,
    sweepEoaToSca,
  ])

  const submit = useCallback(async () => {
    if (mode === 'deposit') {
      await submitDeposit()
      return
    }
    await submitWithdraw()
  }, [mode, submitDeposit, submitWithdraw])

  return {
    mode,
    setMode,
    amountInput,
    setAmountInput,
    busy,
    statusMessage,
    canOperate,
    smartReady,
    onVaultChain,
    vaultChainId,
    vault,
    vaultLoading: vaultQuery.isLoading,
    vaultError: vaultQuery.isError,
    position,
    positionLoading: positionQuery.isLoading,
    scaUsdcFormatted,
    apyLabel: formatApyPercent(vault?.userApyPercent ?? null),
    insufficientDeposit,
    insufficientWithdraw,
    handleMax,
    submit,
    ensureVaultChain,
    amountValid: amountWei !== null,
  }
}
