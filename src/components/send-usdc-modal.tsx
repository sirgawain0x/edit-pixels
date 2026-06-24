'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAccount, useChain } from '@account-kit/react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { USDC_ADDRESS_BY_CHAIN_ID } from '@/config/chains';
import { useSendUsdc } from '@/hooks/use-send-usdc';
import { useUsdcBalance } from '@/hooks/use-usdc-balance';
import { validateUsdcSend } from '@/shared/utils/usdc-transfer';

interface SendUsdcModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SendUsdcModal({ open, onOpenChange }: SendUsdcModalProps) {
  const { address } = useAccount({ type: 'LightAccount' });
  const { chain } = useChain();
  const {
    balance: usdcBalance,
    formatted: usdcFormatted,
    isLoading: isBalanceLoading,
  } = useUsdcBalance(chain, address as `0x${string}` | undefined);
  const { sendUsdc, ready } = useSendUsdc();

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setRecipient('');
      setAmount('');
      setError(null);
      setIsSending(false);
    }
  }, [open]);

  const validation = useMemo(
    () =>
      validateUsdcSend({
        recipient,
        amount,
        balance: usdcBalance,
        senderAddress: address,
      }),
    [address, amount, recipient, usdcBalance]
  );

  const canSend =
    ready &&
    !isBalanceLoading &&
    validation.ok &&
    !isSending &&
    Boolean(chain && usdcBalance !== null);

  const handleMax = () => {
    if (usdcBalance) {
      setAmount(usdcBalance);
      setError(null);
    }
  };

  const handleSend = async () => {
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setIsSending(true);
    setError(null);
    try {
      const result = await sendUsdc(recipient, amount, usdcBalance);
      if (result.ok) {
        toast.success('USDC sent', {
          description: `Sent ${amount} USDC to ${recipient.trim()}`,
        });
        onOpenChange(false);
      } else {
        setError(result.error ?? 'Transfer failed');
      }
    } finally {
      setIsSending(false);
    }
  };

  const hasUsdc = chain ? chain.id in USDC_ADDRESS_BY_CHAIN_ID : false;
  const unsupportedNetwork = Boolean(chain && !hasUsdc);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send USDC</DialogTitle>
          <DialogDescription>
            Send USDC from your wallet
            {chain ? ` on ${chain.name}` : ''} to another address.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="text-muted-foreground text-sm">
            {isBalanceLoading
              ? 'Checking USDC balance…'
              : unsupportedNetwork
                ? 'USDC is not available on this network.'
                : `Available: ${usdcFormatted} USDC`}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="send-usdc-recipient">Recipient address</Label>
            <Input
              id="send-usdc-recipient"
              placeholder="0x…"
              value={recipient}
              onChange={(e) => {
                setRecipient(e.target.value);
                setError(null);
              }}
              disabled={isSending || unsupportedNetwork}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="send-usdc-amount">Amount (USDC)</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto px-2 py-1 text-xs"
                onClick={handleMax}
                disabled={!usdcBalance || isSending || unsupportedNetwork}
              >
                Max
              </Button>
            </div>
            <Input
              id="send-usdc-amount"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError(null);
              }}
              disabled={isSending || unsupportedNetwork}
            />
          </div>

          {(error || (!validation.ok && (recipient || amount))) && (
            <p className="text-destructive text-sm">
              {error ?? (!validation.ok ? validation.error : null)}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSending}
          >
            Cancel
          </Button>
          <Button onClick={() => void handleSend()} disabled={!canSend}>
            {isSending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : (
              'Send USDC'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
