import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  parseAbi,
} from 'viem';
import { base } from 'viem/chains';
import {
  CFA_FORWARDER_ADDRESS,
  CRTVAI_DIAMOND_ADDRESS,
  METOKEN_DIAMOND_ABI,
  getCrtvaiXAddress,
  SUPER_TOKEN_ABI,
} from '@/config/metoken';

export const cfaForwarderAbi = parseAbi([
  'function createFlow(address token, address sender, address receiver, int96 flowrate, bytes userData) returns (bool)',
  'function updateFlow(address token, address sender, address receiver, int96 flowrate, bytes userData) returns (bool)',
  'function deleteFlow(address token, address sender, address receiver, bytes userData) returns (bool)',
  'function getFlow(address token, address sender, address receiver) view returns (uint256 timestamp, int96 flowRate, uint256 deposit, uint256 owedDeposit)',
]);

export interface FlowUserOperation {
  target: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
}

function getBaseRpcUrl(): string {
  const apiKey = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined;
  if (apiKey) {
    return `https://base-mainnet.g.alchemy.com/v2/${apiKey}`;
  }
  return base.rpcUrls.default.http[0]!;
}

export function createBasePublicClient() {
  return createPublicClient({
    chain: base,
    transport: http(getBaseRpcUrl()),
  });
}

/** Read raw CRTVAI meToken balance on Base (the unwrapped ERC-20, not the Super Token). */
export async function readCrtvaiBalanceBase(
  address: `0x${string}`
): Promise<bigint> {
  const client = createBasePublicClient();
  return client.readContract({
    address: CRTVAI_DIAMOND_ADDRESS,
    abi: METOKEN_DIAMOND_ABI,
    functionName: 'balanceOf',
    args: [address],
  });
}

/** Read CRTVAIx (Wrapped Super Token) balance on Base. */
export async function readCrtvaiXBalance(
  address: `0x${string}`
): Promise<bigint> {
  const superToken = getCrtvaiXAddress();
  if (!superToken) return 0n;
  const client = createBasePublicClient();
  return client.readContract({
    address: superToken,
    abi: SUPER_TOKEN_ABI,
    functionName: 'balanceOf',
    args: [address],
  });
}

export async function readExistingFlowRate(
  sender: `0x${string}`,
  receiver: `0x${string}`
): Promise<bigint> {
  const superToken = getCrtvaiXAddress();
  if (!superToken) return 0n;
  const client = createBasePublicClient();
  try {
    const result = await client.readContract({
      address: CFA_FORWARDER_ADDRESS,
      abi: cfaForwarderAbi,
      functionName: 'getFlow',
      args: [superToken, sender, receiver],
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
  /** CRTVAI meToken wei (18 decimals) to wrap (upgrade) before starting the stream. */
  wrapMetokenWei: bigint;
  existingFlowRate: bigint;
}

/**
 * UserOperations to upgrade CRTVAI → CRTVAIx and create or update a Superfluid flow.
 */
export function buildStartFlowUserOperations(
  params: BuildStartFlowOpsParams
): FlowUserOperation[] {
  const superToken = getCrtvaiXAddress();
  if (!superToken) {
    throw new Error('CRTVAIx (Wrapped Super Token) not configured on Base');
  }

  const ops: FlowUserOperation[] = [];

  if (params.wrapMetokenWei > 0n) {
    // Approve the Super Token contract to pull underlying CRTVAI from the diamond
    const approveData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [superToken, params.wrapMetokenWei],
    });
    // Upgrade (wrap) CRTVAI → CRTVAIx — called on the Super Token contract
    const upgradeData = encodeFunctionData({
      abi: SUPER_TOKEN_ABI,
      functionName: 'upgrade',
      args: [params.wrapMetokenWei],
    });
    ops.push(
      { target: CRTVAI_DIAMOND_ADDRESS, data: approveData, value: 0n },
      { target: superToken, data: upgradeData, value: 0n }
    );
  }

  const flowFn = params.existingFlowRate > 0n ? 'updateFlow' : 'createFlow';
  const flowData = encodeFunctionData({
    abi: cfaForwarderAbi,
    functionName: flowFn,
    args: [
      superToken,
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
  const superToken = getCrtvaiXAddress();
  if (!superToken) {
    throw new Error('CRTVAIx (Wrapped Super Token) not configured on Base');
  }
  const data = encodeFunctionData({
    abi: cfaForwarderAbi,
    functionName: 'deleteFlow',
    args: [superToken, sender, receiver, '0x'],
  });
  return {
    target: CFA_FORWARDER_ADDRESS,
    data,
    value: 0n,
  };
}