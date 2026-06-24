import { describe, expect, it, vi } from 'vitest';

vi.mock('@/config/gas-sponsorship', () => ({
  getPurchaseGasBufferUsdc6: vi.fn(() => 0),
}));

import { getPurchaseGasBufferUsdc6 } from '@/config/gas-sponsorship';
import {
  buildUsdcTransferCalldata,
  getMaxSendableUsdc,
  validateUsdcSend,
} from './usdc-transfer';

const mockedGasBuffer = vi.mocked(getPurchaseGasBufferUsdc6);

const SENDER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const RECIPIENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

describe('validateUsdcSend', () => {
  it('accepts a valid recipient and amount within balance', () => {
    const result = validateUsdcSend({
      recipient: RECIPIENT,
      amount: '1.5',
      balance: '10',
      senderAddress: SENDER,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipient).toBe(RECIPIENT);
      expect(result.amountUsdc6).toBe(1_500_000n);
    }
  });

  it('accepts trailing and leading decimal points', () => {
    const trailingResult = validateUsdcSend({
      recipient: RECIPIENT,
      amount: '1.',
      balance: '10',
      senderAddress: SENDER,
    });
    expect(trailingResult.ok).toBe(true);
    if (trailingResult.ok) {
      expect(trailingResult.amountUsdc6).toBe(1_000_000n);
    }

    const leadingResult = validateUsdcSend({
      recipient: RECIPIENT,
      amount: '.5',
      balance: '10',
      senderAddress: SENDER,
    });
    expect(leadingResult.ok).toBe(true);
    if (leadingResult.ok) {
      expect(leadingResult.amountUsdc6).toBe(500_000n);
    }
  });

  it('rejects invalid addresses', () => {
    const result = validateUsdcSend({
      recipient: 'not-an-address',
      amount: '1',
      balance: '10',
      senderAddress: SENDER,
    });
    expect(result).toEqual({ ok: false, error: 'Invalid wallet address' });
  });

  it('rejects sending to self', () => {
    const result = validateUsdcSend({
      recipient: SENDER,
      amount: '1',
      balance: '10',
      senderAddress: SENDER,
    });
    expect(result).toEqual({
      ok: false,
      error: 'Cannot send USDC to your own address',
    });
  });

  it('rejects amounts above balance', () => {
    const result = validateUsdcSend({
      recipient: RECIPIENT,
      amount: '5',
      balance: '4.99',
      senderAddress: SENDER,
    });
    expect(result).toEqual({ ok: false, error: 'Insufficient USDC balance' });
  });

  it('rejects amounts that exceed spendable balance after gas reserve', () => {
    const result = validateUsdcSend({
      recipient: RECIPIENT,
      amount: '10',
      balance: '10',
      senderAddress: SENDER,
      gasReserveUsdc6: 1_000_000,
    });
    expect(result).toEqual({
      ok: false,
      error: 'Insufficient USDC after reserving gas fees',
    });
  });

  it('rejects more than six decimal places', () => {
    const result = validateUsdcSend({
      recipient: RECIPIENT,
      amount: '0.0000001',
      balance: '10',
      senderAddress: SENDER,
    });
    expect(result).toEqual({
      ok: false,
      error: 'USDC supports up to 6 decimal places',
    });
  });
});

describe('getMaxSendableUsdc', () => {
  const ARBITRUM_ONE_CHAIN_ID = 42_161;

  it('returns full balance when no gas reserve applies', () => {
    mockedGasBuffer.mockReturnValue(0);
    expect(getMaxSendableUsdc('5', ARBITRUM_ONE_CHAIN_ID)).toBe('5');
  });

  it('subtracts gas reserve when configured', () => {
    mockedGasBuffer.mockReturnValue(1_000_000);
    expect(getMaxSendableUsdc('2', ARBITRUM_ONE_CHAIN_ID)).toBe('1');
  });

  it('returns null when balance does not exceed gas reserve', () => {
    mockedGasBuffer.mockReturnValue(1_000_000);
    expect(getMaxSendableUsdc('0.5', ARBITRUM_ONE_CHAIN_ID)).toBeNull();
  });
});

describe('buildUsdcTransferCalldata', () => {
  it('encodes an ERC-20 transfer call', () => {
    const data = buildUsdcTransferCalldata(RECIPIENT, 1_000_000n);
    expect(data.startsWith('0xa9059cbb')).toBe(true);
  });
});
