import { describe, expect, it } from 'vitest';
import { getStartFlowErrorMessage } from './start-flow-error';

describe('getStartFlowErrorMessage', () => {
  it('maps wallet_not_ready to initializing message', () => {
    expect(getStartFlowErrorMessage('wallet_not_ready')).toContain('initializing');
  });

  it('maps insufficient_balance to top-up message', () => {
    expect(getStartFlowErrorMessage('insufficient_balance')).toContain('USDC');
  });

  it('maps rpc_or_unknown to connection message', () => {
    expect(getStartFlowErrorMessage('rpc_or_unknown')).toContain('connection');
  });

  it('falls back for null billing error', () => {
    expect(getStartFlowErrorMessage(null)).toContain('Could not start');
  });
});
