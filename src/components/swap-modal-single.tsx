'use client';

import type { Chain } from 'viem';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useWalletContext } from '@/context/wallet-context';
import { USDC_ADDRESS_BY_CHAIN_ID } from '@/config/chains';
import { buildGasPaymasterCapabilities } from '@/config/gas-sponsorship';
import { decimalAmountToWei, NATIVE_TOKEN_ADDRESS } from '@/shared/utils/swap-utils';
import { executeSwapQuote } from '@/shared/utils/smart-wallet-swap';

const USDC_DECIMALS = 6;

interface SingleChainSwapModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chain: Chain | undefined;
}

export function SingleChainSwapModal({
  open,
  onOpenChange,
  chain,
}: SingleChainSwapModalProps) {
  const [amount, setAmount] = useState('');
  const [fromTokenIsUsdc, setFromTokenIsUsdc] = useState(true);
  const [quoteError, setQuoteError] = useState<Error | null>(null);
  const [sendError, setSendError] = useState<Error | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const { smartWalletClient } = useWalletContext();

  const usdcAddress = chain ? USDC_ADDRESS_BY_CHAIN_ID[chain.id] : undefined;
  const fromToken = fromTokenIsUsdc ? usdcAddress : NATIVE_TOKEN_ADDRESS;
  const toToken = fromTokenIsUsdc ? NATIVE_TOKEN_ADDRESS : usdcAddress;
  const decimals = fromTokenIsUsdc ? USDC_DECIMALS : 18;
  const canSwap =
    chain &&
    fromToken &&
    toToken &&
    amount &&
    parseFloat(amount) > 0 &&
    smartWalletClient &&
    usdcAddress;

  const resetQuote = () => setQuoteError(null);
  const resetSend = () => setSendError(null);

  const handleGetQuote = async () => {
    if (!canSwap || !chain || !smartWalletClient) return;
    resetQuote();
    resetSend();
    setIsBusy(true);
    try {
      await executeSwapQuote(smartWalletClient, {
        fromToken,
        toToken,
        fromAmount: decimalAmountToWei(amount, decimals),
        chainId: chain.id,
        capabilities: buildGasPaymasterCapabilities(chain.id) ?? undefined,
      });
      setAmount('');
      onOpenChange(false);
    } catch (e) {
      setQuoteError(e instanceof Error ? e : new Error('Swap failed'));
    } finally {
      setIsBusy(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setAmount('');
      resetQuote();
      resetSend();
    }
    onOpenChange(next);
  };

  if (!chain) return null;

  const error = quoteError ?? sendError;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Swap on this chain</DialogTitle>
          <DialogDescription>
            Swap tokens on {chain.name}. Alchemy swap API may not support all testnets.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium">From</label>
            <div className="flex gap-2">
              <select
                className="flex h-9 w-24 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={fromTokenIsUsdc ? 'usdc' : 'native'}
                onChange={(e) => setFromTokenIsUsdc(e.target.value === 'usdc')}
              >
                <option value="usdc">USDC</option>
                <option value="native">{chain.nativeCurrency.symbol}</option>
              </select>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.0"
                className="flex h-9 flex-1 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          <div className="text-muted-foreground text-xs">
            To: {fromTokenIsUsdc ? chain.nativeCurrency.symbol : 'USDC'}
          </div>
          {error && (
            <p className="text-destructive text-sm">
              {error instanceof Error ? error.message : 'Swap failed'}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isBusy}
          >
            Cancel
          </Button>
          <Button onClick={() => void handleGetQuote()} disabled={!canSwap || isBusy}>
            {isBusy ? 'Swapping…' : 'Swap'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
