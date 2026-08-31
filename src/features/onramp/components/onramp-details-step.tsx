// fallow-ignore-file complexity
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ONRAMP_LEGAL_LINKS,
  ONRAMP_PAYMENT_METHODS,
  isOnrampSandboxMode,
  type OnrampPaymentMethod,
} from '@/config/onramp'

interface OnrampDetailsStepProps {
  email: string
  phone: string
  amount: string
  paymentMethod: OnrampPaymentMethod
  tosAccepted: boolean
  isLoading: boolean
  error: string | null
  onEmailChange: (value: string) => void
  onPhoneChange: (value: string) => void
  onAmountChange: (value: string) => void
  onPaymentMethodChange: (value: OnrampPaymentMethod) => void
  onTosChange: (accepted: boolean, acceptedAt: string | null) => void
  onSubmit: (e: React.FormEvent) => void
}

export function OnrampDetailsStep({
  email,
  phone,
  amount,
  paymentMethod,
  tosAccepted,
  isLoading,
  error,
  onEmailChange,
  onPhoneChange,
  onAmountChange,
  onPaymentMethodChange,
  onTosChange,
  onSubmit,
}: OnrampDetailsStepProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {isOnrampSandboxMode() ? (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Sandbox mode is on — orders use a sandbox- partnerUserRef and fake payment sheet.
        </p>
      ) : null}
      <div className="space-y-1">
        <Label htmlFor="onramp-email">Email</Label>
        <Input
          id="onramp-email"
          type="email"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
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
          onChange={(e) => onPhoneChange(e.target.value)}
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
          onChange={(e) => onAmountChange(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1">
        <Label>Payment method</Label>
        <Select
          value={paymentMethod}
          onValueChange={(v) => onPaymentMethodChange(v as OnrampPaymentMethod)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ONRAMP_PAYMENT_METHODS.APPLE_PAY}>Apple Pay</SelectItem>
            <SelectItem value={ONRAMP_PAYMENT_METHODS.GOOGLE_PAY}>Google Pay</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Debit card is charged through Apple Pay or Google Pay — there is no separate card form in
          this flow.
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={tosAccepted}
          onChange={(e) => {
            const checked = e.target.checked
            onTosChange(checked, checked ? new Date().toISOString() : null)
          }}
          required
        />
        <span className="text-muted-foreground">
          I agree to Coinbase&apos;s{' '}
          <a
            className="underline"
            href={ONRAMP_LEGAL_LINKS.guestCheckoutTos}
            target="_blank"
            rel="noopener noreferrer"
          >
            Guest Checkout Terms
          </a>
          ,{' '}
          <a
            className="underline"
            href={ONRAMP_LEGAL_LINKS.userAgreement}
            target="_blank"
            rel="noopener noreferrer"
          >
            User Agreement
          </a>
          , and{' '}
          <a
            className="underline"
            href={ONRAMP_LEGAL_LINKS.privacyPolicy}
            target="_blank"
            rel="noopener noreferrer"
          >
            Privacy Policy
          </a>
          .
        </span>
      </label>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button type="submit" className="w-full" disabled={isLoading || !tosAccepted}>
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send verification codes'}
      </Button>
    </form>
  )
}
