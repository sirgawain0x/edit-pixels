'use client';

import { useState } from 'react';
import { Gift, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCredits } from '@/features/credits/hooks/use-credits';

interface RedeemPromoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RedeemPromoModal({ open, onOpenChange }: RedeemPromoModalProps) {
  const { redeemPromo } = useCredits();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRedeem = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      const result = await redeemPromo(trimmed);
      if (result.ok) {
        toast.success(`Redeemed ${result.creditsGranted} credits`);
        setCode('');
        onOpenChange(false);
      } else {
        const messages: Record<string, string> = {
          invalid_code: 'Invalid promo code',
          expired: 'This code has expired',
          exhausted: 'This code has reached its redemption limit',
          already_redeemed: 'You already redeemed this code',
          single_use_taken: 'This code has already been used',
          disabled: 'Promo codes are not available',
        };
        toast.error(messages[result.reason ?? ''] ?? 'Could not redeem code');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5" aria-hidden />
            Redeem code
          </DialogTitle>
          <DialogDescription>
            Enter a promo code to add credits to your account.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="promo-code" className="text-xs">
              Promo code
            </Label>
            <Input
              id="promo-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="PIXELS-XXXX-XXXX"
              className="font-mono text-sm uppercase"
              disabled={loading}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleRedeem();
              }}
            />
          </div>
          <Button onClick={() => void handleRedeem()} disabled={loading || !code.trim()}>
            {loading ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                Redeeming…
              </>
            ) : (
              'Redeem'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
