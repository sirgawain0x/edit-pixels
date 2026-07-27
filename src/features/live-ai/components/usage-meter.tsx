import { useEffect, useState } from 'react'
import { Clock, DollarSign } from 'lucide-react'
import { useWalletContext } from '@/context/wallet-context'
import { hourlyUsdcFromInterval } from '@/config/metoken'
import { usePremiumMembership } from '../hooks/use-premium-membership'

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatUsdRate(hourlyUsdc6: number): string {
  return `$${(hourlyUsdc6 / 1_000_000).toFixed(2)}/hr`
}

function formatUsdStreamed(usdc6: number): string {
  return `$${(usdc6 / 1_000_000).toFixed(4)} streamed`
}

/**
 * Compact live counter while Live AI is streaming.
 * Shows elapsed time and current hourly USDC rate.
 */
export function UsageMeter({ streamActive }: { streamActive: boolean }) {
  const { wallet } = useWalletContext()
  const address = wallet?.address
  const { intervalCostUsdc6, isPremiumMember, isLoading } = usePremiumMembership(
    address as `0x${string}` | undefined,
  )
  const [elapsedMs, setElapsedMs] = useState(0)

  const hourlyRate = hourlyUsdcFromInterval(intervalCostUsdc6)
  const elapsedHours = elapsedMs / 3_600_000
  const estimatedSpentUsdc6 = elapsedHours * hourlyRate

  useEffect(() => {
    if (!streamActive) {
      setElapsedMs(0)
      return
    }
    const start = Date.now()
    setElapsedMs(0)
    const id = setInterval(() => setElapsedMs(Date.now() - start), 1000)
    return () => clearInterval(id)
  }, [streamActive])

  if (!streamActive) return null

  return (
    <div className="mb-2 space-y-1 rounded-md border bg-muted/50 p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 font-medium">
          <Clock className="h-3 w-3" aria-hidden />
          <span className="tabular-nums">{formatElapsed(elapsedMs)}</span>
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <DollarSign className="h-3 w-3" aria-hidden />
          {isLoading ? '…' : `${formatUsdRate(hourlyRate)}${isPremiumMember ? ' · premium' : ''}`}
        </span>
      </div>
      {!isLoading && (
        <p className="text-muted-foreground">{formatUsdStreamed(estimatedSpentUsdc6)}</p>
      )}
    </div>
  )
}
