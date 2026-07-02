import { createSmartWalletClient } from '@alchemy/wallet-apis';
import { alchemyWalletTransport } from '@alchemy/wallet-apis';
import type { Chain, Hex, WalletClient, LocalAccount } from 'viem';
import { arbitrum, arbitrumSepolia, base, baseSepolia } from 'viem/chains';
import { QueryClient } from '@tanstack/react-query';
import { robinhoodTestnet } from '@/config/chains';

const apiKey = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined;
const isProd = import.meta.env.PROD;

const useMainnetChains =
  isProd || import.meta.env.VITE_USE_MAINNET === 'true';

export const DEVELOPMENT_CHAINS = [
  robinhoodTestnet,
  baseSepolia,
  arbitrumSepolia,
] as const;

export const PRODUCTION_CHAINS = [arbitrum, base] as const;

export const SWITCHABLE_CHAINS = useMainnetChains
  ? ([...PRODUCTION_CHAINS] as const)
  : ([...DEVELOPMENT_CHAINS] as const);

export const DEFAULT_CHAIN = useMainnetChains ? arbitrum : arbitrumSepolia;

export const DEFAULT_CHAIN_ID = DEFAULT_CHAIN.id;

export const queryClient = new QueryClient();

const policyId = import.meta.env.VITE_ALCHEMY_POLICY_ID as string | undefined;

function getAlchemyTransport() {
  if (!apiKey) {
    throw new Error('VITE_ALCHEMY_API_KEY is required for Alchemy wallet transport');
  }
  return alchemyWalletTransport({ apiKey });
}

/** Create a v5 EIP-7702 smart-wallet client from a viem WalletClient or LocalAccount signer. */
export function createSmartWallet(
  signer: WalletClient | LocalAccount,
  chain: Chain = DEFAULT_CHAIN
) {
  return createSmartWalletClient({
    transport: getAlchemyTransport(),
    chain,
    signer: signer as never,
    ...(policyId ? { paymaster: { policyId } } : {}),
  });
}

export function normalize7702Auth(auth: string): Hex {
  return auth as Hex;
}
