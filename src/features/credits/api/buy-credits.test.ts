import { describe, expect, it } from 'vitest';
import {
  buildBuyCreditsApproveCalldata,
  buildBuyCreditsCalldata,
  buildPayAiRenderCalldata,
  classifyPayFailure,
  getBuyCreditsSelector,
} from './buy-credits';

const MOCK_PAYMENT_CONTRACT = '0x1234567890123456789012345678901234567890' as `0x${string}`;
const APPROVE_SELECTOR = '0x095ea7b3';
const BUY_CREDITS_SELECTOR = '0x7ce7cf1b';

vi.mock('@/config/billing', () => ({
  USDC_DECIMALS: 6,
  getPaymentContractAddress: vi.fn(() => MOCK_PAYMENT_CONTRACT),
}));

describe('buildBuyCreditsCalldata', () => {
  it('encodes buyCredits(uint8) for a valid pack id', () => {
    const data = buildBuyCreditsCalldata(1);
    expect(data).toBeDefined();
    expect(data?.startsWith(BUY_CREDITS_SELECTOR)).toBe(true);
  });

  it('returns undefined for out-of-range pack ids', () => {
    expect(buildBuyCreditsCalldata(-1)).toBeUndefined();
    expect(buildBuyCreditsCalldata(256)).toBeUndefined();
  });
});

describe('buildPayAiRenderCalldata', () => {
  it('encodes payAiRender with 6-decimal USDC amount', () => {
    const data = buildPayAiRenderCalldata(250_000);
    expect(data).toBeDefined();
    expect(data?.startsWith('0x')).toBe(true);
  });
});

describe('buildBuyCreditsApproveCalldata', () => {
  it('approves the exact pack price in 6-decimal USDC', () => {
    const data = buildBuyCreditsApproveCalldata(MOCK_PAYMENT_CONTRACT, 15_000_000);
    expect(data.startsWith(APPROVE_SELECTOR)).toBe(true);
    expect(data.toLowerCase()).toContain(MOCK_PAYMENT_CONTRACT.toLowerCase().slice(2));
    expect(data).toContain('00e4e1c0');
  });

  it('encodes small pack prices correctly', () => {
    const data = buildBuyCreditsApproveCalldata(MOCK_PAYMENT_CONTRACT, 5_000_000);
    expect(data.startsWith(APPROVE_SELECTOR)).toBe(true);
    expect(data).toContain('004c4b40');
  });
});

describe('classifyPayFailure', () => {
  it('classifies allowance errors as insufficient_balance', () => {
    expect(classifyPayFailure(new Error('ERC20: transfer amount exceeds allowance'))).toBe(
      'insufficient_balance'
    );
  });

  it('classifies session limit errors', () => {
    expect(classifyPayFailure(new Error('Session spending limit exceeded'))).toBe(
      'session_limit_exceeded'
    );
  });

  it('defaults to rpc_or_unknown', () => {
    expect(classifyPayFailure(new Error('Random RPC failure'))).toBe('rpc_or_unknown');
  });
});

describe('getBuyCreditsSelector', () => {
  it('returns the function selector for buyCredits(uint8)', () => {
    expect(getBuyCreditsSelector()).toBe(BUY_CREDITS_SELECTOR);
  });
});
