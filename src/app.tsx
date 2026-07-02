import { useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { PrivyProvider } from '@privy-io/react-auth';
import { TooltipProvider } from '@/components/ui/tooltip';
import { GlobalTooltip } from '@/components/ui/global-tooltip';
import { Toaster } from '@/components/ui/sonner';
import { ErrorBoundary } from '@/components/error-boundary';
import { SubscriptionRenewalWatcher } from '@/components/subscription-renewal-watcher';
import { WalletProvider } from '@/context/wallet-context';
import { queryClient, DEFAULT_CHAIN, SWITCHABLE_CHAINS } from '@/config/alchemy';
import { routeTree } from './routeTree.gen';

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

function WalletApp() {
  return (
    <WalletProvider>
      <TooltipProvider delayDuration={300}>
        <RouterProvider router={router} />
        <GlobalTooltip />
        <SubscriptionRenewalWatcher />
        <Toaster />
      </TooltipProvider>
    </WalletProvider>
  );
}

export function App() {
  // Prevent default browser zoom application-wide
  useEffect(() => {
    const wheelListenerOptions: AddEventListenerOptions = { passive: false, capture: true };
    const keyListenerOptions: AddEventListenerOptions = { capture: true };

    const preventBrowserZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };

    const preventKeyboardZoom = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_' || e.key === '0') {
          e.preventDefault();
        }
      }
    };

    document.addEventListener('wheel', preventBrowserZoom, wheelListenerOptions);
    document.addEventListener('keydown', preventKeyboardZoom, keyListenerOptions);

    return () => {
      document.removeEventListener('wheel', preventBrowserZoom, wheelListenerOptions);
      document.removeEventListener('keydown', preventKeyboardZoom, keyListenerOptions);
    };
  }, []);

  const privyAppId = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;

  const content = <WalletApp />;

  if (!privyAppId) {
    // App still renders without Privy so local/offline flows can run.
    return (
      <ErrorBoundary level="app">
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delayDuration={300}>
            <RouterProvider router={router} />
            <GlobalTooltip />
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary level="app">
      <QueryClientProvider client={queryClient}>
        <PrivyProvider
          appId={privyAppId}
          config={{
            defaultChain: DEFAULT_CHAIN,
            supportedChains: [...SWITCHABLE_CHAINS],
            loginMethods: ['wallet', 'email', 'google', 'farcaster'],
            appearance: {
              theme: 'dark',
              accentColor: '#7C3AED',
              landingHeader: 'Connect to Creative Pixels',
              loginMessage: 'Sign in to mint, edit, and publish on-chain.',
            },
            embeddedWallets: {
              ethereum: {
                createOnLogin: 'users-without-wallets',
              },
            },
          }}
        >
          {content}
        </PrivyProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
