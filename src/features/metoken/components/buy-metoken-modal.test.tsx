import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { BuyMetokenModal } from './buy-metoken-modal';
import * as walletContext from '@/context/wallet-context';
import * as usdcBalanceHook from '@/hooks/use-usdc-balance';
import * as crtvaiBalanceHook from '@/hooks/use-crtvai-balance';
import * as smartWalletOpsHook from '@/hooks/use-smart-wallet-ops';
import * as metokenConfig from '@/config/metoken';
import * as buyMetokenApi from '../api/buy-metoken';
import { base } from 'viem/chains';
import type { Chain } from 'viem';

const invalidateQueries = vi.fn();

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: vi.fn(() => ({ invalidateQueries })),
  };
});

vi.mock('@/components/ui/dialog', () => {
  return {
    Dialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) => (open ? children : null),
    DialogContent: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'dialog-content' }, children),
    DialogHeader: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    DialogTitle: ({ children }: { children: React.ReactNode }) => React.createElement('h2', null, children),
    DialogDescription: ({ children }: { children: React.ReactNode }) => React.createElement('p', null, children),
  };
});

vi.mock('@/components/ui/button', () => {
  return {
    Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) =>
      React.createElement('button', { ...props, type: 'button' }, props.children),
  };
});

vi.mock('@/components/ui/input', () => {
  return {
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => React.createElement('input', { ...props }),
  };
});

vi.mock('@/components/headless-cdp-onramp', () => {
  return {
    HeadlessCdpOnramp: ({ onSuccess }: { onSuccess?: () => void }) =>
      React.createElement('button', { 'data-testid': 'onramp-success', onClick: onSuccess, type: 'button' }, 'Buy USDC'),
  };
});

const useWalletContextSpy = vi.spyOn(walletContext, 'useWalletContext');
const useUsdcBalanceSpy = vi.spyOn(usdcBalanceHook, 'useUsdcBalance');
const useCrtvaiBalanceSpy = vi.spyOn(crtvaiBalanceHook, 'useCrtvaiBalance');
const useSmartWalletOpsSpy = vi.spyOn(smartWalletOpsHook, 'useSmartWalletOps');

function renderModal(props: { open: boolean; usdcBalance?: string | null; onBase?: boolean }) {
  useWalletContextSpy.mockReturnValue({
    account: '0x1111111111111111111111111111111111111111' as `0x${string}`,
    chain: props.onBase !== false ? base : ({ id: 1 } as Chain),
    user: { email: 'test@example.com' },
  } as ReturnType<typeof walletContext.useWalletContext>);

  useUsdcBalanceSpy.mockReturnValue({
    balance: props.usdcBalance ?? null,
    formatted: props.usdcBalance ?? '—',
    isLoading: false,
    isError: false,
  });

  useCrtvaiBalanceSpy.mockReturnValue({
    balance: 0n,
    formatted: '0',
    symbol: 'CRTVAI',
    isLoading: false,
    isError: false,
  });

  useSmartWalletOpsSpy.mockReturnValue({
    sendOps: vi.fn(),
    ready: true,
  });

  vi.spyOn(metokenConfig, 'readCrtvaiCurrentPrice').mockResolvedValue(1000000n);
  vi.spyOn(metokenConfig, 'readCrtvaiMintQuote').mockResolvedValue(1000000000000000000n);
  vi.spyOn(buyMetokenApi, 'buildBuyMetokenOps').mockReturnValue({ ops: [] });

  return render(
    React.createElement(BuyMetokenModal, {
      open: props.open,
      onOpenChange: vi.fn(),
    })
  );
}

describe('BuyMetokenModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows USDC onramp when balance is zero', async () => {
    await act(async () => {
      renderModal({ open: true, usdcBalance: '0' });
    });
    expect(screen.getByText(/You need USDC in your wallet before you can mint CRTVAI/i)).toBeInTheDocument();
    expect(screen.getByTestId('onramp-success')).toBeInTheDocument();
  });

  it('shows mint input when balance is positive', async () => {
    await act(async () => {
      renderModal({ open: true, usdcBalance: '50' });
    });
    expect(screen.getByPlaceholderText(/0\.00/i)).toBeInTheDocument();
    expect(screen.queryByText(/You need USDC in your wallet before you can mint CRTVAI/i)).not.toBeInTheDocument();
  });

  it('disables mint input when balance is zero', async () => {
    await act(async () => {
      renderModal({ open: true, usdcBalance: '0' });
    });
    const input = screen.getByPlaceholderText(/0\.00/i) as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('shows network switch message when not on Base', async () => {
    await act(async () => {
      renderModal({ open: true, usdcBalance: '50', onBase: false });
    });
    expect(screen.getByText(/Switch to Base network to buy CRTVAI/i)).toBeInTheDocument();
  });

  it('invalidates USDC balance query on onramp success', async () => {
    await act(async () => {
      renderModal({ open: true, usdcBalance: '0' });
    });
    const onrampButton = screen.getByTestId('onramp-success');
    await act(async () => {
      onrampButton.click();
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['usdc-balance', base.id, '0x1111111111111111111111111111111111111111'],
    });
  });
});
