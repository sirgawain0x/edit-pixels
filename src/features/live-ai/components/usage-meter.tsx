'use client';

import { useEffect, useState } from 'react';
import { useAccount } from '@account-kit/react';
import { Clock, Gift, Sparkles } from 'lucide-react';
import {
  INTERVAL_COST_PREMIUM_USDC6,
  INTERVAL_COST_RETAIL_USDC6,
  USDC_DECIMALS,
} from '@/config/billing';
import { useFreeTier } from '../hooks/use-free-tier';
import { usePremiumMembership } from '../hooks/use-premium-membership';
import { useLiveSessionStore } from '../stores/live-session-store';

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatHourlyRate(intervalCostUsdc6: number): string {
  if (intervalCostUsdc6 === INTERVAL_COST_PREMIUM_USDC6) return '$1.50';
  if (intervalCostUsdc6 === INTERVAL_COST_RETAIL_USDC6) return '$3.00';
  const hourly = (intervalCostUsdc6 * 12) / 10 ** USDC_DECIMALS;
  return `$${hourly.toFixed(2)}`;
}

/**
 * Compact live counter rendered while a Live AI stream is active. Shows
 * elapsed session time, the hourly rate being charged, and — when the free
 * tier is configured — remaining free minutes for the month.
 */
export function UsageMeter() {
  const { address } = useAccount({ type: 'LightAccount' });
  const streamActive = useLiveSessionStore((s) => s.streamActive);
  const { intervalCostUsdc6, isPremiumMember } = usePremiumMembership(
    address as `0x${string}` | undefined
  );
  const { minutesRemaining, configured: freeTierConfigured } = useFreeTier(
    address as `0x${string}` | undefined
  );

  const [elapsedMs, setElapsedMs] = useState(0);

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

  if (!streamActive || !address) return null;

  return (
    <div className="mb-2 p-2 rounded-md bg-muted/50 border text-xs space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 font-medium">
          <Clock className="h-3 w-3" aria-hidden />
          <span className="tabular-nums">{formatElapsed(elapsedMs)}</span>
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          {isPremiumMember && <Sparkles className="h-3 w-3" aria-hidden />}
          {formatHourlyRate(intervalCostUsdc6)}/hr
        </span>
      </div>
      {freeTierConfigured && minutesRemaining > 0 && (
        <div className="flex items-center gap-1 text-muted-foreground">
          <Gift className="h-3 w-3 shrink-0" aria-hidden />
          <span>{minutesRemaining} free min remaining this month</span>
        </div>
      )}
    </div>
  );
}
