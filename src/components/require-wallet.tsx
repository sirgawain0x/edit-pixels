'use client';

import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useWalletContext } from '@/context/wallet-context';

interface RequireWalletProps {
  children: React.ReactNode;
}

/**
 * Requires a connected wallet before rendering children.
 * Redirects to / when not connected (after the wallet context has finished initializing).
 */
export function RequireWallet({ children }: RequireWalletProps) {
  const navigate = useNavigate();
  const { ready, authenticated, connect } = useWalletContext();

  const isInitializing = !ready;
  const isConnected = authenticated;

  useEffect(() => {
    if (!isInitializing && !isConnected) {
      connect();
      navigate({ to: '/' });
    }
  }, [isInitializing, isConnected, connect, navigate]);

  if (isInitializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!isConnected) {
    return null;
  }

  return <>{children}</>;
}
