import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAccount } from '@account-kit/react';
import { useUsdcBalance } from '@/hooks/use-usdc-balance';
import { BuyCreditsModal } from './buy-credits-modal';

const LIGHT_ACCOUNT_ADDRESS =
  '0x429A000000000000000000000000000000751d' as `0x${string}`;
const ARBITRUM_ONE_CHAIN_ID = 42_161;

let mockUsdcBalance: {
  balance: string | null;
  formatted: string;
  isLoading: boolean;
  isError: boolean;
};

vi.mock('@account-kit/react', () => ({
  useAccount: vi.fn(() => ({ address: LIGHT_ACCOUNT_ADDRESS })),
  useChain: vi.fn(() => ({
    chain: { id: ARBITRUM_ONE_CHAIN_ID, name: 'Arbitrum One' },
  })),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'credits.buyTitle': 'Buy credits',
        'credits.buyDescription':
          'Pay with USDC on Arbitrum for Flow image and video generation.',
      };
      return labels[key] ?? key;
    },
  }),
}));

vi.mock('@/hooks/use-usdc-balance', () => ({
  useUsdcBalance: vi.fn(() => mockUsdcBalance),
}));

vi.mock('@/features/credits/hooks/use-credits', () => ({
  CREDIT_PACKS: [
    {
      id: 0,
      name: 'Starter',
      usdc6: 5_000_000,
      credits: 50,
      description: '~10 Flow image gens',
    },
    {
      id: 1,
      name: 'Pro',
      usdc6: 15_000_000,
      credits: 175,
      description: '~35 Flow image gens',
    },
    {
      id: 2,
      name: 'Studio',
      usdc6: 40_000_000,
      credits: 500,
      description: '~100 Flow image gens',
    },
  ],
  useCredits: () => ({
    purchasePack: vi.fn(),
    syncPurchase: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-buy-usdc-onramp', () => ({
  useBuyUsdcOnramp: () => ({
    openBuyUsdc: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

describe('BuyCreditsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsdcBalance = {
      balance: null,
      formatted: '—',
      isLoading: true,
      isError: false,
    };
  });

  it('reads wallet address from LightAccount', () => {
    render(<BuyCreditsModal open onOpenChange={vi.fn()} />);

    expect(vi.mocked(useAccount)).toHaveBeenCalledWith({ type: 'LightAccount' });
    expect(vi.mocked(useUsdcBalance)).toHaveBeenCalledWith(
      expect.objectContaining({ id: ARBITRUM_ONE_CHAIN_ID }),
      LIGHT_ACCOUNT_ADDRESS
    );
  });

  it('shows balance loading state while USDC is fetched', () => {
    render(<BuyCreditsModal open onOpenChange={vi.fn()} />);

    expect(screen.getByText('Checking USDC balance…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Starter/i })).toBeDisabled();
  });

  it('enables affordable packs when balance is loaded', () => {
    mockUsdcBalance = {
      balance: '11.52',
      formatted: '11.52',
      isLoading: false,
      isError: false,
    };

    render(<BuyCreditsModal open onOpenChange={vi.fn()} />);

    expect(screen.getByText('Wallet USDC: 11.52')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Starter/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Studio/i })).toBeDisabled();
  });
});
