'use client';

import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import {
  Copy,
  DollarSign,
  Send,
  Settings2,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { useWalletContext } from '@/context/wallet-context';
import { useBuyUsdcOnramp } from '@/hooks/use-buy-usdc-onramp';
import { useUnlockCheckout } from '@/hooks/use-unlock-checkout';
import { usePremiumMembership } from '@/features/live-ai/hooks/use-premium-membership';
import { BuyMetokenModal } from '@/features/metoken';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SWITCHABLE_CHAINS } from '@/config/alchemy';
import { formatSubscribeCta } from '@/shared/utils/currency-display';
import { SendUsdcModal } from '@/components/send-usdc-modal';
import { useUsdcBalance } from '@/hooks/use-usdc-balance';
import { useCrtvaiBalance } from '@/hooks/use-crtvai-balance';

function truncateAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

interface WalletConnectButtonProps {
  /** Override label when not connected (e.g. "Get Started" on homepage) */
  connectLabel?: string;
  /** Size variant for the button */
  size?: 'default' | 'sm' | 'lg' | 'icon';
  /** Show as icon-only on small screens when true */
  compact?: boolean;
  className?: string;
}

/**
 * Connect wallet button for navbar/toolbar.
 * When connected, shows truncated address with a disconnect dropdown.
 */
export function WalletConnectButton({
  connectLabel = 'Connect wallet',
  size = 'sm',
  compact = false,
  className,
}: WalletConnectButtonProps) {
  const navigate = useNavigate();
  const {
    ready,
    authenticated,
    connect,
    disconnect,
    wallet,
    chain,
    switchChain,
    isConnecting,
  } = useWalletContext();
  const address = wallet?.address as `0x${string}` | undefined;
  const { formatted: usdcFormatted } = useUsdcBalance(
    chain,
    address
  );
  const { formatted: crtvaiFormatted, symbol: crtvaiSymbol } =
    useCrtvaiBalance(address);
  const { openBuyUsdc, isLoading: isOnrampLoading, error: onrampError } =
    useBuyUsdcOnramp();
  const {
    openSubscribeCheckout,
    openManageSubscription,
    isConfigured: isUnlockConfigured,
  } = useUnlockCheckout();
  const { isPremiumMember, isPaidSubscriber } = usePremiumMembership(address);

  const [buyMetokenOpen, setBuyMetokenOpen] = useState(false);
  const [sendUsdcOpen, setSendUsdcOpen] = useState(false);

  useEffect(() => {
    if (onrampError) {
      toast.error('Buy USDC', { description: onrampError });
    }
  }, [onrampError]);

  const handleBuyUsdc = () => {
    void openBuyUsdc({ address: address ?? undefined });
  };

  const handleDisconnect = async () => {
    await disconnect();
    navigate({ to: '/' });
  };

  const handleCopyAddress = () => {
    if (address) {
      void navigator.clipboard.writeText(address);
    }
  };

  const isInitializing = !ready || isConnecting;
  const isConnected = Boolean(authenticated && wallet);

  if (isInitializing) {
    return (
      <Button variant="outline" size={size} className={className} disabled>
        Loading…
      </Button>
    );
  }

  if (!isConnected) {
    return (
      <Button
        variant="outline"
        size={size}
        className={className}
        onClick={() => connect()}
        aria-label={connectLabel}
      >
        <Wallet className="h-4 w-4 shrink-0" />
        {!compact && <span className="hidden sm:inline">{connectLabel}</span>}
      </Button>
    );
  }

  const displayText = address ? truncateAddress(address) : 'Connected';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size={size}
            className={className}
            aria-label="Wallet"
          >
            <Wallet className="h-4 w-4 shrink-0" />
            {!compact && (
              <span className="hidden sm:inline-flex sm:items-center sm:gap-2">
                <span>{displayText}</span>
                <span className="text-muted-foreground tabular-nums">
                  {crtvaiFormatted} {crtvaiSymbol}
                </span>
              </span>
            )}
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
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled className="text-muted-foreground">
            {crtvaiSymbol}: {crtvaiFormatted}
          </DropdownMenuItem>
          <DropdownMenuItem disabled className="text-muted-foreground">
            USDC: {usdcFormatted}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setBuyMetokenOpen(true)}
            className="flex cursor-pointer items-center gap-2"
            aria-label="Buy CRTVAI"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            Buy CRTVAI
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleBuyUsdc}
            disabled={isOnrampLoading}
            className="flex cursor-pointer items-center gap-2"
            aria-label="Buy USDC"
          >
            <DollarSign className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            {isOnrampLoading ? 'Opening…' : 'Buy USDC'}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setSendUsdcOpen(true)}
            className="flex cursor-pointer items-center gap-2"
            aria-label="Send USDC"
          >
            <Send className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            Send USDC
          </DropdownMenuItem>
          {isUnlockConfigured && !isPremiumMember && (
            <DropdownMenuItem
              onClick={openSubscribeCheckout}
              className="flex cursor-pointer items-center gap-2"
              aria-label="Subscribe to Pixels Premium"
            >
              <Sparkles
                className="h-3.5 w-3.5 shrink-0 opacity-70"
                aria-hidden
              />
              {formatSubscribeCta()}
            </DropdownMenuItem>
          )}
          {isUnlockConfigured && isPaidSubscriber && (
            <DropdownMenuItem
              onClick={openManageSubscription}
              className="flex cursor-pointer items-center gap-2"
              aria-label="Manage subscription"
            >
              <Settings2
                className="h-3.5 w-3.5 shrink-0 opacity-70"
                aria-hidden
              />
              Manage subscription
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <div className="px-2 py-1.5">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Network
            </label>
            <Select
              value={chain.id.toString()}
              onValueChange={(value) => {
                const c = SWITCHABLE_CHAINS.find(
                  (ch) => ch.id.toString() === value
                );
                if (c) void switchChain(c.id);
              }}
            >
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue placeholder="Select network" />
              </SelectTrigger>
              <SelectContent className="z-[10000]">
                {SWITCHABLE_CHAINS.map((c) => (
                  <SelectItem
                    key={c.id}
                    value={c.id.toString()}
                    className="text-xs"
                  >
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleDisconnect}>
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <BuyMetokenModal open={buyMetokenOpen} onOpenChange={setBuyMetokenOpen} />
      <SendUsdcModal open={sendUsdcOpen} onOpenChange={setSendUsdcOpen} />
    </>
  );
}