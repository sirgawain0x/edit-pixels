'use client';

import {
  useAccount,
  useAuthModal,
  useChain,
  useLogout,
  useSignerStatus,
  useUser,
} from '@account-kit/react';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Copy, DollarSign, Gift, Settings2, Sparkles, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { useBuyUsdcOnramp } from '@/hooks/use-buy-usdc-onramp';
import { useUnlockCheckout } from '@/hooks/use-unlock-checkout';
import { usePremiumMembership } from '@/features/live-ai/hooks/use-premium-membership';
import {
  BuyCreditsModal,
  CreditBalanceBadge,
  RedeemPromoModal,
  useCredits,
} from '@/features/credits';
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
import { alchemyConfig, SWITCHABLE_CHAINS } from '@/config/alchemy';
import { canAffordAnyCreditPack } from '@/features/credits/usdc-for-purchase';
import { formatSubscribeCta } from '@/shared/utils/currency-display';
import { useUsdcBalance } from '@/hooks/use-usdc-balance';

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
 * Connect wallet button for navbar/toolbar. Renders nothing when Alchemy is not configured.
 * When connected, shows truncated address with a disconnect dropdown.
 */
export function WalletConnectButton({
  connectLabel = 'Connect wallet',
  size = 'sm',
  compact = false,
  className,
}: WalletConnectButtonProps) {
  if (!alchemyConfig) return null;

  return (
    <WalletConnectButtonInner
      connectLabel={connectLabel}
      size={size}
      compact={compact}
      className={className}
    />
  );
}

function WalletConnectButtonInner({
  connectLabel,
  size,
  compact,
  className,
}: WalletConnectButtonProps) {
  const navigate = useNavigate();
  const user = useUser();
  const { openAuthModal } = useAuthModal();
  const signerStatus = useSignerStatus();
  const { logout } = useLogout();
  const { address } = useAccount({ type: 'LightAccount' });
  const { chain, setChain, isSettingChain } = useChain();
  const { balance: usdcBalance, formatted: usdcFormatted } = useUsdcBalance(
    chain,
    address as `0x${string}` | undefined
  );
  const { openBuyUsdc, isLoading: isOnrampLoading, error: onrampError } = useBuyUsdcOnramp();
  const {
    openSubscribeCheckout,
    openManageSubscription,
    isConfigured: isUnlockConfigured,
  } = useUnlockCheckout();
  const { isPremiumMember, isPaidSubscriber } = usePremiumMembership(
    address as `0x${string}` | undefined
  );
  const { balance, isLoading: creditsLoading, claimMembershipCredits } = useCredits();

  const [buyCreditsOpen, setBuyCreditsOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [claimingMembership, setClaimingMembership] = useState(false);

  const handleClaimMembershipCredits = async () => {
    if (claimingMembership) return;
    setClaimingMembership(true);
    try {
      const res = await claimMembershipCredits();
      if (res.ok) {
        toast.success('Membership credits claimed', {
          description: `+${res.creditsGranted} credits added to your balance.`,
        });
      } else if (res.reason === 'already_claimed') {
        toast.info('Already claimed this month', {
          description: 'Your monthly membership credits were already claimed. Come back next month.',
        });
      } else if (res.reason === 'not_member') {
        toast.error('No active membership', {
          description: 'An active Pixels Premium subscription is required.',
        });
      } else {
        toast.error('Claim failed', {
          description: 'Could not claim membership credits. Try again later.',
        });
      }
    } finally {
      setClaimingMembership(false);
    }
  };

  useEffect(() => {
    if (onrampError) {
      toast.error('Buy USDC', { description: onrampError });
    }
  }, [onrampError]);

  const handleBuyUsdc = () => {
    void openBuyUsdc({ address: address ?? undefined });
  };

  const handleDisconnect = async () => {
    await logout();
    navigate({ to: '/' });
  };

  const handleCopyAddress = () => {
    if (address) {
      void navigator.clipboard.writeText(address);
    }
  };

  const isInitializing = signerStatus.isInitializing;
  const isConnected = Boolean(user && !isInitializing);

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
        onClick={() => openAuthModal()}
        aria-label={connectLabel}
      >
        <Wallet className="h-4 w-4 shrink-0" />
        {!compact && <span className="hidden sm:inline">{connectLabel}</span>}
      </Button>
    );
  }

  const displayText = address ? truncateAddress(address) : 'Connected';
  const canBuyCredits = canAffordAnyCreditPack(usdcBalance);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size={size} className={className} aria-label="Wallet">
            <Wallet className="h-4 w-4 shrink-0" />
            {!compact && (
              <span className="hidden sm:inline-flex sm:items-center sm:gap-2">
                <span>{displayText}</span>
                <CreditBalanceBadge className="border-0 bg-transparent p-0 hover:bg-transparent" />
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
            USDC: {usdcFormatted}
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
          {isUnlockConfigured && !isPremiumMember && (
            <DropdownMenuItem
              onClick={openSubscribeCheckout}
              className="flex cursor-pointer items-center gap-2"
              aria-label="Subscribe to Pixels Premium"
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
              {formatSubscribeCta()}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled className="text-muted-foreground">
            Credits: {creditsLoading ? '…' : `${balance} cr`}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setBuyCreditsOpen(true)}
            disabled={!canBuyCredits}
            title={canBuyCredits ? undefined : 'Top up USDC on Arbitrum first'}
            className="flex cursor-pointer items-center gap-2"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            Buy credits
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setRedeemOpen(true)}
            className="flex cursor-pointer items-center gap-2"
          >
            <Gift className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            Redeem code
          </DropdownMenuItem>
        {isUnlockConfigured && isPaidSubscriber && (
          <DropdownMenuItem
            onClick={() => void handleClaimMembershipCredits()}
            disabled={claimingMembership}
            className="flex cursor-pointer items-center gap-2"
            aria-label="Claim monthly membership credits"
          >
            <Gift className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            {claimingMembership ? 'Claiming…' : 'Claim monthly credits'}
          </DropdownMenuItem>
        )}
        {isUnlockConfigured && isPaidSubscriber && (
          <DropdownMenuItem
            onClick={openManageSubscription}
            className="flex cursor-pointer items-center gap-2"
            aria-label="Manage subscription"
          >
            <Settings2 className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            Manage subscription
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5">
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Network
          </label>
          <Select
            value={chain?.id?.toString() ?? ''}
            onValueChange={(value) => {
              const c = SWITCHABLE_CHAINS.find((ch) => ch.id.toString() === value);
              if (c) setChain({ chain: c });
            }}
            disabled={isSettingChain}
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
        <DropdownMenuItem onClick={handleDisconnect}>Disconnect</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
      <BuyCreditsModal open={buyCreditsOpen} onOpenChange={setBuyCreditsOpen} />
      <RedeemPromoModal open={redeemOpen} onOpenChange={setRedeemOpen} />
    </>
  );
}
