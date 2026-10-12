/// <reference types="node" />
/**
 * Resolve the Pixels Alchemy smart account for a Privy-linked signer (counterfactual / deployed).
 */
import { alchemyWalletTransport, createSmartWalletClient } from '@alchemy/wallet-apis'
import { base } from 'viem/chains'
import type { Address, LocalAccount } from 'viem'
import {
  PIXELS_SMART_ACCOUNT_ID,
  PIXELS_SMART_ACCOUNT_TYPE,
} from '../src/config/pixels-smart-account.ts'

const smartAccountBySigner = new Map<string, Address>()

function stubLocalSigner(address: Address): LocalAccount {
  return {
    address,
    type: 'local',
    publicKey: `0x${'00'.repeat(32)}`,
    source: 'custom',
    async sign({ hash }) {
      return hash
    },
    async signMessage() {
      return '0x'
    },
    async signTransaction() {
      return '0x'
    },
    async signTypedData() {
      return '0x'
    },
  }
}

function alchemyApiKey(): string | null {
  return process.env.ALCHEMY_API_KEY?.trim() || process.env.VITE_ALCHEMY_API_KEY?.trim() || null
}

/** Same `wallet_requestAccount` params as `src/context/wallet-context.tsx`. */
export async function resolvePixelsSmartAccountForSigner(
  signerAddress: Address,
): Promise<Address | null> {
  const key = signerAddress.toLowerCase()
  const cached = smartAccountBySigner.get(key)
  if (cached) return cached

  const apiKey = alchemyApiKey()
  if (!apiKey) return null

  const client = createSmartWalletClient({
    transport: alchemyWalletTransport({ apiKey }),
    chain: base,
    signer: stubLocalSigner(signerAddress),
  })

  const account = await client.requestAccount({
    signerAddress,
    id: PIXELS_SMART_ACCOUNT_ID,
    creationHint: { accountType: PIXELS_SMART_ACCOUNT_TYPE },
  })

  smartAccountBySigner.set(key, account.address)
  return account.address
}
