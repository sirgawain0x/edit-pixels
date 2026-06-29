import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncPurchaseCredits } from './sync-purchase';

describe('syncPurchaseCredits', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns success on first ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, creditsAdded: 50, balance: 50 }),
        { status: 200 }
      )
    );

    const result = await syncPurchaseCredits(
      '0x1234567890123456789012345678901234567890',
      '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'
    );

    expect(result.ok).toBe(true);
    expect(result.creditsAdded).toBe(50);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 500 then succeeds', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, reason: 'error' }), {
          status: 500,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, creditsAdded: 50, balance: 50 }),
          { status: 200 }
        )
      );

    const promise = syncPurchaseCredits(
      '0x1234567890123456789012345678901234567890',
      '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('marks syncPending after exhausted retries', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: false, reason: 'error' }), {
        status: 500,
      })
    );

    const promise = syncPurchaseCredits(
      '0x1234567890123456789012345678901234567890',
      '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(result.syncPending).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(6);
    vi.useRealTimers();
  });

  it('does not mark syncPending for terminal errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, reason: 'pack_mismatch' }), {
        status: 400,
      })
    );

    const result = await syncPurchaseCredits(
      '0x1234567890123456789012345678901234567890',
      '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'
    );

    expect(result.ok).toBe(false);
    expect(result.syncPending).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on receipt_not_found then succeeds', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, reason: 'receipt_not_found' }), {
          status: 404,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, creditsAdded: 50, balance: 50 }),
          { status: 200 }
        )
      );

    const promise = syncPurchaseCredits(
      '0x1234567890123456789012345678901234567890',
      '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
