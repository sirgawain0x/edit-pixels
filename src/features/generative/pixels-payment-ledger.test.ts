import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisKeys = new Set<string>()

vi.mock('../../../api/_redis-client.js', () => ({
  isRedisConfigured: () => true,
  getRedis: async () => ({
    set: async (key: string, _value: string, opts?: { nx?: boolean }) => {
      if (opts?.nx && redisKeys.has(key)) return null
      redisKeys.add(key)
      return 'OK'
    },
    get: async () => null,
    del: async (key: string) => {
      redisKeys.delete(key)
      return 1
    },
  }),
}))

const { consumePaymentTxLog } = await import('../../../api/_payment-ledger.js')

describe('consumePaymentTxLog', () => {
  beforeEach(() => {
    redisKeys.clear()
    vi.stubEnv('KV_REST_API_URL', 'https://example.com')
    vi.stubEnv('KV_REST_API_TOKEN', 'token')
  })

  it('rejects replay of the same txHash and log index', async () => {
    const txHash = `0x${'ab'.repeat(32)}`
    const first = await consumePaymentTxLog(txHash, 2, {
      wallet: '0x1111111111111111111111111111111111111111',
      purpose: 'test',
    })
    expect(first.ok).toBe(true)
    const second = await consumePaymentTxLog(txHash, 2, {
      wallet: '0x1111111111111111111111111111111111111111',
      purpose: 'test',
    })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toMatch(/already used/i)
  })
})
