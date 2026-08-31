import { useCallback, useState } from 'react'
import {
  buildSandboxPartnerUserRef,
  getOnrampApiUrl,
  getOnrampVerifyApiUrl,
  getOnrampVerifySubmitApiUrl,
  type OnrampPaymentMethod,
} from '@/config/onramp'

export interface OnrampParams {
  address: `0x${string}`
  email: string
  phone: string
  amount: string
  paymentMethod: OnrampPaymentMethod
  agreementAcceptedAt: string
  phoneNumberVerifiedAt: string
  smsVerificationId: string
  emailVerificationId: string
  partnerUserRef?: string
  redirectUrl?: string
}

interface OnrampUrlResponse {
  paymentLink?: string
  orderId?: string | null
  error?: string
  errorType?: string | null
  errorMessage?: string
}

interface InitiateVerificationResult {
  verificationId: string
  otpExpiresAt: string | null
  channel: 'sms' | 'email'
  destination: string
}

interface SubmitVerificationResult {
  verificationId: string
  verificationExpiresAt: string | null
  verifiedAt: string
}

interface UseOnrampResult {
  initiateVerification: (
    channel: 'sms' | 'email',
    destination: string,
  ) => Promise<InitiateVerificationResult | null>
  submitVerification: (
    verificationId: string,
    otpCode: string,
  ) => Promise<SubmitVerificationResult | null>
  createOnrampOrder: (params: OnrampParams) => Promise<string | null>
  isLoading: boolean
  error: string | null
  clearError: () => void
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as OnrampUrlResponse
    return data.errorMessage ?? data.error ?? `Request failed (${res.status})`
  } catch {
    return `Request failed (${res.status})`
  }
}

export function useOnrampUrl(): UseOnrampResult {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearError = useCallback(() => setError(null), [])

  const initiateVerification = useCallback(
    async (
      channel: 'sms' | 'email',
      destination: string,
    ): Promise<InitiateVerificationResult | null> => {
      setIsLoading(true)
      setError(null)
      try {
        const res = await fetch(getOnrampVerifyApiUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel, destination }),
        })
        if (!res.ok) {
          throw new Error(await readErrorMessage(res))
        }
        const data = (await res.json()) as InitiateVerificationResult
        if (!data.verificationId) {
          throw new Error('Verification response missing verificationId')
        }
        return data
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown verification error'
        setError(message)
        return null
      } finally {
        setIsLoading(false)
      }
    },
    [],
  )

  const submitVerification = useCallback(
    async (verificationId: string, otpCode: string): Promise<SubmitVerificationResult | null> => {
      setIsLoading(true)
      setError(null)
      try {
        const res = await fetch(getOnrampVerifySubmitApiUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ verificationId, otpCode }),
        })
        if (!res.ok) {
          throw new Error(await readErrorMessage(res))
        }
        const data = (await res.json()) as SubmitVerificationResult
        if (!data.verificationId) {
          throw new Error('Submit response missing verificationId')
        }
        return data
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown verification error'
        setError(message)
        return null
      } finally {
        setIsLoading(false)
      }
    },
    [],
  )

  const createOnrampOrder = useCallback(async (params: OnrampParams): Promise<string | null> => {
    setIsLoading(true)
    setError(null)
    try {
      const partnerUserRef = params.partnerUserRef ?? buildSandboxPartnerUserRef(params.address)

      const res = await fetch(getOnrampApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: params.address,
          email: params.email,
          phone: params.phone,
          amount: params.amount,
          paymentMethod: params.paymentMethod,
          agreementAcceptedAt: params.agreementAcceptedAt,
          phoneNumberVerifiedAt: params.phoneNumberVerifiedAt,
          smsVerificationId: params.smsVerificationId,
          emailVerificationId: params.emailVerificationId,
          partnerUserRef,
          redirectUrl: params.redirectUrl,
        }),
      })
      const data = (await res.json()) as OnrampUrlResponse
      if (!res.ok || data.error) {
        throw new Error(data.errorMessage ?? data.error ?? `Onramp request failed (${res.status})`)
      }
      if (!data.paymentLink) {
        throw new Error('Onramp response missing payment link')
      }
      return data.paymentLink
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown onramp error'
      setError(message)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [])

  return {
    initiateVerification,
    submitVerification,
    createOnrampOrder,
    isLoading,
    error,
    clearError,
  }
}
