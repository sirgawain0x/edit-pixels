import { useCallback, useState } from 'react'
import { getOnrampApiUrl } from '@/config/onramp'

interface UseOnrampUrlResult {
  getOnrampUrl: (params: OnrampParams) => Promise<string | null>
  isLoading: boolean
  error: string | null
}

export interface OnrampParams {
  address: `0x${string}`
  email: string
  phone: string
  amount: string
  paymentMethod?: string
  partnerUserRef?: string
  redirectUrl?: string
}

interface OnrampUrlResponse {
  paymentLink?: string
  orderId?: string | null
  error?: string
}

export function useOnrampUrl(): UseOnrampUrlResult {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const getOnrampUrl = useCallback(async (params: OnrampParams): Promise<string | null> => {
    setIsLoading(true)
    setError(null)
    try {
      const url = new URL(getOnrampApiUrl(), window.location.origin)
      url.searchParams.set('address', params.address)
      url.searchParams.set('email', params.email)
      url.searchParams.set('phone', params.phone)
      url.searchParams.set('amount', params.amount)
      if (params.paymentMethod) url.searchParams.set('paymentMethod', params.paymentMethod)
      if (params.partnerUserRef) url.searchParams.set('partnerUserRef', params.partnerUserRef)
      if (params.redirectUrl) url.searchParams.set('redirectUrl', params.redirectUrl)

      const res = await fetch(url.toString())
      const data = (await res.json()) as OnrampUrlResponse
      if (!res.ok || data.error) {
        throw new Error(data.error ?? `Onramp request failed (${res.status})`)
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

  return { getOnrampUrl, isLoading, error }
}
