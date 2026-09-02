import { encodeFunctionData, erc20Abi, type Address, type Hex } from 'viem'
import type { SmartWalletOp } from '@/hooks/use-smart-wallet-ops'

export function buildErc20TransferOp(
  tokenAddress: Address,
  recipient: Address,
  amountWei: bigint,
): SmartWalletOp {
  if (amountWei <= 0n) {
    throw new Error('Transfer amount must be positive')
  }

  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [recipient, amountWei],
  }) as Hex

  return {
    target: tokenAddress,
    data,
    value: 0n,
  }
}
