import { describe, expect, it, vi } from 'vitest';
import { formatBillingErrorDetail } from './billing-error-detail';

describe('formatBillingErrorDetail', () => {
  it('maps wallet not ready', () => {
    expect(formatBillingErrorDetail(new Error('Wallet not ready'))).toContain(
      'initializing'
    );
  });

  it('maps ERC-20 paymaster misconfig', () => {
    expect(
      formatBillingErrorDetail(new Error('Policy is ERC20, but erc20 capability is missing'))
    ).toContain('Gas policy');
  });

  it('includes tx link when hash provided', () => {
    const detail = formatBillingErrorDetail(
      new Error('Transaction failed (status 0)'),
      '0xabc123'
    );
    expect(detail).toContain('arbiscan.io/tx/0xabc123');
  });

  it('truncates very long messages', () => {
    const long = 'x'.repeat(300);
    expect(formatBillingErrorDetail(long).length).toBeLessThanOrEqual(240);
  });
});

describe('getLiveAiBillingConfigIssues', () => {
  it('reports missing superfluid receiver when unset', async () => {
    vi.stubEnv('VITE_SUPERFLUID_RECEIVER', '');
    vi.stubEnv('VITE_ALCHEMY_API_KEY', 'test-key');
    vi.stubEnv('VITE_ALCHEMY_POLICY_ID', 'test-policy');
    vi.stubEnv('VITE_DAYDREAM_API_KEY', 'test-daydream');
    const { getLiveAiBillingConfigIssues } = await import('../config/billing-config');
    const codes = getLiveAiBillingConfigIssues().map((i) => i.code);
    expect(codes).toContain('missing_superfluid_receiver');
    vi.unstubAllEnvs();
  });
});
