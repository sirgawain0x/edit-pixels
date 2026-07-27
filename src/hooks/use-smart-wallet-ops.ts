import { useCallback } from 'react'
import type { Address, Hex } from 'viem'
import { useWalletContext } from '@/context/wallet-context'
import { buildGasPaymasterCapabilities } from '@/config/gas-sponsorship'
import { createLogger } from '@/shared/logging/logger'

const log = createLogger('smart-wallet-ops')

export interface SmartWalletOp {
  target: Address
  data: Hex
  value: bigint
}

export interface SendOpsResult {
  /** Mined transaction hash containing the user operation. */
  txHash: Hex
  /** All unique receipt tx hashes (batched calls may expose more than one). */
  txHashes: Hex[]
}

export function useSmartWalletOps() {
  const { smartWalletClient, chain } = useWalletContext()

  const sendOps = useCallback(
    async (ops: SmartWalletOp[]): Promise<SendOpsResult> => {
      if (!smartWalletClient) throw new Error('Wallet not ready')

      const capabilities = chain ? buildGasPaymasterCapabilities(chain.id) : null

      let prepared = await smartWalletClient.prepareCalls({
        calls: ops.map((op) => ({
          to: op.target,
          data: op.data,
          value: op.value,
        })),
        ...(capabilities ? { capabilities } : {}),
      })

      // ERC-20 gas policies in pre-op mode return a permit signature request
      // that must be signed and folded back into a second prepareCalls.
      if (prepared.type === 'paymaster-permit') {
        log.warn('Paymaster requested ERC-20 permit; signing and re-preparing')
        const signature = await smartWalletClient.signSignatureRequest(prepared.signatureRequest)
        prepared = await smartWalletClient.prepareCalls({
          calls: prepared.modifiedRequest.calls,
          capabilities: prepared.modifiedRequest.capabilities,
          paymasterPermitSignature: signature,
        })
      }

      const signed = await smartWalletClient.signPreparedCalls(prepared)
      const { id } = await smartWalletClient.sendPreparedCalls(signed)

      const status = await smartWalletClient.waitForCallsStatus({ id })
      if (status.status !== 'success') {
        throw new Error(`Transaction failed (status ${String(status.statusCode)})`)
      }
      const txHashes = [
        ...new Set(
          (status.receipts ?? []).map((r) => r.transactionHash).filter((h): h is Hex => Boolean(h)),
        ),
      ]
      const txHash = txHashes[txHashes.length - 1]
      if (!txHash) throw new Error('Transaction confirmed without a receipt')
      return { txHash, txHashes }
    },
    [smartWalletClient, chain],
  )

  return { sendOps, ready: Boolean(smartWalletClient) }
}
