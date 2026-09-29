export function getEarnVaultApiUrl(): string {
  return '/api/earn/vault'
}

export function getEarnPositionApiUrl(): string {
  return '/api/earn/position'
}

export function getEarnDepositApiUrl(): string {
  return '/api/earn/deposit'
}

export function getEarnWithdrawApiUrl(): string {
  return '/api/earn/withdraw'
}

export function getEarnActionApiUrl(actionId: string): string {
  return `/api/earn/action?id=${encodeURIComponent(actionId)}`
}
