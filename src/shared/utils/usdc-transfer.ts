import { encodeFunctionData, erc20Abi, isAddress, parseUnits } from 'viem';

export const USDC_DECIMALS = 6;

export type UsdcSendValidation =
  | { ok: true; recipient: `0x${string}`; amountUsdc6: bigint }
  | { ok: false; error: string };

export function validateUsdcSend(params: {
  recipient: string;
  amount: string;
  balance: string | null;
  senderAddress?: string;
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
  if (!/^\d+(\.\d+)?$/.test(trimmedAmount)) {
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
