import {
  formatUsdPrice,
  LIVE_AI_DAILY_SPEND_CAP_USD,
} from '@/shared/utils/currency-display';

export type StartFlowBillingError =
  | 'insufficient_balance'
  | 'session_limit_exceeded'
  | 'rpc_or_unknown'
  | 'wallet_not_ready'
  | null;

export function getStartFlowErrorMessage(
  billingError: StartFlowBillingError
): string {
  switch (billingError) {
    case 'insufficient_balance':
      return 'Not enough USDC on Arbitrum to start the payment stream. Top up USDC and try again.';
    case 'wallet_not_ready':
      return 'Wallet initializing — try again in a moment.';
    case 'session_limit_exceeded':
      return `Daily spend cap reached (${formatUsdPrice(LIVE_AI_DAILY_SPEND_CAP_USD)}). Re-authorize your session key or wait for reset.`;
    case 'rpc_or_unknown':
      return 'Billing failed. Check your connection and try again.';
    default:
      return 'Could not start the USDC payment stream. Live AI was not started.';
  }
}
