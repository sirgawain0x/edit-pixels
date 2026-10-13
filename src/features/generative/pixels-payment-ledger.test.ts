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
    get: async (key: string) => (redisKeys.has(key) ? '{}' : null),
    del: async (key: string) => {
      redisKeys.delete(key)
      return 1
    },
  }),
}))

const { consumePaymentTxLog, releasePaymentTxLog } = await import('../../../api/_payment-ledger.js')

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

  it('allows two users in one bundler tx; release one log only', async () => {
    const txHash = `0x${'cd'.repeat(32)}`
    const userA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const userB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

    const a = await consumePaymentTxLog(txHash, 1, { wallet: userA, purpose: 'director' })
    const b = await consumePaymentTxLog(txHash, 3, { wallet: userB, purpose: 'director' })
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)

    await releasePaymentTxLog(txHash, 1)

    const replayReleased = await consumePaymentTxLog(txHash, 1, {
      wallet: userA,
      purpose: 'director-retry',
    })
    expect(replayReleased.ok).toBe(true)

    const replayStillConsumed = await consumePaymentTxLog(txHash, 3, {
      wallet: userB,
      purpose: 'director-replay',
    })
    expect(replayStillConsumed.ok).toBe(false)
    if (!replayStillConsumed.ok) expect(replayStillConsumed.reason).toMatch(/already used/i)
  })

  it('rejects consumption when prod-era hash-only ledger key exists', async () => {
    const txHash = `0x${'ef'.repeat(32)}`
    const normalized = txHash.toLowerCase()
    redisKeys.add(`pixels:payment:tx:${normalized}`)

    const atLog2 = await consumePaymentTxLog(txHash, 2, {
      wallet: '0xcccccccccccccccccccccccccccccccccccccccc',
      purpose: 'director',
    })
    expect(atLog2.ok).toBe(false)
    if (!atLog2.ok) expect(atLog2.reason).toMatch(/already used/i)

    const atLog0 = await consumePaymentTxLog(txHash, 0, {
      wallet: '0xcccccccccccccccccccccccccccccccccccccccc',
      purpose: 'director',
    })
    expect(atLog0.ok).toBe(false)
  })

  it('release does not remove prod-era hash-only ledger keys', async () => {
    const txHash = `0x${'12'.repeat(32)}`
    const normalized = txHash.toLowerCase()
    const legacyKey = `pixels:payment:tx:${normalized}`

    await consumePaymentTxLog(txHash, 4, {
      wallet: '0xdddddddddddddddddddddddddddddddddddddddd',
      purpose: 'director',
    })
    redisKeys.add(legacyKey)

    await releasePaymentTxLog(txHash, 4)

    expect(redisKeys.has(legacyKey)).toBe(true)
    expect(redisKeys.has(`pixels:payment:tx:${normalized}:4`)).toBe(false)
  })
})
