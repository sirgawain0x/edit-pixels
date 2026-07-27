import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  usePrivy,
  useWallets,
  getEmbeddedConnectedWallet,
  type ConnectedWallet,
  type User,
  PrivyProvider,
} from '@privy-io/react-auth'
import {
  createSmartWalletClient,
  alchemyWalletTransport,
  type SmartWalletClient as AlchemySmartWalletClient,
} from '@alchemy/wallet-apis'
import { swapActions, type SwapActions } from '@alchemy/wallet-apis/experimental'
import { createWalletClient, custom, type Chain, type WalletClient, type Address } from 'viem'
import { ALCHEMY_API_KEY, ALCHEMY_POLICY_ID } from '@/config/alchemy'
import { DEFAULT_CHAIN, getChainById } from '@/config/chains'

type SmartWalletClient = AlchemySmartWalletClient & SwapActions

export interface WalletContextValue {
  ready: boolean
  authenticated: boolean
  /** True when VITE_PRIVY_APP_ID is set and PrivyProvider is active. */
  configured: boolean
  connect: () => void
  disconnect: () => Promise<void>
  wallet: ConnectedWallet | null
  account: Address | undefined
  user: User | null
  walletClient: WalletClient | null
  smartWalletClient: SmartWalletClient | null
  chain: Chain
  switchChain: (chainId: number) => Promise<void>
  isConnecting: boolean
  error: Error | null
  getAccessToken: () => Promise<string | null>
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined)

export function useWalletContext(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) {
    throw new Error('useWalletContext must be used within WalletProvider')
  }
  return ctx
}

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID
const PRIVY_CLIENT_ID = import.meta.env.VITE_PRIVY_CLIENT_ID
export const isPrivyConfigured = Boolean(PRIVY_APP_ID)

function WalletContextInner({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, login, logout, connectWallet, getAccessToken } = usePrivy()
  const { wallets, ready: walletsReady } = useWallets()
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null)
  const [chain, setChain] = useState<Chain>(DEFAULT_CHAIN)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const activeWallet = useMemo<ConnectedWallet | null>(() => {
    if (!walletsReady || !wallets.length) return null
    const embedded = getEmbeddedConnectedWallet(wallets)
    return embedded ?? wallets[0] ?? null
  }, [wallets, walletsReady])

  useEffect(() => {
    let cancelled = false
    async function syncWalletClient() {
      if (!activeWallet || !authenticated) {
        setWalletClient(null)
        return
      }
      setIsConnecting(true)
      setError(null)
      try {
        const provider = await activeWallet.getEthereumProvider()
        const client = createWalletClient({
          account: activeWallet.address as Address,
          chain,
          transport: custom(provider),
        })
        if (cancelled) return
        setWalletClient(client)
        const walletChainId = parseInt(activeWallet.chainId, 10)
        if (walletChainId && walletChainId !== chain.id) {
          const known = getChainById(walletChainId)
          if (known) setChain(known)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)))
      } finally {
        if (!cancelled) setIsConnecting(false)
      }
    }
    void syncWalletClient()
    return () => {
      cancelled = true
    }
  }, [activeWallet, activeWallet?.chainId, authenticated, chain])

  const smartWalletClient = useMemo<SmartWalletClient | null>(() => {
    if (!walletClient || !ALCHEMY_API_KEY) return null
    return createSmartWalletClient({
      transport: alchemyWalletTransport({ apiKey: ALCHEMY_API_KEY }),
      chain,
      signer: walletClient as never,
      ...(ALCHEMY_POLICY_ID ? { paymaster: { policyId: ALCHEMY_POLICY_ID } } : {}),
    }).extend(swapActions) as SmartWalletClient
  }, [walletClient, chain])

  const connect = useCallback(() => {
    setError(null)
    if (authenticated) {
      connectWallet()
    } else {
      login()
    }
  }, [authenticated, connectWallet, login])

  const disconnect = useCallback(async () => {
    setError(null)
    await logout()
  }, [logout])

  const switchChain = useCallback(
    async (chainId: number) => {
      if (!activeWallet) return
      await activeWallet.switchChain(chainId)
    },
    [activeWallet],
  )

  const value = useMemo(
    () => ({
      ready: ready && walletsReady,
      authenticated,
      configured: true,
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
    ],
  )

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function WalletProvider({ children }: { children: ReactNode }) {
  if (!isPrivyConfigured) {
    // Render a stub provider so the app can still run without Privy configured
    // (local/offline dev flows).
    const stubValue: WalletContextValue = {
      ready: true,
      authenticated: false,
      configured: false,
      connect: () => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('pixels:ensure-toaster'))
        }
        // Lazy import avoids pulling sonner into the critical path when unused.
        void import('sonner').then(({ toast }) => {
          toast.error('Wallet auth is not configured', {
            description: 'Set VITE_PRIVY_APP_ID (and VITE_PRIVY_CLIENT_ID) to enable connect.',
          })
        })
      },
      disconnect: async () => {},
      wallet: null,
      account: undefined,
      user: null,
      walletClient: null,
      smartWalletClient: null,
      chain: DEFAULT_CHAIN,
      switchChain: async () => {},
      isConnecting: false,
      error: null,
      getAccessToken: async () => null,
    }
    return <WalletContext.Provider value={stubValue}>{children}</WalletContext.Provider>
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID as string}
      clientId={PRIVY_CLIENT_ID}
      config={{
        loginMethods: ['wallet', 'email', 'google', 'farcaster'],
        appearance: {
          accentColor: '#676FFF',
          theme: 'dark',
          showWalletLoginFirst: true,
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets',
          },
        },
      }}
    >
      <WalletContextInner>{children}</WalletContextInner>
    </PrivyProvider>
  )
}
