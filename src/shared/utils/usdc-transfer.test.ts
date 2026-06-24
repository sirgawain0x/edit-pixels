import { describe, expect, it } from 'vitest';
import { buildUsdcTransferCalldata, validateUsdcSend } from './usdc-transfer';

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

describe('buildUsdcTransferCalldata', () => {
  it('encodes an ERC-20 transfer call', () => {
    const data = buildUsdcTransferCalldata(RECIPIENT, 1_000_000n);
    expect(data.startsWith('0xa9059cbb')).toBe(true);
  });
});
