/**
 * @deprecated Per-render AI payments now use CRTVAI meToken mint/burn on Base.
 * This module is kept as a stub for backward compatibility.
 */

export type PayAiRenderFailureReason =
  | 'insufficient_balance'
  | 'session_limit_exceeded'
  | 'rpc_or_unknown';

 
export function buildPayAiRenderCalldata(amountUsdc6: number): `0x${string}` | undefined {
  void amountUsdc6;
  return undefined;
}

export function classifyPayFailure(error: unknown): PayAiRenderFailureReason {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  if (
    lower.includes('allowance') ||
    lower.includes('insufficient') ||
    lower.includes('balance') ||
    lower.includes('exceeds balance')
  ) {
    return 'insufficient_balance';
  }
  if (
    lower.includes('session') ||
    lower.includes('limit exceeded') ||
    lower.includes('spending limit') ||
    lower.includes('allowance exceeded')
  ) {
    return 'session_limit_exceeded';
  }
  return 'rpc_or_unknown';
}