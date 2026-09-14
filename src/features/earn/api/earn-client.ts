import {
  getEarnActionApiUrl,
  getEarnDepositApiUrl,
  getEarnPositionApiUrl,
  getEarnVaultApiUrl,
  getEarnWithdrawApiUrl,
} from '@/features/earn/config'
import type { EarnActionInfo, EarnPositionInfo, EarnVaultInfo } from '@/features/earn/types'

async function readJsonError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string }
    if (typeof body.error === 'string' && body.error.length > 0) return body.error
  } catch {
    // ignore
  }
  return `Request failed (${response.status})`
}

export async function fetchEarnVault(): Promise<EarnVaultInfo> {
  const response = await fetch(getEarnVaultApiUrl())
  if (!response.ok) throw new Error(await readJsonError(response))
  return (await response.json()) as EarnVaultInfo
}

export async function fetchEarnPosition(accessToken: string): Promise<EarnPositionInfo> {
  const response = await fetch(getEarnPositionApiUrl(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error(await readJsonError(response))
  return (await response.json()) as EarnPositionInfo
}

export async function postEarnDeposit(
  accessToken: string,
  amount: string,
): Promise<EarnActionInfo> {
  const response = await fetch(getEarnDepositApiUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ amount }),
  })
  if (!response.ok) throw new Error(await readJsonError(response))
  return (await response.json()) as EarnActionInfo
}

export async function postEarnWithdraw(
  accessToken: string,
  params: { amount: string } | { max: true },
): Promise<EarnActionInfo> {
  const response = await fetch(getEarnWithdrawApiUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  })
  if (!response.ok) throw new Error(await readJsonError(response))
  return (await response.json()) as EarnActionInfo
}

export async function fetchEarnAction(
  accessToken: string,
  actionId: string,
): Promise<EarnActionInfo> {
  const response = await fetch(getEarnActionApiUrl(actionId), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error(await readJsonError(response))
  return (await response.json()) as EarnActionInfo
}

const POLL_INTERVAL_MS = 1_500
const POLL_TIMEOUT_MS = 90_000

export async function pollEarnActionUntilSettled(
  accessToken: string,
  actionId: string,
): Promise<EarnActionInfo> {
  const started = Date.now()
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const action = await fetchEarnAction(accessToken, actionId)
    if (action.status !== 'pending') return action
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error('Earn action timed out — check again shortly')
}
