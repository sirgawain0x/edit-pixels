import { useEffect, useState } from 'react'
import { CheckCircle2, DollarSign, Loader2 } from 'lucide-react'
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
import {
  DEFAULT_ONRAMP_PAYMENT_METHOD,
  ONRAMP_LEGAL_LINKS,
  ONRAMP_PAYMENT_METHODS,
  PAY_COINBASE_ORIGIN,
  isOnrampSandboxMode,
  type OnrampPaymentMethod,
} from '@/config/onramp'
import { useWalletContext } from '../deps/wallet'
import { useOnrampUrl } from '../hooks/use-onramp-url'

interface BuyUsdcOnrampModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Step = 'details' | 'verify' | 'pay' | 'success'

interface OnrampPostMessage {
  eventName?: string
  data?: {
    errorCode?: string
    errorMessage?: string
  }
}

function isTrustedPayOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return url.origin === PAY_COINBASE_ORIGIN || url.hostname.endsWith('.coinbase.com')
  } catch {
    return false
  }
}

export function BuyUsdcOnrampModal({ open, onOpenChange }: BuyUsdcOnrampModalProps) {
  const { wallet } = useWalletContext()
  const address = wallet?.address as `0x${string}` | undefined
  const {
    initiateVerification,
    submitVerification,
    createOnrampOrder,
    isLoading,
    error,
    clearError,
  } = useOnrampUrl()

  const [step, setStep] = useState<Step>('details')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [amount, setAmount] = useState('25.00')
  const [paymentMethod, setPaymentMethod] = useState<OnrampPaymentMethod>(
    DEFAULT_ONRAMP_PAYMENT_METHOD,
  )
  const [tosAccepted, setTosAccepted] = useState(false)
  const [agreementAcceptedAt, setAgreementAcceptedAt] = useState<string | null>(null)

  const [smsVerificationId, setSmsVerificationId] = useState<string | null>(null)
  const [emailVerificationId, setEmailVerificationId] = useState<string | null>(null)
  const [smsOtp, setSmsOtp] = useState('')
  const [emailOtp, setEmailOtp] = useState('')
  const [phoneNumberVerifiedAt, setPhoneNumberVerifiedAt] = useState<string | null>(null)
  const [smsVerified, setSmsVerified] = useState(false)
  const [emailVerified, setEmailVerified] = useState(false)

  const [paymentLink, setPaymentLink] = useState<string | null>(null)
  const [payStatus, setPayStatus] = useState<string | null>(null)

  function resetFlow() {
    setStep('details')
    setSmsVerificationId(null)
    setEmailVerificationId(null)
    setSmsOtp('')
    setEmailOtp('')
    setPhoneNumberVerifiedAt(null)
    setSmsVerified(false)
    setEmailVerified(false)
    setPaymentLink(null)
    setPayStatus(null)
    clearError()
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetFlow()
    onOpenChange(next)
  }

  useEffect(() => {
    if (!open || step !== 'pay') return

    function onMessage(event: MessageEvent) {
      if (!isTrustedPayOrigin(event.origin)) return

      let payload: OnrampPostMessage | null = null
      if (typeof event.data === 'string') {
        try {
          payload = JSON.parse(event.data) as OnrampPostMessage
        } catch {
          return
        }
      } else if (typeof event.data === 'object' && event.data !== null) {
        payload = event.data as OnrampPostMessage
      }
      if (!payload?.eventName) return

      switch (payload.eventName) {
        case 'onramp_api.load_pending':
          setPayStatus('Loading payment…')
          break
        case 'onramp_api.load_success':
          setPayStatus('Ready — tap the pay button to continue.')
          break
        case 'onramp_api.load_error':
          setPayStatus(payload.data?.errorMessage ?? 'Failed to load payment button.')
          break
        case 'onramp_api.commit_success':
          setPayStatus('Payment submitted — confirming…')
          break
        case 'onramp_api.commit_error':
          setPayStatus(payload.data?.errorMessage ?? 'Payment could not be started.')
          break
        case 'onramp_api.polling_success':
          setPayStatus('USDC sent to your wallet.')
          setStep('success')
          break
        case 'onramp_api.polling_error':
          setPayStatus(payload.data?.errorMessage ?? 'Transaction failed after payment.')
          break
        case 'onramp_api.cancel':
          setPayStatus('Payment cancelled.')
          break
        default:
          break
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [open, step])

  async function handleDetailsSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!address || !tosAccepted || !agreementAcceptedAt) return
    clearError()

    // Sequential: shared hook loading/error state is not safe to race in parallel.
    const sms = await initiateVerification('sms', phone)
    if (!sms) return
    const emailInit = await initiateVerification('email', email)
    if (!emailInit) return

    setSmsVerificationId(sms.verificationId)
    setEmailVerificationId(emailInit.verificationId)
    setSmsVerified(false)
    setEmailVerified(false)
    setSmsOtp('')
    setEmailOtp('')
    setStep('verify')
  }

  async function handleVerifySms() {
    if (!smsVerificationId || !/^\d{6}$/.test(smsOtp)) return
    const result = await submitVerification(smsVerificationId, smsOtp)
    if (!result) return
    setSmsVerificationId(result.verificationId)
    setPhoneNumberVerifiedAt(result.verifiedAt)
    setSmsVerified(true)
  }

  async function handleVerifyEmail() {
    if (!emailVerificationId || !/^\d{6}$/.test(emailOtp)) return
    const result = await submitVerification(emailVerificationId, emailOtp)
    if (!result) return
    setEmailVerificationId(result.verificationId)
    setEmailVerified(true)
  }

  async function handleContinueToPay() {
    if (
      !address ||
      !agreementAcceptedAt ||
      !phoneNumberVerifiedAt ||
      !smsVerificationId ||
      !emailVerificationId ||
      !smsVerified ||
      !emailVerified
    ) {
      return
    }

    const link = await createOnrampOrder({
      address,
      email,
      phone,
      amount,
      paymentMethod,
      agreementAcceptedAt,
      phoneNumberVerifiedAt,
      smsVerificationId,
      emailVerificationId,
    })
    if (!link) return
    setPaymentLink(link)
    setPayStatus('Loading payment…')
    setStep('pay')
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={step === 'pay' ? 'sm:max-w-lg' : 'sm:max-w-md'}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            ) : (
              <DollarSign className="h-4 w-4" />
            )}
            {step === 'success' ? 'Purchase complete' : 'Buy USDC with Coinbase'}
          </DialogTitle>
          <DialogDescription>
            {step === 'details' &&
              'Purchase USDC on Base with Apple Pay or Google Pay (debit card via your wallet). Funds arrive in your connected wallet.'}
            {step === 'verify' &&
              'Enter the one-time codes sent to your phone and email to verify ownership.'}
            {step === 'pay' &&
              'Complete payment with the Coinbase button below. Do not leave this dialog until finished.'}
            {step === 'success' && 'Your USDC purchase succeeded.'}
          </DialogDescription>
        </DialogHeader>

        {!address ? (
          <p className="text-sm text-muted-foreground">Connect a wallet to buy USDC.</p>
        ) : null}

        {address && step === 'details' ? (
          <form onSubmit={handleDetailsSubmit} className="space-y-4">
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
              <Select
                value={paymentMethod}
                onValueChange={(v) => setPaymentMethod(v as OnrampPaymentMethod)}
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
                Debit card is charged through Apple Pay or Google Pay — there is no separate card
                form in this flow.
              </p>
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={tosAccepted}
                onChange={(e) => {
                  const checked = e.target.checked
                  setTosAccepted(checked)
                  setAgreementAcceptedAt(checked ? new Date().toISOString() : null)
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

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={isLoading || !tosAccepted}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send verification codes'}
            </Button>
          </form>
        ) : null}

        {address && step === 'verify' ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="onramp-sms-otp">SMS code</Label>
              <div className="flex gap-2">
                <Input
                  id="onramp-sms-otp"
                  inputMode="numeric"
                  maxLength={6}
                  value={smsOtp}
                  onChange={(e) => setSmsOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  disabled={smsVerified}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isLoading || smsVerified || smsOtp.length !== 6}
                  onClick={() => void handleVerifySms()}
                >
                  {smsVerified ? 'Verified' : 'Verify'}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="onramp-email-otp">Email code</Label>
              <div className="flex gap-2">
                <Input
                  id="onramp-email-otp"
                  inputMode="numeric"
                  maxLength={6}
                  value={emailOtp}
                  onChange={(e) => setEmailOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  disabled={emailVerified}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isLoading || emailVerified || emailOtp.length !== 6}
                  onClick={() => void handleVerifyEmail()}
                >
                  {emailVerified ? 'Verified' : 'Verify'}
                </Button>
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={resetFlow}>
                Back
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={isLoading || !smsVerified || !emailVerified}
                onClick={() => void handleContinueToPay()}
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Continue to payment'}
              </Button>
            </div>
          </div>
        ) : null}

        {address && step === 'pay' && paymentLink ? (
          <div className="space-y-3">
            {payStatus ? <p className="text-sm text-muted-foreground">{payStatus}</p> : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <iframe
              title="Coinbase Onramp"
              src={paymentLink}
              className="h-[420px] w-full rounded-md border bg-background"
              allow="payment"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              referrerPolicy="no-referrer"
            />
            <Button type="button" variant="outline" className="w-full" onClick={resetFlow}>
              Start over
            </Button>
          </div>
        ) : null}

        {step === 'success' ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {payStatus ?? 'Funds should appear in your connected wallet shortly.'}
            </p>
            <Button type="button" className="w-full" onClick={() => handleOpenChange(false)}>
              Done
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
