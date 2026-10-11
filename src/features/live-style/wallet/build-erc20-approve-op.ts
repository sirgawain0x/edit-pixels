import { encodeFunctionData, erc20Abi, type Address, type Hex } from 'viem'
import type { SmartWalletOp } from '@/hooks/use-smart-wallet-ops'

export function buildErc20ApproveOp(
  tokenAddress: Address,
  spender: Address,
  amountWei: bigint,
): SmartWalletOp {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, amountWei],
  }) as Hex

  return {
    target: tokenAddress,
    data,
    value: 0n,
  }
}
