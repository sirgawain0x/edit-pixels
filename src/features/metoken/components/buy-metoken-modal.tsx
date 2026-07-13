'use client';

import { useCallback, useEffect, useState } from 'react';
import { Coins, DollarSign, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { parseUnits, formatUnits } from 'viem';
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
import { useBuyUsdcOnramp } from '@/hooks/use-buy-usdc-onramp';
import { useCrtvaiBalance } from '@/hooks/use-crtvai-balance';
import {
  CRTVAI_DECIMALS,
  USDC_DECIMALS,
  readCrtvaiMintQuote,
  readCrtvaiCurrentPrice,
} from '@/config/metoken';
import { buildBuyMetokenOps } from '../api/buy-metoken';
import { base } from 'viem/chains';

interface BuyMetokenModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const BASE_CHAIN_ID = base.id;

export function BuyMetokenModal({ open, onOpenChange }: BuyMetokenModalProps) {
  const { account, chain } = useWalletContext();
  const { sendOps, ready: walletReady } = useSmartWalletOps();
  const {
    balance: usdcBalance,
    formatted: usdcFormatted,
    isLoading: isUsdcLoading,
  } = useUsdcBalance(chain, account);
  const { openBuyUsdc, isLoading: isOnrampLoading } = useBuyUsdcOnramp();
  const { formatted: crtvaiFormatted, symbol } = useCrtvaiBalance(account);

  const [usdcInput, setUsdcInput] = useState('');
  const [estimatedOutput, setEstimatedOutput] = useState<string | null>(null);
  const [currentPrice, setCurrentPrice] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [minting, setMinting] = useState(false);

  const onBase = chain?.id === BASE_CHAIN_ID;

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
    const usdcRaw = parseUnits(usdcInput, USDC_DECIMALS);
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
    const usdcRaw = parseUnits(usdcInput || '0', USDC_DECIMALS);
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

  const handleBuyUsdc = () => {
    void openBuyUsdc({ address: account ?? undefined });
  };

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
                disabled={minting}
                className="tabular-nums"
                min="0"
                step="0.01"
              />
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

            <Button
              type="button"
              className="w-full"
              disabled={minting || !usdcInput || quoting || !walletReady}
              onClick={() => void handleMint()}
            >
              {minting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Minting…
                </>
              ) : (
                'Mint CRTVAI'
              )}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full text-xs"
              disabled={isOnrampLoading}
              onClick={handleBuyUsdc}
            >
              <DollarSign className="h-3.5 w-3.5" aria-hidden />
              {isOnrampLoading ? 'Opening…' : 'Buy USDC first'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}