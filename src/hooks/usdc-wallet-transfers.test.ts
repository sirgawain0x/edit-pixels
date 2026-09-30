import { describe, expect, it, vi } from 'vitest'
import {
  privateKeyToAccount,
  generatePrivateKey,
} from 'viem/accounts'
import {
  encodeFunctionData,
  parseSignature,
  recoverTypedDataAddress,
  serializeSignature,
} from 'viem'
import { USDC_BASE_ADDRESS } from '@/config/metoken'
import {
  buildUsdcReceiveAuthorizationMessage,
  buildUsdcReceiveWithAuthorizationOp,
  createUsdcAuthorizationNonce,
  resolveMoveUsdcAmount,
  signUsdcReceiveWithAuthorization,
  USDC_BASE_EIP712_DOMAIN,
  USDC_RECEIVE_WITH_AUTHORIZATION_TYPES,
} from '@/hooks/usdc-wallet-transfers'

describe('resolveMoveUsdcAmount', () => {
  it('returns 0 when the signer has no USDC', () => {
    expect(
      resolveMoveUsdcAmount({
        signerUsdcBalance: '0',
        smartUsdcBalance: '0',
        requiredUsdc6: 5_000_000,
      }),
    ).toBe(0n)
  })

  it('moves the shortfall when it is less than the signer balance', () => {
    expect(
      resolveMoveUsdcAmount({
        signerUsdcBalance: '5',
        smartUsdcBalance: '1',
        requiredUsdc6: 3_000_000,
      }),
    ).toBe(2_000_000n)
  })

  it('moves the full signer balance when shortfall is not smaller', () => {
    expect(
      resolveMoveUsdcAmount({
        signerUsdcBalance: '5',
        smartUsdcBalance: '0',
        requiredUsdc6: 5_000_000,
      }),
    ).toBe(5_000_000n)

    expect(
      resolveMoveUsdcAmount({
        signerUsdcBalance: '2',
        smartUsdcBalance: '0',
        requiredUsdc6: 5_000_000,
      }),
    ).toBe(2_000_000n)
  })

  it('honors an explicit amountWei capped by signer balance', () => {
    expect(
      resolveMoveUsdcAmount({
        signerUsdcBalance: '5',
        smartUsdcBalance: '0',
        requiredUsdc6: 0,
        amountWei: 1_500_000n,
      }),
    ).toBe(1_500_000n)

    expect(
      resolveMoveUsdcAmount({
        signerUsdcBalance: '1',
        smartUsdcBalance: '0',
        requiredUsdc6: 0,
        amountWei: 5_000_000n,
      }),
    ).toBe(1_000_000n)
  })
})

describe('USDC EIP-3009 receiveWithAuthorization helpers', () => {
  it('creates a 32-byte hex nonce', () => {
    const nonce = createUsdcAuthorizationNonce()
    expect(nonce).toMatch(/^0x[0-9a-f]{64}$/i)
  })

  it('builds a validity window around now', () => {
    const now = 1_700_000_000n
    const message = buildUsdcReceiveAuthorizationMessage(
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      5_000_000n,
      now,
      '0x3333333333333333333333333333333333333333333333333333333333333333',
    )
    expect(message.validAfter).toBe(now - 60n)
    expect(message.validBefore).toBe(now + 3600n)
    expect(message.value).toBe(5_000_000n)
  })

  it('rejects non-positive authorization amounts', () => {
    expect(() =>
      buildUsdcReceiveAuthorizationMessage(
        '0x1111111111111111111111111111111111111111',
        '0x2222222222222222222222222222222222222222',
        0n,
      ),
    ).toThrow(/positive/i)
  })

  it('encodes receiveWithAuthorization calldata with classic v (27/28)', () => {
    const message = buildUsdcReceiveAuthorizationMessage(
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      1_000_000n,
      1_700_000_000n,
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    )
    const signature = serializeSignature({
      r: '0x1111111111111111111111111111111111111111111111111111111111111111',
      s: '0x2222222222222222222222222222222222222222222222222222222222222222',
      yParity: 1,
    })
    const op = buildUsdcReceiveWithAuthorizationOp(message, signature)

    expect(op.target).toBe(USDC_BASE_ADDRESS)
    expect(op.value).toBe(0n)
    expect(op.data.startsWith('0x')).toBe(true)

    // receiveWithAuthorization selector
    expect(op.data.slice(0, 10)).toBe(
      encodeFunctionData({
        abi: [
          {
            type: 'function',
            name: 'receiveWithAuthorization',
            stateMutability: 'nonpayable',
            inputs: [
              { name: 'from', type: 'address' },
              { name: 'to', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'validAfter', type: 'uint256' },
              { name: 'validBefore', type: 'uint256' },
              { name: 'nonce', type: 'bytes32' },
              { name: 'v', type: 'uint8' },
              { name: 'r', type: 'bytes32' },
              { name: 's', type: 'bytes32' },
            ],
            outputs: [],
          },
        ],
        functionName: 'receiveWithAuthorization',
        args: [
          message.from,
          message.to,
          message.value,
          message.validAfter,
          message.validBefore,
          message.nonce,
          28,
          '0x1111111111111111111111111111111111111111111111111111111111111111',
          '0x2222222222222222222222222222222222222222222222222222222222222222',
        ],
      }).slice(0, 10),
    )
    expect(op.data).toContain('000000000000000000000000000000000000000000000000000000000000001c') // v = 28
  })

  it('signs Recoverable EIP-712 ReceiveWithAuthorization typed data', async () => {
    const account = privateKeyToAccount(generatePrivateKey())
    const smartAccount = '0x2222222222222222222222222222222222222222' as const
    const message = buildUsdcReceiveAuthorizationMessage(
      account.address,
      smartAccount,
      2_500_000n,
      1_700_000_000n,
    )

    const walletClient = {
      signTypedData: vi.fn(async (args: Parameters<typeof account.signTypedData>[0]) =>
        account.signTypedData(args),
      ),
    }

    const signature = await signUsdcReceiveWithAuthorization(
      walletClient as never,
      account.address,
      message,
    )

    expect(signature).toMatch(/^0x[0-9a-f]+$/i)
    // Ensure the signature is a normal 65-byte sig (r||s||v)
    expect(Number(parseSignature(signature).v ?? 0n)).toBeGreaterThanOrEqual(27)

    const recovered = await recoverTypedDataAddress({
      domain: USDC_BASE_EIP712_DOMAIN,
      types: USDC_RECEIVE_WITH_AUTHORIZATION_TYPES,
      primaryType: 'ReceiveWithAuthorization',
      message,
      signature,
    })
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase())
  })
})
