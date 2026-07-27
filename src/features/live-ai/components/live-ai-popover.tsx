import { useState } from 'react'
import { Radio, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useWalletContext } from '../deps/wallet'
import { useCrtvaiBalance, useUsdcBalance } from '../deps/metoken'
import { usePremiumMembership } from '../hooks/use-premium-membership'
import { UsageMeter } from './usage-meter'
import { isLiveAiBillingEnvReady, getLiveAiBillingConfigIssues } from '../config/billing-config'

/**
 * Compact Live AI control popover.
 *
 * Displays premium tier, CRTVAI/USDC balances, and a placeholder start/stop
 * control. Full stream integration (Daydream/Livepeer) is intentionally out of
 * scope for this PR; this wires the membership/billing UI layer onto the new
 * upstream runtime.
 */
export function LiveAiPopover() {
  const [open, setOpen] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const { wallet, chain } = useWalletContext()
  const address = wallet?.address as `0x${string}` | undefined
  const {
    isPremiumMember,
    isLoading: membershipLoading,
    intervalCostUsdc6,
  } = usePremiumMembership(address)
  const { formatted: crtvaiFormatted } = useCrtvaiBalance(address)
  const { formatted: usdcFormatted } = useUsdcBalance(chain, address)

  const billingReady = isLiveAiBillingEnvReady()
  const issues = billingReady ? [] : getLiveAiBillingConfigIssues()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Live AI">
          <Radio className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4" />
          <span>Live AI</span>
        </div>

        <UsageMeter streamActive={streaming} />

        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>Tier</span>
            <span className="font-medium text-foreground">
              {membershipLoading ? '…' : isPremiumMember ? 'Premium' : 'Retail'}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Rate</span>
            <span className="font-medium text-foreground">
              ${(intervalCostUsdc6 / 1_000_000).toFixed(3)} / 5 min
            </span>
          </div>
          <div className="flex justify-between">
            <span>CRTVAI</span>
            <span className="font-medium text-foreground">{crtvaiFormatted}</span>
          </div>
          <div className="flex justify-between">
            <span>USDC</span>
            <span className="font-medium text-foreground">{usdcFormatted}</span>
          </div>
        </div>

        {!billingReady && (
          <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            {issues.map((i) => (
              <p key={i.code}>{i.message}</p>
            ))}
          </div>
        )}

        <Button
          className="w-full"
          disabled={!billingReady || !address}
          onClick={() => setStreaming((s) => !s)}
        >
          {streaming ? 'Stop Live AI' : 'Start Live AI'}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
