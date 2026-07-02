'use client';

import { useEffect, useState } from 'react';
import { Clock, DollarSign } from 'lucide-react';
import { useLiveSessionStore } from '../stores/live-session-store';
import { usePremiumMembership } from '../hooks/use-premium-membership';
import { useWalletContext } from '@/context/wallet-context';
import { hourlyUsdcFromInterval } from '@/config/superfluid';
import {
  formatUsdRate,
  formatUsdStreamedInUsdc,
} from '@/shared/utils/currency-display';

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Compact live counter while Live AI is streaming via Superfluid.
 * Shows elapsed time and current hourly USDC rate.
 */
export function UsageMeter() {
  const streamActive = useLiveSessionStore((s) => s.streamActive);
  const { account: address } = useWalletContext();
  const { intervalCostUsdc6, isPremiumMember, isLoading } = usePremiumMembership(address);
  const [elapsedMs, setElapsedMs] = useState(0);

  const hourlyRate = hourlyUsdcFromInterval(intervalCostUsdc6);
  const elapsedHours = elapsedMs / 3_600_000;
  const estimatedSpent = elapsedHours * hourlyRate;

  useEffect(() => {
    if (!streamActive) {
      setElapsedMs(0);
      return;
    }
    const start = Date.now();
    setElapsedMs(0);
    const id = setInterval(() => setElapsedMs(Date.now() - start), 1000);
    return () => clearInterval(id);
  }, [streamActive]);

  if (!streamActive) return null;

  return (
    <div className="mb-2 space-y-1 rounded-md border bg-muted/50 p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 font-medium">
          <Clock className="h-3 w-3" aria-hidden />
          <span className="tabular-nums">{formatElapsed(elapsedMs)}</span>
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <DollarSign className="h-3 w-3" aria-hidden />
          {isLoading
            ? '…'
            : `${formatUsdRate(hourlyRate, 'hr')}${isPremiumMember ? ' · premium' : ''}`}
        </span>
      </div>
      {!isLoading && (
        <p className="text-muted-foreground">
          {formatUsdStreamedInUsdc(estimatedSpent)}
        </p>
      )}
    </div>
  );
}
