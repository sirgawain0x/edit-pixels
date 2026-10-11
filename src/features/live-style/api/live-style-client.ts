import type { LiveStyleTransportConnectInfo } from '@/features/live-style/lib/transport'
import type { LiveStyleCapPresetUsd } from '@/features/live-style/lib/config'
import type { LiveStyleSpendAuthMethod } from '@/features/live-style/lib/payment/types'

export interface LiveStyleCreateResponse {
  sessionId: string
  connect: LiveStyleTransportConnectInfo
  maxBillableSeconds: number
  heartbeatIntervalMs: number
  capUsdc6: number
  isPremium: boolean
}

export async function postLiveStyleSession(
  accessToken: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch('/api/live-style-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
}

export async function createLiveStyleSessionClient(input: {
  accessToken: string
  walletAddress: string
  capPresetUsd: LiveStyleCapPresetUsd
  spendAuthProof: string
  spendAuthMethod?: LiveStyleSpendAuthMethod
  providerId?: string
}): Promise<LiveStyleCreateResponse> {
  const res = await postLiveStyleSession(input.accessToken, {
    action: 'create',
    walletAddress: input.walletAddress,
    capPresetUsd: input.capPresetUsd,
    spendAuthProof: input.spendAuthProof,
    spendAuthMethod: input.spendAuthMethod ?? 'erc20-approve',
    providerId: input.providerId ?? 'mock',
  })
  if (!res.ok) throw new Error(`create failed (${res.status})`)
  return (await res.json()) as LiveStyleCreateResponse
}
