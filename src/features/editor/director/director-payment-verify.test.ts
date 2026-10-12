import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createPublicClient } from 'viem'

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>()
  return {
    ...actual,
    createPublicClient: vi.fn(),
  }
})

describe('verifyDirectorPayment payer vs tx sender', () => {
  beforeEach(() => {
    vi.mocked(createPublicClient).mockReset()
    vi.stubEnv('PIXELS_TREASURY_ADDRESS', '0x1111111111111111111111111111111111111111')
  })

  it('rejects when the claimed EOA payer did not send the CRTVAI transfer', async () => {
    const payer = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const other = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const treasury = '0x1111111111111111111111111111111111111111'

    vi.mocked(createPublicClient).mockReturnValue({
      getTransactionReceipt: async () => ({
        status: 'success',
        logs: [
          {
            address: '0xecb695544a3d2a64d579b3828f3f60f6932f4846',
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              `0x000000000000000000000000${other.slice(2)}`,
              `0x000000000000000000000000${treasury.slice(2)}`,
            ],
            data: '0x1',
            logIndex: 0,
          },
        ],
      }),
      getTransaction: async () => ({ from: other, to: '0xecb695544a3d2a64d579b3828f3f60f6932f4846' }),
    } as never)

    const { verifyDirectorPayment } = await import('../../../../api/director-billing.js')
    const result = await verifyDirectorPayment({
      txHash: '0x' + 'de'.repeat(32),
      from: payer,
      minAmountWei: 1n,
      verifiedSignerAddress: payer,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/sender does not match payer wallet/i)
    }
  })
})
