import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

interface RedeemPromoModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the promo code when the user submits. */
  onRedeem?: (code: string) => void
}

/**
 * Promo code redemption modal.
 *
 * The legacy server-side promo redemption system is deprecated. This modal
 * captures the code and calls the provided callback. The host feature can call
 * an API or apply the credits locally as appropriate.
 */
export function RedeemPromoModal({ open, onOpenChange, onRedeem }: RedeemPromoModalProps) {
  const [code, setCode] = useState('')

  const handleSubmit = () => {
    if (!code.trim()) return
    onRedeem?.(code.trim())
    setCode('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Redeem promo code</DialogTitle>
          <DialogDescription>Enter a promo code to receive CRTVAI credits.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 pt-2">
          <Input
            placeholder="PROMO-CODE"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit()
            }}
          />
          <Button onClick={handleSubmit} disabled={!code.trim()}>
            Redeem
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
