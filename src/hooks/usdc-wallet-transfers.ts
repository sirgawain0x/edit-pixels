import type { Chain, WalletClient } from 'viem'
import { erc20Abi, parseUnits, type Address } from 'viem'
import { USDC_BASE_ADDRESS, USDC_DECIMALS } from '@/config/metoken'
import { getBasePublicClient } from '@/config/base-client'

export interface MoveUsdcToSmartWalletParams {
  walletClient: WalletClient
  chain: Chain
  smartAccount: Address
  signerAddress: Address
  signerUsdcBalance: string
  smartUsdcBalance: string | null
  requiredUsdc6: number
}

export async function moveUsdcToSmartWallet({
  walletClient,
  chain,
  smartAccount,
  signerAddress,
  signerUsdcBalance,
  smartUsdcBalance,
  requiredUsdc6,
}: MoveUsdcToSmartWalletParams): Promise<`0x${string}`> {
  const eoaRaw = parseUnits(signerUsdcBalance, USDC_DECIMALS)
  const smartRaw = parseUnits(smartUsdcBalance ?? '0', USDC_DECIMALS)
  const shortfall = BigInt(requiredUsdc6) > smartRaw ? BigInt(requiredUsdc6) - smartRaw : 0n
  const amount = shortfall > 0n && shortfall < eoaRaw ? shortfall : eoaRaw
  if (amount <= 0n) {
    throw new Error('No USDC available to move')
  }

  const hash = await walletClient.writeContract({
    address: USDC_BASE_ADDRESS,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [smartAccount, amount],
    chain,
    account: signerAddress,
  })
  await getBasePublicClient().waitForTransactionReceipt({ hash })
  return hash
}

export interface TransferUsdcFromSignerParams {
  walletClient: WalletClient
  chain: Chain
  signerAddress: Address
  recipient: Address
  amountWei: bigint
}

export async function transferUsdcFromSigner({
  walletClient,
  chain,
  signerAddress,
  recipient,
  amountWei,
}: TransferUsdcFromSignerParams): Promise<`0x${string}`> {
  if (amountWei <= 0n) {
    throw new Error('Transfer amount must be positive')
  }

  const hash = await walletClient.writeContract({
    address: USDC_BASE_ADDRESS,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [recipient, amountWei],
    chain,
    account: signerAddress,
  })
  await getBasePublicClient().waitForTransactionReceipt({ hash })
  return hash
}
