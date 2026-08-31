// fallow-ignore-file complexity
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface OnrampVerifyStepProps {
  smsOtp: string
  emailOtp: string
  smsVerified: boolean
  emailVerified: boolean
  isLoading: boolean
  error: string | null
  onSmsOtpChange: (value: string) => void
  onEmailOtpChange: (value: string) => void
  onVerifySms: () => void
  onVerifyEmail: () => void
  onBack: () => void
  onContinue: () => void
}

export function OnrampVerifyStep({
  smsOtp,
  emailOtp,
  smsVerified,
  emailVerified,
  isLoading,
  error,
  onSmsOtpChange,
  onEmailOtpChange,
  onVerifySms,
  onVerifyEmail,
  onBack,
  onContinue,
}: OnrampVerifyStepProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="onramp-sms-otp">SMS code</Label>
        <div className="flex gap-2">
          <Input
            id="onramp-sms-otp"
            inputMode="numeric"
            maxLength={6}
            value={smsOtp}
            onChange={(e) => onSmsOtpChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            disabled={smsVerified}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={isLoading || smsVerified || smsOtp.length !== 6}
            onClick={onVerifySms}
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
            onChange={(e) => onEmailOtpChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            disabled={emailVerified}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={isLoading || emailVerified || emailOtp.length !== 6}
            onClick={onVerifyEmail}
          >
            {emailVerified ? 'Verified' : 'Verify'}
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onBack}>
          Back
        </Button>
        <Button
          type="button"
          className="flex-1"
          disabled={isLoading || !smsVerified || !emailVerified}
          onClick={onContinue}
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Continue to payment'}
        </Button>
      </div>
    </div>
  )
}
