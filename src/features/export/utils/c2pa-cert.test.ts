// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { WalletClient } from 'viem'
import { clearC2paCertIdCache, getC2paCertId } from './c2pa-cert'

const wallet = '0x0000000000000000000000000000000000000001'
const challenge = { nonce: '0x01', expiresAt: 2000000000, domain: {}, types: {} }

describe('optional export identity', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearC2paCertIdCache()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('continues without identity when the challenge endpoint never responds', async () => {
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(() => {}),
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = getC2paCertId(wallet, {} as WalletClient)
    await vi.advanceTimersByTimeAsync(15000)
    await expect(result).resolves.toBeNull()
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(true)
  })

  it('does not request a certificate after a timed out wallet prompt resolves', async () => {
    let finishSigning!: (signature: `0x${string}`) => void
    const signTypedData = vi.fn(
      () =>
        new Promise<`0x${string}`>((resolve) => {
          finishSigning = resolve
        }),
    )
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(challenge)))
    vi.stubGlobal('fetch', fetchMock)
    const result = getC2paCertId(wallet, { signTypedData } as unknown as WalletClient)
    await vi.advanceTimersByTimeAsync(15000)
    await expect(result).resolves.toBeNull()
    finishSigning('0x1234')
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('settles immediately on cancellation even if fetch ignores abort', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )
    const controller = new AbortController()
    const result = getC2paCertId(wallet, {} as WalletClient, controller.signal)
    controller.abort()
    await expect(result).resolves.toBeNull()
  })
})
