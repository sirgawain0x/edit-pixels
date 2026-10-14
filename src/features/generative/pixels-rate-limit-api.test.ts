import { describe, expect, it, vi, beforeEach } from 'vitest'

const limitMock = vi.hoisted(() => vi.fn())

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class MockRatelimit {
    static slidingWindow(limit: number, window: string) {
      return { limit, window }
    }
    limit = limitMock
  },
}))

const getRedis = vi.hoisted(() => vi.fn())

vi.mock('../../../api/_redis-client.js', () => ({
  getRedis,
}))

import {
  getClientIp,
  rateLimitByClientIp,
  rateLimitByIdentity,
  resetRateLimitersForTests,
} from '../../../api/_rate-limit.js'

describe('getClientIp', () => {
  it('prefers x-vercel-forwarded-for', () => {
    const request = new Request('http://localhost/api/test', {
      headers: {
        'x-vercel-forwarded-for': '198.51.100.8',
        'x-real-ip': '10.0.0.1',
        'x-forwarded-for': '203.0.113.1, 10.0.0.2',
      },
    })
    expect(getClientIp(request)).toBe('198.51.100.8')
  })

  it('falls back to x-real-ip before x-forwarded-for', () => {
    const request = new Request('http://localhost/api/test', {
      headers: {
        'x-real-ip': '198.51.100.4',
        'x-forwarded-for': '203.0.113.1, 10.0.0.2',
      },
    })
    expect(getClientIp(request)).toBe('198.51.100.4')
  })

  it('uses the first x-forwarded-for hop when Vercel headers are absent', () => {
    const request = new Request('http://localhost/api/test', {
      headers: { 'x-forwarded-for': '203.0.113.1, 10.0.0.2' },
    })
    expect(getClientIp(request)).toBe('203.0.113.1')
  })
})

describe('rateLimitByClientIp', () => {
  beforeEach(() => {
    limitMock.mockReset()
    getRedis.mockReset()
    resetRateLimitersForTests()
    delete process.env.PIXELS_RATE_LIMIT_MODE
  })

  it('returns 429 with rate limit headers when enforce mode blocks', async () => {
    process.env.PIXELS_RATE_LIMIT_MODE = 'enforce'
    getRedis.mockResolvedValue({})
    const resetAt = Date.now() + 45_000
    limitMock.mockResolvedValue({ success: false, remaining: 0, reset: resetAt })

    const response = await rateLimitByClientIp(
      new Request('http://localhost/api/flow-quote', {
        headers: { 'x-forwarded-for': '203.0.113.9' },
      }),
      'quote',
    )

    expect(response?.status).toBe(429)
    expect(response?.headers.get('Retry-After')).toBeTruthy()
    expect(response?.headers.get('RateLimit-Limit')).toBe('30')
  })

  it('fail-opens quote routes when Redis is unavailable in enforce mode', async () => {
    process.env.PIXELS_RATE_LIMIT_MODE = 'enforce'
    getRedis.mockResolvedValue(null)

    const response = await rateLimitByClientIp(new Request('http://localhost/api/flow-quote'), 'quote')
    expect(response).toBeNull()
  })

  it('fail-closes render routes when Redis is unavailable in enforce mode', async () => {
    process.env.PIXELS_RATE_LIMIT_MODE = 'enforce'
    getRedis.mockResolvedValue(null)

    const response = await rateLimitByClientIp(
      new Request('http://localhost/api/flow-run'),
      'render',
    )
    expect(response?.status).toBe(503)
    expect(response?.headers.get('Retry-After')).toBe('60')
  })

  it('allows render routes in observe mode when Redis is unavailable', async () => {
    process.env.PIXELS_RATE_LIMIT_MODE = 'observe'
    getRedis.mockResolvedValue(null)

    const response = await rateLimitByClientIp(
      new Request('http://localhost/api/flow-run'),
      'render',
    )
    expect(response).toBeNull()
  })

  it('allows render routes in observe mode when limit() throws', async () => {
    process.env.PIXELS_RATE_LIMIT_MODE = 'observe'
    getRedis.mockResolvedValue({})
    limitMock.mockRejectedValue(new Error('upstash timeout'))

    const response = await rateLimitByClientIp(
      new Request('http://localhost/api/flow-run'),
      'render',
    )
    expect(response).toBeNull()
  })

  it('recovers after an initial null Redis client', async () => {
    process.env.PIXELS_RATE_LIMIT_MODE = 'enforce'
    getRedis.mockResolvedValueOnce(null).mockResolvedValueOnce({})
    limitMock.mockResolvedValue({ success: true, remaining: 9, reset: Date.now() + 60_000 })

    const first = await rateLimitByClientIp(new Request('http://localhost/api/flow-quote'), 'quote')
    expect(first).toBeNull()

    const second = await rateLimitByClientIp(new Request('http://localhost/api/flow-quote'), 'quote')
    expect(second).toBeNull()
    expect(getRedis).toHaveBeenCalledTimes(2)
    expect(limitMock).toHaveBeenCalled()
  })
})

describe('rateLimitByIdentity', () => {
  beforeEach(() => {
    limitMock.mockReset()
    getRedis.mockReset()
    resetRateLimitersForTests()
    delete process.env.PIXELS_RATE_LIMIT_MODE
  })

  it('keys identity limits to the verified signer', async () => {
    process.env.PIXELS_RATE_LIMIT_MODE = 'enforce'
    getRedis.mockResolvedValue({})
    limitMock.mockResolvedValue({ success: true, remaining: 9, reset: Date.now() + 60_000 })

    const signer = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const response = await rateLimitByIdentity(
      new Request('http://localhost/api/flow-run'),
      'render',
      signer,
    )
    expect(response).toBeNull()
    expect(limitMock).toHaveBeenCalledWith(signer)
  })
})
