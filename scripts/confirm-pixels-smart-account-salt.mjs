#!/usr/bin/env node
// fallow-ignore-file unused-file
/**
 * Offline check: decode CREATE2 salt from Alchemy wallet_requestAccount factoryData.
 * Usage: ALCHEMY_API_KEY=... node scripts/confirm-pixels-smart-account-salt.mjs [signerAddress]
 */
import { alchemyWalletTransport, createSmartWalletClient } from '@alchemy/wallet-apis'
import { getModularAccountV2AddressFromFactoryData, DefaultAddress } from '@alchemy/smart-accounts'
import { base } from 'viem/chains'
import { createPublicClient, decodeFunctionData, http, parseAbi } from 'viem'

const PIXELS_SMART_ACCOUNT_ID = 'e1459502-d074-4044-81e1-e7b2744a60b0'

const accountFactoryAbi = parseAbi([
  'function createSemiModularAccount(address owner, uint256 salt) returns (address)',
])

const apiKey = process.env.ALCHEMY_API_KEY?.trim() || process.env.VITE_ALCHEMY_API_KEY?.trim()
if (!apiKey) {
  console.error('Set ALCHEMY_API_KEY or VITE_ALCHEMY_API_KEY')
  process.exit(1)
}

const signerAddress = process.argv[2]?.trim() || '0x1111111111111111111111111111111111111111'

const stub = {
  address: signerAddress,
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

const client = createSmartWalletClient({
  transport: alchemyWalletTransport({ apiKey }),
  chain: base,
  signer: stub,
})

const rpc = createPublicClient({
  chain: base,
  transport: http(`https://base-mainnet.g.alchemy.com/v2/${apiKey}`),
})

const resp = await client.request({
  method: 'wallet_requestAccount',
  params: [
    {
      signerAddress,
      id: PIXELS_SMART_ACCOUNT_ID,
      creationHint: { accountType: 'sma-b' },
      includeCounterfactualInfo: true,
    },
  ],
})

const cf = resp.counterfactualInfo
if (!cf?.factoryData) {
  console.error('No counterfactualInfo.factoryData in response')
  process.exit(1)
}

const decoded = decodeFunctionData({ abi: accountFactoryAbi, data: cf.factoryData })
const salt = decoded.args[1]
const predicted = await getModularAccountV2AddressFromFactoryData({
  client: rpc,
  factoryAddress: cf.factory,
  factoryData: cf.factoryData,
  implementationAddress: DefaultAddress.SMAV2_BYTECODE,
})

console.log(
  JSON.stringify(
    {
      signerAddress,
      apiAccountAddress: resp.accountAddress,
      predictedFromFactoryData: predicted,
      decodedFunction: decoded.functionName,
      salt: salt.toString(),
      factory: cf.factory,
    },
    null,
    2,
  ),
)
