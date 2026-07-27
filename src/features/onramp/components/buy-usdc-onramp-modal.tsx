import { useState } from 'react'
import { DollarSign, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useWalletContext } from '../deps/wallet'
import { DEFAULT_ONRAMP_PAYMENT_METHOD } from '@/config/onramp'
import { useOnrampUrl } from '../hooks/use-onramp-url'

interface BuyUsdcOnrampModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BuyUsdcOnrampModal({ open, onOpenChange }: BuyUsdcOnrampModalProps) {
  const { wallet } = useWalletContext()
  const address = wallet?.address as `0x${string}` | undefined
  const { getOnrampUrl, isLoading, error } = useOnrampUrl()
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [amount, setAmount] = useState('25.00')
  const [paymentMethod, setPaymentMethod] = useState(DEFAULT_ONRAMP_PAYMENT_METHOD)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!address) return
    const paymentLink = await getOnrampUrl({
      address,
      email,
      phone,
      amount,
      paymentMethod,
    })
    if (paymentLink) {
      window.open(paymentLink, '_blank', 'noopener,noreferrer')
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Buy USDC with Coinbase
          </DialogTitle>
          <DialogDescription>
            Purchase USDC on Base using Apple Pay or Google Pay. Funds arrive in your connected
            wallet.
          </DialogDescription>
        </DialogHeader>

        {!address ? (
          <p className="text-sm text-muted-foreground">Connect a wallet to buy USDC.</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="onramp-email">Email</Label>
              <Input
                id="onramp-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="onramp-phone">Phone (US)</Label>
              <Input
                id="onramp-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="onramp-amount">Amount (USD)</Label>
              <Input
                id="onramp-amount"
                type="number"
                min="1"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>Payment method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GUEST_CHECKOUT_APPLE_PAY">Apple Pay</SelectItem>
                  <SelectItem value="GUEST_CHECKOUT_GOOGLE_PAY">Google Pay</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Continue to Coinbase'}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
