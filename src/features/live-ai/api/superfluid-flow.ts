import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  parseAbi,
  type PublicClient,
} from 'viem';
import { arbitrum } from 'viem/chains';
import { USDC_ADDRESS_BY_CHAIN_ID } from '@/config/chains';
import {
  CFA_FORWARDER_ADDRESS,
  SUPERFLUID_CHAIN_ID,
  USDCX_ARBITRUM_ADDRESS,
  usdc6ToSuperTokenWei,
} from '@/config/superfluid';

export const cfaForwarderAbi = parseAbi([
  'function createFlow(address token, address sender, address receiver, int96 flowrate, bytes userData) returns (bool)',
  'function updateFlow(address token, address sender, address receiver, int96 flowrate, bytes userData) returns (bool)',
  'function deleteFlow(address token, address sender, address receiver, bytes userData) returns (bool)',
  'function getFlow(address token, address sender, address receiver) view returns (uint256 timestamp, int96 flowRate, uint256 deposit, uint256 owedDeposit)',
]);

export const superTokenAbi = parseAbi([
  'function upgrade(uint256 amount)',
  'function balanceOf(address account) view returns (uint256)',
]);

export interface FlowUserOperation {
  target: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
}

function getArbitrumRpcUrl(): string {
  const apiKey =
    import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined;
  if (apiKey) {
    return `https://arb-mainnet.g.alchemy.com/v2/${apiKey}`;
  }
  return arbitrum.rpcUrls.default.http[0]!;
}

export function createArbitrumPublicClient(): PublicClient {
  return createPublicClient({
    chain: arbitrum,
    transport: http(getArbitrumRpcUrl()),
  });
}

export async function readUsdcBalanceArbitrum(
  address: `0x${string}`
): Promise<bigint> {
  const usdc = USDC_ADDRESS_BY_CHAIN_ID[SUPERFLUID_CHAIN_ID];
  if (!usdc) return 0n;
  const client = createArbitrumPublicClient();
  return client.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  });
}

export async function readUsdcxBalance(
  address: `0x${string}`
): Promise<bigint> {
  const client = createArbitrumPublicClient();
  return client.readContract({
    address: USDCX_ARBITRUM_ADDRESS,
    abi: superTokenAbi,
    functionName: 'balanceOf',
    args: [address],
  });
}

export async function readExistingFlowRate(
  sender: `0x${string}`,
  receiver: `0x${string}`
): Promise<bigint> {
  const client = createArbitrumPublicClient();
  try {
    const result = await client.readContract({
      address: CFA_FORWARDER_ADDRESS,
      abi: cfaForwarderAbi,
      functionName: 'getFlow',
      args: [USDCX_ARBITRUM_ADDRESS, sender, receiver],
    });
    const flowRate = result[1];
    return flowRate > 0n ? BigInt(flowRate) : 0n;
  } catch {
    return 0n;
  }
}

export interface BuildStartFlowOpsParams {
  sender: `0x${string}`;
  receiver: `0x${string}`;
  flowRate: bigint;
  /** USDC (6 decimals) to wrap before starting the stream. */
  wrapUsdc6: bigint;
  existingFlowRate: bigint;
}

/**
 * UserOperations to wrap USDC → USDCx and create or update a Superfluid flow.
 */
export function buildStartFlowUserOperations(
  params: BuildStartFlowOpsParams
): FlowUserOperation[] {
  const usdc = USDC_ADDRESS_BY_CHAIN_ID[SUPERFLUID_CHAIN_ID];
  if (!usdc) {
    throw new Error('USDC not configured on Arbitrum');
  }

  const ops: FlowUserOperation[] = [];

  if (params.wrapUsdc6 > 0n) {
    const approveData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [USDCX_ARBITRUM_ADDRESS, params.wrapUsdc6],
    });
    const upgradeData = encodeFunctionData({
      abi: superTokenAbi,
      functionName: 'upgrade',
      args: [usdc6ToSuperTokenWei(params.wrapUsdc6)],
    });
    ops.push(
      { target: usdc, data: approveData, value: 0n },
      { target: USDCX_ARBITRUM_ADDRESS, data: upgradeData, value: 0n }
    );
  }

  const flowFn = params.existingFlowRate > 0n ? 'updateFlow' : 'createFlow';
  const flowData = encodeFunctionData({
    abi: cfaForwarderAbi,
    functionName: flowFn,
    args: [
      USDCX_ARBITRUM_ADDRESS,
      params.sender,
      params.receiver,
      params.flowRate,
      '0x',
    ],
  });

  ops.push({
    target: CFA_FORWARDER_ADDRESS,
    data: flowData,
    value: 0n,
  });

  return ops;
}

export function buildDeleteFlowUserOperation(
  sender: `0x${string}`,
  receiver: `0x${string}`
): FlowUserOperation {
  const data = encodeFunctionData({
    abi: cfaForwarderAbi,
    functionName: 'deleteFlow',
    args: [USDCX_ARBITRUM_ADDRESS, sender, receiver, '0x'],
  });
  return {
    target: CFA_FORWARDER_ADDRESS,
    data,
    value: 0n,
  };
}
