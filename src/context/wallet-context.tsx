import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  usePrivy,
  useWallets,
  getEmbeddedConnectedWallet,
  type ConnectedWallet,
  type User,
} from '@privy-io/react-auth';
import {
  createSmartWalletClient,
  alchemyWalletTransport,
  type SmartWalletClient as AlchemySmartWalletClient,
} from '@alchemy/wallet-apis';
import { swapActions, type SwapActions } from '@alchemy/wallet-apis/experimental';
import { createWalletClient, custom, type Chain, type WalletClient, type Address } from 'viem';
import { DEFAULT_CHAIN, SWITCHABLE_CHAINS } from '@/config/alchemy';

const apiKey = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined;
const policyId = import.meta.env.VITE_ALCHEMY_POLICY_ID as string | undefined;

type SmartWalletClient = AlchemySmartWalletClient & SwapActions;

interface WalletContextValue {
  ready: boolean;
  authenticated: boolean;
  connect: () => void;
  disconnect: () => Promise<void>;
  wallet: ConnectedWallet | null;
  account: Address | undefined;
  user: User | null;
  walletClient: WalletClient | null;
  smartWalletClient: SmartWalletClient | null;
  chain: Chain;
  switchChain: (chainId: number) => Promise<void>;
  isConnecting: boolean;
  error: Error | null;
  getAccessToken: () => Promise<string | null>;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export function useWalletContext() {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error('useWalletContext must be used within WalletProvider');
  }
  return ctx;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user, login, logout, connectWallet, getAccessToken } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [chain, setChain] = useState<Chain>(DEFAULT_CHAIN);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const activeWallet = useMemo<ConnectedWallet | null>(() => {
    if (!walletsReady || !wallets.length) return null;
    const embedded = getEmbeddedConnectedWallet(wallets);
    return embedded ?? wallets[0] ?? null;
  }, [wallets, walletsReady]);

  useEffect(() => {
    let cancelled = false;
    async function syncWalletClient() {
      if (!activeWallet || !authenticated) {
        setWalletClient(null);
        return;
      }
      setIsConnecting(true);
      setError(null);
      try {
        const provider = await activeWallet.getEthereumProvider();
        const client = createWalletClient({
          account: activeWallet.address as `0x${string}`,
          chain,
          transport: custom(provider),
        });
        if (cancelled) return;
        setWalletClient(client);
        const walletChainId = parseInt(activeWallet.chainId, 10);
        if (walletChainId && walletChainId !== chain.id) {
          const known = SWITCHABLE_CHAINS.find((c) => c.id === walletChainId);
          if (known) setChain(known);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (!cancelled) setIsConnecting(false);
      }
    }
    void syncWalletClient();
    return () => {
      cancelled = true;
    };
  }, [activeWallet, activeWallet?.chainId, authenticated, chain]);

  const smartWalletClient = useMemo<SmartWalletClient | null>(() => {
    if (!walletClient || !apiKey) return null;
    return createSmartWalletClient({
      transport: alchemyWalletTransport({ apiKey }),
      chain,
      signer: walletClient as never,
      ...(policyId ? { paymaster: { policyId } } : {}),
    }).extend(swapActions) as SmartWalletClient;
  }, [walletClient, chain]);

  const connect = useCallback(() => {
    setError(null);
    if (authenticated) {
      connectWallet();
    } else {
      login();
    }
  }, [authenticated, connectWallet, login]);

  const disconnect = useCallback(async () => {
    setError(null);
    await logout();
  }, [logout]);

  const switchChain = useCallback(
    async (chainId: number) => {
      if (!activeWallet) return;
      await activeWallet.switchChain(chainId);
    },
    [activeWallet]
  );

  const value: WalletContextValue = useMemo(
    () => ({
      ready: ready && walletsReady,
      authenticated,
      connect,
      disconnect,
      wallet: activeWallet,
      account: activeWallet ? (activeWallet.address as Address) : undefined,
      user,
      walletClient,
      smartWalletClient,
      chain,
      switchChain,
      isConnecting,
      error,
      getAccessToken,
    }),
    [
      ready,
      walletsReady,
      authenticated,
      connect,
      disconnect,
      activeWallet,
      user,
      walletClient,
      smartWalletClient,
      chain,
      switchChain,
      isConnecting,
      error,
      getAccessToken,
    ]
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}
