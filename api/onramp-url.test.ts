import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { GET } from './onramp-url.js';
import { generateJwt } from '@coinbase/cdp-sdk/auth';

vi.mock('@coinbase/cdp-sdk/auth', () => ({
  generateJwt: vi.fn().mockResolvedValue('mock-jwt'),
}));

const validAddress = '0x1111111111111111111111111111111111111111';
const validEmail = 'test@example.com';
const validPhone = '5551234567';

function makeRequest(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return new Request(`https://example.com/api/onramp-url?${qs}`);
}

describe('GET /api/onramp-url', () => {
  beforeEach(() => {
    vi.stubEnv('COINBASE_CDP_API_KEY_ID', 'test-key-id');
    vi.stubEnv('COINBASE_CDP_API_KEY_SECRET', 'test-secret');
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns 503 when CDP credentials are missing', async () => {
    vi.unstubAllEnvs();
    const res = await GET(makeRequest({ address: validAddress, email: validEmail, phone: validPhone, amount: '25' }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('missing CDP API credentials');
  });

  it('returns 400 for invalid address', async () => {
    const res = await GET(makeRequest({ address: 'not-an-address', email: validEmail, phone: validPhone, amount: '25' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing email', async () => {
    const res = await GET(makeRequest({ address: validAddress, phone: validPhone, amount: '25' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid phone', async () => {
    const res = await GET(makeRequest({ address: validAddress, email: validEmail, phone: '123', amount: '25' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid amount', async () => {
    const res = await GET(makeRequest({ address: validAddress, email: validEmail, phone: validPhone, amount: '-5' }));
    expect(res.status).toBe(400);
  });

  it('returns paymentLink on success and defaults to Apple Pay', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ paymentLink: 'https://pay.coinbase.com/buy?order=abc', orderId: 'order-123' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await GET(makeRequest({ address: validAddress, email: validEmail, phone: validPhone, amount: '25' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { paymentLink: string; orderId: string | null; origin: string };
    expect(body.paymentLink).toContain('https://pay.coinbase.com/buy?order=abc');
    expect(body.orderId).toBe('order-123');
    expect(body.origin).toBe('https://pay.coinbase.com');

    expect(generateJwt).toHaveBeenCalledWith(
      expect.objectContaining({
        requestMethod: 'POST',
        requestHost: 'api.cdp.coinbase.com',
        requestPath: '/platform/v2/onramp/orders',
      })
    );

    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(callArgs[1].body as string) as {
      destination: { address: string; network: string; asset: string };
      amount: { value: string; currency: string };
      paymentMethod: string;
      domain: string;
    };
    expect(requestBody.destination.address).toBe(validAddress.toLowerCase());
    expect(requestBody.destination.network).toBe('base');
    expect(requestBody.destination.asset).toBe('USDC');
    expect(requestBody.amount.value).toBe('25.00');
    expect(requestBody.amount.currency).toBe('USD');
    expect(requestBody.paymentMethod).toBe('GUEST_CHECKOUT_APPLE_PAY');
    expect(requestBody.domain).toBe('create.creativeplatform.xyz');
  });

  it('passes through Google Pay payment method', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ paymentLink: 'https://pay.coinbase.com/buy?order=abc' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await GET(
      makeRequest({
        address: validAddress,
        email: validEmail,
        phone: validPhone,
        amount: '10',
        paymentMethod: 'GUEST_CHECKOUT_GOOGLE_PAY',
      })
    );
    expect(res.status).toBe(200);
    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(callArgs[1].body as string) as { paymentMethod: string; amount: { value: string } };
    expect(requestBody.paymentMethod).toBe('GUEST_CHECKOUT_GOOGLE_PAY');
    expect(requestBody.amount.value).toBe('10.00');
  });

  it('appends redirectUrl to paymentLink', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ paymentLink: 'https://pay.coinbase.com/buy?order=abc' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await GET(
      makeRequest({
        address: validAddress,
        email: validEmail,
        phone: validPhone,
        amount: '10',
        redirectUrl: 'https://create.creativeplatform.xyz/success',
      })
    );
    const body = (await res.json()) as { paymentLink: string };
    expect(body.paymentLink).toContain('redirectUrl=https%3A%2F%2Fcreate.creativeplatform.xyz%2Fsuccess');
  });

  it('returns 502 when Coinbase API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: async () => 'Bad Request' }));
    const res = await GET(makeRequest({ address: validAddress, email: validEmail, phone: validPhone, amount: '25' }));
    expect(res.status).toBe(502);
  });

  it('returns 502 when paymentLink is missing from response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const res = await GET(makeRequest({ address: validAddress, email: validEmail, phone: validPhone, amount: '25' }));
    expect(res.status).toBe(502);
  });
});
