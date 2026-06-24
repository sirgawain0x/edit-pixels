import { encodeFunctionData, erc20Abi, formatUnits, isAddress, parseUnits } from 'viem';
import { getPurchaseGasBufferUsdc6 } from '@/config/gas-sponsorship';

export const USDC_DECIMALS = 6;

export type UsdcSendValidation =
  | { ok: true; recipient: `0x${string}`; amountUsdc6: bigint }
  | { ok: false; error: string };

export function getUsdcGasReserveUsdc6(chainId: number): number {
  return getPurchaseGasBufferUsdc6(chainId);
}

/** Spendable USDC after reserving ERC-20 gas, or null when balance is too low. */
export function getMaxSendableUsdc(
  balance: string | null,
  chainId: number
): string | null {
  if (balance === null) return null;
  try {
    const balanceUsdc6 = parseUnits(balance, USDC_DECIMALS);
    const reserveUsdc6 = BigInt(getPurchaseGasBufferUsdc6(chainId));
    if (balanceUsdc6 <= reserveUsdc6) return null;
    return formatUnits(balanceUsdc6 - reserveUsdc6, USDC_DECIMALS);
  } catch {
    return null;
  }
}

export function validateUsdcSend(params: {
  recipient: string;
  amount: string;
  balance: string | null;
  senderAddress?: string;
  gasReserveUsdc6?: number;
}): UsdcSendValidation {
  const trimmedRecipient = params.recipient.trim();
  if (!trimmedRecipient) {
    return { ok: false, error: 'Enter a recipient address' };
  }
  if (!isAddress(trimmedRecipient)) {
    return { ok: false, error: 'Invalid wallet address' };
  }
  const recipient = trimmedRecipient as `0x${string}`;
  if (
    params.senderAddress &&
    recipient.toLowerCase() === params.senderAddress.toLowerCase()
  ) {
    return { ok: false, error: 'Cannot send USDC to your own address' };
  }

  const trimmedAmount = params.amount.trim();
  if (!trimmedAmount) {
    return { ok: false, error: 'Enter an amount' };
  }
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(trimmedAmount)) {
    return { ok: false, error: 'Enter a valid amount' };
  }
  const decimalPart = trimmedAmount.split('.')[1];
  if (decimalPart && decimalPart.length > USDC_DECIMALS) {
    return { ok: false, error: `USDC supports up to ${USDC_DECIMALS} decimal places` };
  }

  let amountUsdc6: bigint;
  try {
    amountUsdc6 = parseUnits(trimmedAmount, USDC_DECIMALS);
  } catch {
    return { ok: false, error: 'Enter a valid amount' };
  }
  if (amountUsdc6 <= 0n) {
    return { ok: false, error: 'Amount must be greater than zero' };
  }

  if (params.balance !== null) {
    let balanceUsdc6: bigint;
    try {
      balanceUsdc6 = parseUnits(params.balance, USDC_DECIMALS);
    } catch {
      return { ok: false, error: 'Could not read wallet balance' };
    }
    if (amountUsdc6 > balanceUsdc6) {
      return { ok: false, error: 'Insufficient USDC balance' };
    }
    const gasReserveUsdc6 = BigInt(params.gasReserveUsdc6 ?? 0);
    if (gasReserveUsdc6 > 0n && amountUsdc6 + gasReserveUsdc6 > balanceUsdc6) {
      return {
        ok: false,
        error: 'Insufficient USDC after reserving gas fees',
      };
    }
  }

  return { ok: true, recipient, amountUsdc6 };
}

export function buildUsdcTransferCalldata(
  recipient: `0x${string}`,
  amountUsdc6: bigint
): `0x${string}` {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [recipient, amountUsdc6],
  });
}
