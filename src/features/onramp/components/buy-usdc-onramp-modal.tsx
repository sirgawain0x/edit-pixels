import { useEffect, useState } from 'react'
import { CheckCircle2, DollarSign } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DEFAULT_ONRAMP_PAYMENT_METHOD,
  PAY_COINBASE_ORIGIN,
  type OnrampPaymentMethod,
} from '@/config/onramp'
import { useWalletContext } from '../deps/wallet'
import { useOnrampUrl } from '../hooks/use-onramp-url'
import { OnrampDetailsStep } from './onramp-details-step'
import { OnrampPayStep } from './onramp-pay-step'
import { OnrampVerifyStep } from './onramp-verify-step'

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

const STEP_DESCRIPTION: Record<Step, string> = {
  details:
    'Purchase USDC on Base with Apple Pay or Google Pay (debit card via your wallet). Funds arrive in your smart wallet.',
  verify: 'Enter the one-time codes sent to your phone and email to verify ownership.',
  pay: 'Complete payment with the Coinbase button below. Do not leave this dialog until finished.',
  success: 'Your USDC purchase succeeded.',
}

const PAY_STATUS_BY_EVENT: Record<string, string> = {
  'onramp_api.load_pending': 'Loading payment…',
  'onramp_api.load_success': 'Ready — tap the pay button to continue.',
  'onramp_api.load_error': 'Failed to load payment button.',
  'onramp_api.commit_success': 'Payment submitted — confirming…',
  'onramp_api.commit_error': 'Payment could not be started.',
  'onramp_api.polling_success': 'USDC sent to your wallet.',
  'onramp_api.polling_error': 'Transaction failed after payment.',
  'onramp_api.cancel': 'Payment cancelled.',
}

function isTrustedPayOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return url.origin === PAY_COINBASE_ORIGIN || url.hostname.endsWith('.coinbase.com')
  } catch {
    return false
  }
}

function parseOnrampPostMessage(data: unknown): OnrampPostMessage | null {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as OnrampPostMessage
    } catch {
      return null
    }
  }
  if (typeof data === 'object' && data !== null) {
    return data as OnrampPostMessage
  }
  return null
}

function statusForOnrampEvent(eventName: string, errorMessage?: string): string | null {
  if (errorMessage && eventName.endsWith('_error')) return errorMessage
  return PAY_STATUS_BY_EVENT[eventName] ?? null
}

export function BuyUsdcOnrampModal({ open, onOpenChange }: BuyUsdcOnrampModalProps) {
  const { account } = useWalletContext()
  const address = account
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
      const payload = parseOnrampPostMessage(event.data)
      if (!payload?.eventName) return

      const nextStatus = statusForOnrampEvent(payload.eventName, payload.data?.errorMessage)
      if (nextStatus) setPayStatus(nextStatus)
      if (payload.eventName === 'onramp_api.polling_success') {
        setStep('success')
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [open, step])

  async function handleDetailsSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!address || !tosAccepted || !agreementAcceptedAt) return
    clearError()

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
          <DialogDescription>{STEP_DESCRIPTION[step]}</DialogDescription>
        </DialogHeader>

        {!address ? (
          <p className="text-sm text-muted-foreground">Connect a wallet to buy USDC.</p>
        ) : null}

        {address && step === 'details' ? (
          <OnrampDetailsStep
            email={email}
            phone={phone}
            amount={amount}
            paymentMethod={paymentMethod}
            tosAccepted={tosAccepted}
            isLoading={isLoading}
            error={error}
            onEmailChange={setEmail}
            onPhoneChange={setPhone}
            onAmountChange={setAmount}
            onPaymentMethodChange={setPaymentMethod}
            onTosChange={(accepted, acceptedAt) => {
              setTosAccepted(accepted)
              setAgreementAcceptedAt(acceptedAt)
            }}
            onSubmit={(e) => void handleDetailsSubmit(e)}
          />
        ) : null}

        {address && step === 'verify' ? (
          <OnrampVerifyStep
            smsOtp={smsOtp}
            emailOtp={emailOtp}
            smsVerified={smsVerified}
            emailVerified={emailVerified}
            isLoading={isLoading}
            error={error}
            onSmsOtpChange={setSmsOtp}
            onEmailOtpChange={setEmailOtp}
            onVerifySms={() => void handleVerifySms()}
            onVerifyEmail={() => void handleVerifyEmail()}
            onBack={resetFlow}
            onContinue={() => void handleContinueToPay()}
          />
        ) : null}

        {address && step === 'pay' && paymentLink ? (
          <OnrampPayStep
            paymentLink={paymentLink}
            payStatus={payStatus}
            error={error}
            onStartOver={resetFlow}
          />
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
