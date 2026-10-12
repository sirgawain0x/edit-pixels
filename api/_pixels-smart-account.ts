/// <reference types="node" />
/**
 * Predict the Pixels Alchemy SMA address for a Privy-linked signer (no network I/O).
 */
import { DefaultAddress, predictModularAccountV2Address } from '@alchemy/smart-accounts'
import { getAddress, type Address } from 'viem'
import { PIXELS_SMART_ACCOUNT_SALT } from '../src/config/pixels-smart-account.ts'

export function predictPixelsSmartAccountForSigner(signerAddress: string): Address {
  const owner = getAddress(signerAddress)
  return predictModularAccountV2Address({
    factoryAddress: DefaultAddress.MAV2_FACTORY,
    implementationAddress: DefaultAddress.SMAV2_BYTECODE,
    type: 'SMA',
    ownerAddress: owner,
    salt: PIXELS_SMART_ACCOUNT_SALT,
  })
}
