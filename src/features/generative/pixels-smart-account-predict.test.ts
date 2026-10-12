import { describe, expect, it } from 'vitest'
import { getAddress } from 'viem'
import { predictPixelsSmartAccountForSigner } from '../../../api/_pixels-smart-account.js'
import { PIXELS_SMART_ACCOUNT_SALT } from '@/config/pixels-smart-account'

describe('predictPixelsSmartAccountForSigner', () => {
  it('uses salt 0 and matches the documented signer → SMA pair', () => {
    expect(PIXELS_SMART_ACCOUNT_SALT).toBe(0n)
    const signer = getAddress('0x1111111111111111111111111111111111111111')
    const predicted = predictPixelsSmartAccountForSigner(signer)
    expect(predicted).toBe(getAddress('0x79D691E019f7E6bf5382255129e946971649aB29'))
  })
})
