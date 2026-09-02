import { useCallback, useState } from 'react'
import type { Address, Chain } from 'viem'
import {
  AlertTriangle,
  ArrowUpRight,
  Copy,
  DollarSign,
  QrCode,
  Sparkles,
  Wallet,
} from 'lucide-react'
import type { SmartAccountStatus } from '@/context/wallet-context'
import { useWalletContext } from '@/context/wallet-context'
import { useUsdcBalance } from '@/hooks/use-usdc-balance'
import { useCrtvaiBalance } from '@/hooks/use-crtvai-balance'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SWITCHABLE_CHAINS } from '@/config/chains'
import { BuyUsdcOnrampModal } from '@/features/onramp'
import { BuyCreditsModal } from '@/features/credits'
import { ReceiveFundsModal, SendTokenModal } from '@/features/wallet'
import { cn } from '@/shared/ui/cn'

function truncateAddress(address: string): string {
  if (address.length <= 10) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function getWalletDisplayText(
  account: Address | undefined,
  signerAddress: Address | undefined,
): string {
  if (account) return truncateAddress(account)
  if (signerAddress) return truncateAddress(signerAddress)
  return 'Connected'
}

interface WalletAddressMenuItemProps {
  account: Address | undefined
  isProvisioningSmartAccount: boolean
  copied: boolean
  onCopy: () => void
}

function WalletAddressMenuItem({
  account,
  isProvisioningSmartAccount,
  copied,
  onCopy,
}: WalletAddressMenuItemProps) {
  if (account) {
    return (
      <DropdownMenuItem
        onClick={onCopy}
        className="flex cursor-pointer items-center justify-between gap-2 font-mono text-xs"
        aria-label="Copy smart wallet address"
      >
        <span>{truncateAddress(account)}</span>
        <Copy className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        {copied && <span className="sr-only">Copied</span>}
      </DropdownMenuItem>
    )
  }

  if (isProvisioningSmartAccount) {
    return (
      <DropdownMenuItem disabled className="text-xs text-muted-foreground">
        Smart wallet setting up…
      </DropdownMenuItem>
    )
  }

  return null
}

interface ConnectedWalletMenuProps {
  account: Address | undefined
  signerAddress: Address | undefined
  smartAccountStatus: SmartAccountStatus
  isProvisioningSmartAccount: boolean
  smartAccountActionsReady: boolean
  error: Error | null
  chain: Chain
  usdcFormatted: string
  crtvaiFormatted: string
  crtvaiSymbol: string
  size: 'default' | 'sm' | 'lg' | 'icon'
  compact: boolean
  className?: string
  onRetrySmartAccount: () => void
  onSwitchChain: (chainId: number) => Promise<void>
  onDisconnect: () => Promise<void>
}

function ConnectedWalletMenu({
  account,
  signerAddress,
  smartAccountStatus,
  isProvisioningSmartAccount,
  smartAccountActionsReady,
  error,
  chain,
  usdcFormatted,
  crtvaiFormatted,
  crtvaiSymbol,
  size,
  compact,
  className,
  onRetrySmartAccount,
  onSwitchChain,
  onDisconnect,
}: ConnectedWalletMenuProps) {
  const [copied, setCopied] = useState(false)
  const [buyCreditsOpen, setBuyCreditsOpen] = useState(false)
  const [buyOnrampOpen, setBuyOnrampOpen] = useState(false)
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)

  const handleCopyAddress = useCallback(() => {
    if (!account) return
    void navigator.clipboard.writeText(account).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }, [account])

  const displayText = getWalletDisplayText(account, signerAddress)
  const smartAccountFailed = smartAccountStatus === 'error'

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size={size}
            className={cn('gap-2', className)}
            aria-label="Wallet"
          >
            <Wallet className="h-4 w-4 shrink-0" />
            {!compact && <span className="hidden sm:inline">{displayText}</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[12rem]">
          {smartAccountFailed && (
            <DropdownMenuItem
              onClick={onRetrySmartAccount}
              className="flex cursor-pointer items-start gap-2 text-destructive"
              aria-label="Retry smart wallet setup"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="text-xs">
                Smart wallet setup failed
                {error?.message ? `: ${error.message}` : ''}. Tap to retry.
              </span>
            </DropdownMenuItem>
          )}

          <WalletAddressMenuItem
            account={account}
            isProvisioningSmartAccount={isProvisioningSmartAccount}
            copied={copied}
            onCopy={handleCopyAddress}
          />

          <DropdownMenuItem disabled className="text-muted-foreground">
            USDC: {usdcFormatted}
          </DropdownMenuItem>

          <DropdownMenuItem disabled className="text-muted-foreground">
            {crtvaiSymbol}: {crtvaiFormatted}
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => setReceiveOpen(true)}
            disabled={!smartAccountActionsReady}
            className="flex cursor-pointer items-center gap-2"
            aria-label="Receive funds"
          >
            <QrCode className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            Receive
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => setSendOpen(true)}
            disabled={!smartAccountActionsReady}
            className="flex cursor-pointer items-center gap-2"
            aria-label="Send tokens"
          >
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            Send
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => setBuyOnrampOpen(true)}
            disabled={!smartAccountActionsReady}
            className="flex cursor-pointer items-center gap-2"
            aria-label="Buy USDC"
          >
            <DollarSign className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            Buy USDC
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => setBuyCreditsOpen(true)}
            disabled={!smartAccountActionsReady}
            className="flex cursor-pointer items-center gap-2"
            aria-label="Buy CRTVAI"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            Buy CRTVAI
          </DropdownMenuItem>

          <div className="px-2 py-1.5">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Network
            </label>
            <Select
              value={chain.id.toString()}
              onValueChange={(value) => {
                const c = SWITCHABLE_CHAINS.find((ch) => ch.id.toString() === value)
                if (c) void onSwitchChain(c.id)
              }}
            >
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue placeholder="Select network" />
              </SelectTrigger>
              <SelectContent className="z-[10000]">
                {SWITCHABLE_CHAINS.map((c) => (
                  <SelectItem key={c.id} value={c.id.toString()} className="text-xs">
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void onDisconnect()}>Disconnect</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <BuyCreditsModal open={buyCreditsOpen} onOpenChange={setBuyCreditsOpen} />
      <BuyUsdcOnrampModal open={buyOnrampOpen} onOpenChange={setBuyOnrampOpen} />
      <ReceiveFundsModal open={receiveOpen} onOpenChange={setReceiveOpen} />
      <SendTokenModal open={sendOpen} onOpenChange={setSendOpen} />
    </>
  )
}

interface WalletConnectButtonProps {
  connectLabel?: string
  size?: 'default' | 'sm' | 'lg' | 'icon'
  compact?: boolean
  className?: string
}

export function WalletConnectButton({
  connectLabel = 'Connect wallet',
  size = 'sm',
  compact = false,
  className,
}: WalletConnectButtonProps) {
  const {
    ready,
    authenticated,
    configured,
    connect,
    disconnect,
    account,
    signerAddress,
    smartAccountStatus,
    retrySmartAccount,
    chain,
    switchChain,
    error,
    isProvisioningSmartAccount,
  } = useWalletContext()
  const displayAddress = account ?? signerAddress
  const { formatted: usdcFormatted } = useUsdcBalance(chain, account)
  const { formatted: crtvaiFormatted, symbol: crtvaiSymbol } = useCrtvaiBalance(account)

  const isInitializing = configured && !ready
  const isConnected = Boolean(authenticated && displayAddress)
  const smartAccountActionsReady = Boolean(account)

  if (isInitializing) {
    return (
      <Button variant="outline" size={size} className={className} disabled>
        Loading…
      </Button>
    )
  }

  if (!isConnected) {
    return (
      <Button
        variant="outline"
        size={size}
        className={cn('gap-2', className)}
        onClick={() => connect()}
        aria-label={configured ? connectLabel : 'Wallet auth not configured'}
        title={configured ? undefined : 'Set VITE_PRIVY_APP_ID to enable wallet connect'}
      >
        <Wallet className="h-4 w-4 shrink-0" />
        {!compact && <span className="hidden sm:inline">{connectLabel}</span>}
      </Button>
    )
  }

  return (
    <ConnectedWalletMenu
      account={account}
      signerAddress={signerAddress}
      smartAccountStatus={smartAccountStatus}
      isProvisioningSmartAccount={isProvisioningSmartAccount}
      smartAccountActionsReady={smartAccountActionsReady}
      error={error}
      chain={chain}
      usdcFormatted={usdcFormatted}
      crtvaiFormatted={crtvaiFormatted}
      crtvaiSymbol={crtvaiSymbol}
      size={size}
      compact={compact}
      className={className}
      onRetrySmartAccount={retrySmartAccount}
      onSwitchChain={switchChain}
      onDisconnect={disconnect}
    />
  )
}
