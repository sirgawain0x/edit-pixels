/**
 * Client/server shared message builder for signed credit operations.
 * Must stay byte-identical to api/_wallet-auth.ts buildCreditsAuthMessage.
 */
export function buildCreditsAuthMessage(
  action: string,
  address: `0x${string}`,
  timestamp: number,
  nonce: string,
  extra?: string
): string {
  const lines = [
    `Pixels credits ${action}`,
    `address: ${address.toLowerCase()}`,
    `timestamp: ${timestamp}`,
    `nonce: ${nonce}`,
  ];
  if (extra) lines.push(extra);
  return lines.join('\n');
}

export function generateCreditsNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
