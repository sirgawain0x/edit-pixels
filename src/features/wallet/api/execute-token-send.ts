import type { Chain, WalletClient } from 'viem'
import type { Address, Hex } from 'viem'
import { USDC_ADDRESS_BY_CHAIN_ID } from '@/config/chains'
import { CRTVAI_METOKEN_ADDRESS } from '@/config/metoken'
import { buildErc20TransferOp } from '@/features/wallet/api/build-erc20-transfer-op'
import { transferUsdcFromSigner } from '@/hooks/usdc-wallet-transfers'
import type { SmartWalletOp, SendOpsResult } from '@/hooks/use-smart-wallet-ops'
import type { SendToken } from '@/features/wallet/lib/send-token-math'

export interface ExecuteTokenSendParams {
  token: SendToken
  chain: Chain
  amountWei: bigint
  recipient: Address
  canSendFromSigner: boolean
  walletClient: WalletClient | null
  signerAddress: Address | undefined
  account: Address | undefined
  sendOps: (ops: SmartWalletOp[]) => Promise<SendOpsResult>
}

export interface ExecuteTokenSendResult {
  usedSigner: boolean
  txHash?: Hex
}

export async function executeTokenSend({
  token,
  chain,
  amountWei,
  recipient,
  canSendFromSigner,
  walletClient,
  signerAddress,
  account,
  sendOps,
}: ExecuteTokenSendParams): Promise<ExecuteTokenSendResult> {
  if (canSendFromSigner) {
    if (!walletClient || !signerAddress) {
      throw new Error('Signer wallet not ready')
    }
    const txHash = await transferUsdcFromSigner({
      walletClient,
      chain,
      signerAddress,
      recipient,
      amountWei,
    })
    return { usedSigner: true, txHash }
  }

  if (!account) {
    throw new Error('Smart account not provisioned yet')
  }

  const tokenAddress =
    token === 'usdc' ? USDC_ADDRESS_BY_CHAIN_ID[chain.id] : CRTVAI_METOKEN_ADDRESS
  if (!tokenAddress) {
    throw new Error('Token not available on this network')
  }

  const op = buildErc20TransferOp(tokenAddress, recipient, amountWei)
  const { txHash } = await sendOps([op])
  return { usedSigner: false, txHash }
}
