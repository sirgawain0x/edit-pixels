import { useCallback, useState } from 'react'
import { Copy, Sparkles, Wallet } from 'lucide-react'
import { useWalletContext } from '@/context/wallet-context'
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
import { useUsdcBalance } from '@/hooks/use-usdc-balance'
import { useCrtvaiBalance } from '@/hooks/use-crtvai-balance'
import { BuyMetokenModal } from '@/features/metoken'
import { cn } from '@/shared/ui/cn'

function truncateAddress(address: string): string {
  if (address.length <= 10) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
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
  const { ready, authenticated, connect, disconnect, wallet, chain, switchChain, isConnecting } =
    useWalletContext()
  const address = wallet?.address
  const { formatted: usdcFormatted } = useUsdcBalance(chain, address as `0x${string}` | undefined)
  const { formatted: crtvaiFormatted, symbol: crtvaiSymbol } = useCrtvaiBalance(
    address as `0x${string}` | undefined,
  )
  const [copied, setCopied] = useState(false)
  const [buyMetokenOpen, setBuyMetokenOpen] = useState(false)

  const handleCopyAddress = useCallback(() => {
    if (!address) return
    void navigator.clipboard.writeText(address).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }, [address])

  const isInitializing = !ready || isConnecting
  const isConnected = Boolean(authenticated && wallet)

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
        aria-label={connectLabel}
      >
        <Wallet className="h-4 w-4 shrink-0" />
        {!compact && <span className="hidden sm:inline">{connectLabel}</span>}
      </Button>
    )
  }

  const displayText = address ? truncateAddress(address) : 'Connected'

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
          {address && (
            <DropdownMenuItem
              onClick={handleCopyAddress}
              className="flex cursor-pointer items-center justify-between gap-2 font-mono text-xs"
              aria-label="Copy full address"
            >
              <span>{truncateAddress(address)}</span>
              <Copy className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
              {copied && <span className="sr-only">Copied</span>}
            </DropdownMenuItem>
          )}

          <DropdownMenuItem disabled className="text-muted-foreground">
            USDC: {usdcFormatted}
          </DropdownMenuItem>

          <DropdownMenuItem disabled className="text-muted-foreground">
            {crtvaiSymbol}: {crtvaiFormatted}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setBuyMetokenOpen(true)}
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
                if (c) void switchChain(c.id)
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
          <DropdownMenuItem onClick={() => disconnect()}>Disconnect</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <BuyMetokenModal open={buyMetokenOpen} onOpenChange={setBuyMetokenOpen} />
    </>
  )
}
