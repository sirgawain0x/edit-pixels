import { isSuperfluidConfigured } from '@/config/superfluid';
import { isDaydreamConfigured } from '../api/create-stream';
import { isLivepeerStudioConfigured } from '../api/livepeer-studio-live-video';

export type LiveAiBillingConfigIssueCode =
  | 'missing_superfluid_receiver'
  | 'missing_alchemy_api_key'
  | 'missing_alchemy_policy'
  | 'missing_ai_provider';

export interface LiveAiBillingConfigIssue {
  code: LiveAiBillingConfigIssueCode;
  /** Operator-facing hint for logs / dev UI. */
  message: string;
}

/**
 * Validates client-side env required for Live AI billing and stream creation.
 * Does not check secret values — only presence of required VITE_* vars.
 */
export function getLiveAiBillingConfigIssues(): LiveAiBillingConfigIssue[] {
  const issues: LiveAiBillingConfigIssue[] = [];

  if (!isSuperfluidConfigured()) {
    issues.push({
      code: 'missing_superfluid_receiver',
      message: 'Set VITE_SUPERFLUID_RECEIVER to the Arbitrum treasury address.',
    });
  }

  const alchemyKey = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined;
  if (!alchemyKey?.trim()) {
    issues.push({
      code: 'missing_alchemy_api_key',
      message: 'Set VITE_ALCHEMY_API_KEY for smart wallet and Arbitrum RPC.',
    });
  }

  const policyId = import.meta.env.VITE_ALCHEMY_POLICY_ID as string | undefined;
  if (!policyId?.trim()) {
    issues.push({
      code: 'missing_alchemy_policy',
      message: 'Set VITE_ALCHEMY_POLICY_ID for gas sponsorship on user operations.',
    });
  }

  if (!isDaydreamConfigured() && !isLivepeerStudioConfigured()) {
    issues.push({
      code: 'missing_ai_provider',
      message:
        'Set VITE_DAYDREAM_API_KEY or VITE_LIVEPEER_STUDIO_API_KEY for AI stream creation.',
    });
  }

  return issues;
}

export function isLiveAiBillingEnvReady(): boolean {
  return getLiveAiBillingConfigIssues().length === 0;
}
