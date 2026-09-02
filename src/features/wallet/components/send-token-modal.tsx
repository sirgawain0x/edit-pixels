import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatUnits, isAddress, parseUnits } from 'viem'
import { useQueryClient } from '@tanstack/react-query'
import { base } from 'viem/chains'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useWalletContext } from '@/context/wallet-context'
import { useSmartWalletOps } from '@/hooks/use-smart-wallet-ops'
import { useUsdcBalance } from '@/hooks/use-usdc-balance'
import { useCrtvaiBalance } from '@/hooks/use-crtvai-balance'
import { USDC_ADDRESS_BY_CHAIN_ID } from '@/config/chains'
import { CRTVAI_DECIMALS, CRTVAI_METOKEN_ADDRESS, USDC_DECIMALS } from '@/config/metoken'
import { getPurchaseGasBufferUsdc6 } from '@/config/gas-sponsorship'
import { buildErc20TransferOp } from '@/features/wallet/api/build-erc20-transfer-op'
import { cn } from '@/shared/ui/cn'

type SendToken = 'usdc' | 'crtvai'

interface SendTokenModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const BASE_CHAIN_ID = base.id

function truncateTxHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`
}

export function SendTokenModal({ open, onOpenChange }: SendTokenModalProps) {
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

  const decimals = token === 'usdc' ? USDC_DECIMALS : CRTVAI_DECIMALS
  const balanceFormatted = token === 'usdc' ? usdcFormatted : crtvaiFormatted
  const tokenSymbol = token === 'usdc' ? 'USDC' : crtvaiSymbol

  const gasBufferUsdc6 = chain?.id ? getPurchaseGasBufferUsdc6(chain.id) : 0

  const maxSendableWei = useMemo(() => {
    if (token === 'crtvai') {
      return crtvaiBalance ?? 0n
    }
    if (!usdcBalance) return 0n
    try {
      const balanceRaw = parseUnits(usdcBalance, USDC_DECIMALS)
      const buffer = BigInt(gasBufferUsdc6)
      return balanceRaw > buffer ? balanceRaw - buffer : 0n
    } catch {
      return 0n
    }
  }, [token, crtvaiBalance, usdcBalance, gasBufferUsdc6])

  const amountWei = useMemo(() => {
    if (!amountInput) return null
    try {
      const raw = parseUnits(amountInput, decimals)
      return raw > 0n ? raw : null
    } catch {
      return null
    }
  }, [amountInput, decimals])

  const recipientValid = isAddress(recipient)
  const sendToSelf = recipientValid && account && recipient.toLowerCase() === account.toLowerCase()

  const insufficientBalance = useMemo(() => {
    if (!amountWei) return false
    if (token === 'crtvai') {
      return (crtvaiBalance ?? 0n) < amountWei
    }
    if (!usdcBalance) return true
    try {
      const balanceRaw = parseUnits(usdcBalance, USDC_DECIMALS)
      const required = amountWei + BigInt(gasBufferUsdc6)
      return balanceRaw < required
    } catch {
      return true
    }
  }, [amountWei, token, crtvaiBalance, usdcBalance, gasBufferUsdc6])

  const handleMax = useCallback(() => {
    if (maxSendableWei <= 0n) {
      setAmountInput('0')
      return
    }
    setAmountInput(formatUnits(maxSendableWei, decimals))
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
      void queryClient.invalidateQueries({ queryKey: ['usdc-balance', chain.id, account] })
      void queryClient.invalidateQueries({ queryKey: ['crtvai-balance', account] })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(`Send failed: ${msg}`)
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpRight className="h-5 w-5" aria-hidden />
            Send tokens
          </DialogTitle>
          <DialogDescription>
            Send USDC or CRTVAI from your smart wallet to another address.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label htmlFor="send-token" className="text-sm font-medium">
              Token
            </label>
            <Select
              value={token}
              onValueChange={(value) => setToken(value as SendToken)}
              disabled={sending}
            >
              <SelectTrigger id="send-token" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="usdc">USDC</SelectItem>
                {crtvaiAvailable && <SelectItem value="crtvai">CRTVAI</SelectItem>}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Available:</span>
            <span className="font-medium">
              {balanceFormatted} {tokenSymbol}
            </span>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="send-recipient" className="text-sm font-medium">
              Recipient address
            </label>
            <Input
              id="send-recipient"
              placeholder="0x…"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value.trim())}
              disabled={sending}
              className="font-mono text-xs"
            />
            {recipient && !recipientValid && (
              <p className="text-xs text-destructive">Enter a valid Ethereum address.</p>
            )}
            {sendToSelf && (
              <p className="text-xs text-destructive">Cannot send to your own wallet.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="send-amount" className="text-sm font-medium">
                Amount
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={handleMax}
                disabled={sending || maxSendableWei <= 0n}
              >
                Max
              </Button>
            </div>
            <Input
              id="send-amount"
              type="number"
              min="0"
              step={token === 'usdc' ? '0.01' : '0.0001'}
              placeholder="0.00"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              disabled={sending}
            />
            {token === 'usdc' && gasBufferUsdc6 > 0 && (
              <p className="text-xs text-muted-foreground">
                A small USDC reserve is kept for transaction gas.
              </p>
            )}
            {insufficientBalance && amountInput && (
              <p className="text-xs text-destructive">Insufficient balance.</p>
            )}
          </div>

          {!onBase && token === 'crtvai' && (
            <p className="text-xs text-amber-500">Switch to Base network to send CRTVAI.</p>
          )}

          <Button
            onClick={() => void handleSend()}
            disabled={!canSend}
            className={cn('w-full', sending && 'opacity-80')}
          >
            {sending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : (
              `Send ${tokenSymbol}`
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
