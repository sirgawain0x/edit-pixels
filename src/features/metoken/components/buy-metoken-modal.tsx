'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Coins, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { parseUnits, formatUnits } from 'viem';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useWalletContext } from '@/context/wallet-context';
import { useSmartWalletOps } from '@/hooks/use-smart-wallet-ops';
import { useUsdcBalance } from '@/hooks/use-usdc-balance';
import { useCrtvaiBalance } from '@/hooks/use-crtvai-balance';
import {
  CRTVAI_DECIMALS,
  USDC_DECIMALS,
  readCrtvaiCurrentPrice,
  readCrtvaiMintQuote,
} from '@/config/metoken';
import { buildBuyMetokenOps } from '../api/buy-metoken';
import { HeadlessCdpOnramp } from '@/components/headless-cdp-onramp';
import { base } from 'viem/chains';

interface BuyMetokenModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const BASE_CHAIN_ID = base.id;

export function BuyMetokenModal({ open, onOpenChange }: BuyMetokenModalProps) {
  const { account, chain } = useWalletContext();
  const queryClient = useQueryClient();
  const { sendOps, ready: walletReady } = useSmartWalletOps();
  const {
    balance: usdcBalance,
    formatted: usdcFormatted,
    isLoading: isUsdcLoading,
  } = useUsdcBalance(chain, account);
  const { formatted: crtvaiFormatted, symbol } = useCrtvaiBalance(account);
  const [onrampSuccess, setOnrampSuccess] = useState(false);

  const [usdcInput, setUsdcInput] = useState('');
  const [estimatedOutput, setEstimatedOutput] = useState<string | null>(null);
  const [currentPrice, setCurrentPrice] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [minting, setMinting] = useState(false);

  const onBase = chain?.id === BASE_CHAIN_ID;

  const hasAnyUsdc = Boolean(usdcBalance && Number(usdcBalance) > 0);

  const hasSufficientUsdc = useMemo(() => {
    if (!usdcInput || !usdcBalance) return true;
    try {
      const inputRaw = parseUnits(usdcInput, USDC_DECIMALS);
      const balanceRaw = parseUnits(usdcBalance, USDC_DECIMALS);
      return inputRaw <= balanceRaw;
    } catch {
      return false;
    }
  }, [usdcInput, usdcBalance]);

  // When USDC arrives via onramp, refetch balance so the UI enables minting
  useEffect(() => {
    if (onrampSuccess) {
      setOnrampSuccess(false);
      void queryClient.invalidateQueries({
        queryKey: ['usdc-balance', chain?.id, account],
      });
    }
  }, [onrampSuccess, queryClient, chain?.id, account]);

  // Fetch current price on open
  useEffect(() => {
    if (!open || !onBase) return;
    let cancelled = false;
    void (async () => {
      try {
        const price = await readCrtvaiCurrentPrice();
        if (!cancelled) {
          setCurrentPrice(formatUnits(price, USDC_DECIMALS));
        }
      } catch {
        // Price read failed — non-fatal, UI still works
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, onBase]);

  // Debounced mint quote
  useEffect(() => {
    if (!open || !onBase || !usdcInput) {
      setEstimatedOutput(null);
      return;
    }
    let usdcRaw: bigint;
    try {
      usdcRaw = parseUnits(usdcInput, USDC_DECIMALS);
    } catch {
      setEstimatedOutput(null);
      return;
    }
    if (usdcRaw <= 0n) {
      setEstimatedOutput(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    const timer = setTimeout(async () => {
      try {
        const output = await readCrtvaiMintQuote(usdcRaw);
        if (!cancelled) {
          setEstimatedOutput(formatUnits(output, CRTVAI_DECIMALS));
        }
      } catch {
        if (!cancelled) setEstimatedOutput(null);
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [usdcInput, open, onBase]);

  const handleMint = useCallback(async () => {
    if (!account || !onBase) {
      toast.error('Switch to Base to buy CRTVAI');
      return;
    }
    let usdcRaw: bigint;
    try {
      usdcRaw = parseUnits(usdcInput || '0', USDC_DECIMALS);
    } catch {
      toast.error('Invalid USDC amount');
      return;
    }
    if (usdcRaw <= 0n) {
      toast.error('Enter a USDC amount');
      return;
    }
    if (!walletReady) {
      toast.error('Wallet not ready');
      return;
    }

    setMinting(true);
    try {
      const { ops } = buildBuyMetokenOps(usdcRaw);
      const { txHash } = await sendOps(ops);
      toast.success('CRTVAI minted!', {
        description: `Transaction: ${txHash.slice(0, 10)}…`,
      });
      setUsdcInput('');
      setEstimatedOutput(null);
      onOpenChange(false);
    } catch (e) {
      toast.error('Mint failed', {
        description: e instanceof Error ? e.message : 'Unknown error',
      });
    } finally {
      setMinting(false);
    }
  }, [account, onBase, usdcInput, walletReady, sendOps, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5" aria-hidden />
            Buy CRTVAI
          </DialogTitle>
          <DialogDescription>
            Mint CRTVAI meTokens with USDC. The bonding curve determines how
            many tokens you receive based on current supply.
            {isUsdcLoading && (
              <span className="mt-1 flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Checking USDC balance…
              </span>
            )}
            {!isUsdcLoading && usdcBalance !== null && (
              <span className="mt-1 block tabular-nums">
                Wallet USDC: {usdcFormatted} · {symbol}: {crtvaiFormatted}
              </span>
            )}
            {currentPrice && (
              <span className="mt-0.5 block text-muted-foreground">
                Current price: ~{currentPrice} USDC per {symbol}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {!onBase && (
          <p className="text-xs text-amber-600">
            Switch to Base network to buy CRTVAI.
          </p>
        )}

        {onBase && (
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                USDC to spend
              </label>
              <Input
                type="number"
                placeholder="0.00"
                value={usdcInput}
                onChange={(e) => setUsdcInput(e.target.value)}
                disabled={minting || !hasAnyUsdc}
                className="tabular-nums"
                min="0"
                step="0.01"
              />
              {!hasAnyUsdc && (
                <p className="mt-1 text-xs text-amber-600">
                  Add USDC to your wallet to enable minting.
                </p>
              )}
            </div>

            {quoting && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Fetching quote…
              </p>
            )}

            {estimatedOutput && !quoting && (
              <div className="rounded-md border bg-muted/50 px-3 py-2 text-sm">
                <span className="text-muted-foreground">You receive: </span>
                <span className="font-medium tabular-nums">
                  ~{Number(estimatedOutput).toLocaleString(undefined, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 4,
                  })}{' '}
                  {symbol}
                </span>
              </div>
            )}

            {!hasAnyUsdc && (
              <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400 space-y-2">
                <p>
                  You need USDC in your wallet before you can mint {symbol}.
                  Buy USDC on Base first.
                </p>
                <HeadlessCdpOnramp
                  address={account}
                  onSuccess={() => setOnrampSuccess(true)}
                  onError={(msg) => toast.error('Buy USDC', { description: msg })}
                />
              </div>
            )}

            {hasAnyUsdc && (
              <Button
                type="button"
                className="w-full"
                disabled={minting || !usdcInput || quoting || !walletReady || !hasSufficientUsdc}
                onClick={() => void handleMint()}
              >
                {minting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Minting…
                  </>
                ) : !hasSufficientUsdc ? (
                  'Insufficient USDC Balance'
                ) : (
                  'Mint CRTVAI'
                )}
              </Button>
            )}

            {hasAnyUsdc && (
              <p className="text-center text-xs text-muted-foreground">
                Need more USDC?{' '}
                <HeadlessCdpOnramp
                  address={account}
                  onSuccess={() => setOnrampSuccess(true)}
                  onError={(msg) => toast.error('Buy USDC', { description: msg })}
                  className="inline-block"
                >
                  <button className="underline hover:text-foreground">
                    Buy USDC
                  </button>
                </HeadlessCdpOnramp>
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
