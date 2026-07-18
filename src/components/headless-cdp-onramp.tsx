import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { CreditCard, Loader2, Smartphone, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { getOnrampApiBaseUrl } from '@/config/onramp';
import { useWalletContext } from '@/context/wallet-context';
import { createLogger, createOperationId } from '@/shared/logging/logger';
import { getPrivyUserEmail } from '@/utils/privy-user';

const log = createLogger('headless-cdp-onramp');

const PAY_ORIGIN = 'https://pay.coinbase.com';
const DEFAULT_AMOUNT = '25.00';

export type OnrampPaymentMethod =
  | 'GUEST_CHECKOUT_APPLE_PAY'
  | 'GUEST_CHECKOUT_GOOGLE_PAY'
  | 'CARD';

interface HeadlessCdpOnrampProps {
  /** Destination wallet address. */
  address?: `0x${string}`;
  /** Optional user email to prefill. */
  email?: string;
  /** Optional redirect URL after popup/card flow. */
  redirectUrl?: string;
  /** Called when funds are confirmed sent. */
  onSuccess?: () => void;
  /** Called when the user cancels or an error occurs. */
  onError?: (message: string) => void;
  /** Optional extra className for the container. */
  className?: string;
  /** Optional trigger children for inline mode. */
  children?: ReactNode;
}

interface OnrampOrderResult {
  paymentLink: string;
  orderId?: string;
  origin?: string;
}

interface PopupOnrampResult {
  url: string;
}

function formatPhone(digits: string): string {
  if (digits.length === 0) return '';
  if (digits.length > 6) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  }
  if (digits.length > 3) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  }
  return digits;
}

function normalizePhone(raw: string): { valid: boolean; value: string } {
  const digits = raw.replace(/\D/g, '');
  if (/^1\d{10}$/.test(digits)) return { valid: true, value: digits };
  if (/^\d{10}$/.test(digits)) return { valid: true, value: `1${digits}` };
  return { valid: false, value: digits };
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateAmount(value: string): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= 25_000;
}

async function createOnrampOrder(
  address: `0x${string}`,
  email: string,
  phone: string,
  amount: string,
  paymentMethod: OnrampPaymentMethod,
  redirectUrl?: string
): Promise<OnrampOrderResult | PopupOnrampResult> {
  const base = getOnrampApiBaseUrl();
  const url = new URL('/api/onramp-url', base || window.location.origin);
  url.searchParams.set('address', address);
  url.searchParams.set('email', email);
  url.searchParams.set('phone', phone);
  url.searchParams.set('amount', amount);
  url.searchParams.set('paymentMethod', paymentMethod);
  if (redirectUrl) url.searchParams.set('redirectUrl', redirectUrl);

  const res = await fetch(url.toString());
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const msg = typeof data.error === 'string' ? data.error : 'Could not start onramp';
    throw new Error(msg);
  }

  if (typeof data.url === 'string') {
    return { url: data.url };
  }

  if (typeof data.paymentLink !== 'string') {
    throw new Error('Invalid onramp response');
  }

  return {
    paymentLink: data.paymentLink,
    orderId: typeof data.orderId === 'string' ? data.orderId : undefined,
    origin: typeof data.origin === 'string' ? data.origin : PAY_ORIGIN,
  };
}

/**
 * Headless Coinbase onramp widget.
 *
 * Provides Apple Pay / Google Pay via iframe, plus a third "Card / Bank" tab
 * that opens the standard Coinbase buy flow in a popup.
 */
export function HeadlessCdpOnramp({
  address,
  email: emailOverride,
  redirectUrl,
  onSuccess,
  onError,
  className,
  children,
}: HeadlessCdpOnrampProps) {
  const { user } = useWalletContext();
  const prefilledEmail = emailOverride ?? getPrivyUserEmail(user);

  const [activeTab, setActiveTab] = useState<OnrampPaymentMethod>(
    'GUEST_CHECKOUT_APPLE_PAY'
  );
  const [email, setEmail] = useState(prefilledEmail ?? '');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState(DEFAULT_AMOUNT);
  const [isLoading, setIsLoading] = useState(false);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const [popupUrl, setPopupUrl] = useState<string | null>(null);
  const [pollingSuccess, setPollingSuccess] = useState(false);
  const [inlineOpen, setInlineOpen] = useState(false);

  useEffect(() => {
    if (prefilledEmail && !email) {
      setEmail(prefilledEmail);
    }
  }, [prefilledEmail, email]);

  const formattedPhone = useMemo(
    () => formatPhone(phone.replace(/\D/g, '')),
    [phone]
  );

  const phoneValidation = useMemo(() => normalizePhone(phone), [phone]);

  const canSubmit =
    Boolean(address) &&
    validateEmail(email) &&
    phoneValidation.valid &&
    validateAmount(amount);

  const handleSubmit = useCallback(async () => {
    if (!address) {
      onError?.('Connect a wallet first');
      return;
    }
    if (!validateEmail(email) || !phoneValidation.valid || !validateAmount(amount)) {
      onError?.('Fill in a valid email, US phone number, and amount');
      return;
    }

    setIsLoading(true);
    setPaymentLink(null);
    setPopupUrl(null);
    setPollingSuccess(false);
    const opId = createOperationId();
    const event = log.startEvent('cdp_headless_create_order', opId);
    event.merge({ address, paymentMethod: activeTab, amount });

    try {
      const result = await createOnrampOrder(
        address,
        email,
        phoneValidation.value,
        amount,
        activeTab,
        redirectUrl
      );
      if ('url' in result) {
        setPopupUrl(result.url);
        event.success({ mode: 'popup_fallback' });
      } else {
        setPaymentLink(result.paymentLink);
        event.success({ mode: 'headless', orderId: result.orderId });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to start onramp';
      event.failure(e);
      onError?.(msg);
      toast.error('Buy USDC', { description: msg });
    } finally {
      setIsLoading(false);
    }
  }, [
    address,
    email,
    phoneValidation,
    amount,
    activeTab,
    redirectUrl,
    onError,
  ]);

  useEffect(() => {
    if (!paymentLink) return;
    const handler = (event: MessageEvent) => {
      if (event.origin !== PAY_ORIGIN) return;
      let data = event.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      if (!data || typeof data !== 'object' || !('eventName' in data)) return;

      switch (data.eventName) {
        case 'onramp_api.load_success':
          log.info('CDP onramp loaded');
          break;
        case 'onramp_api.commit_success':
          log.info('CDP onramp payment authorized');
          break;
        case 'onramp_api.polling_success':
          setPollingSuccess(true);
          log.info('CDP onramp funds sent');
          toast.success('USDC purchased', {
            description: 'Your balance will update shortly.',
          });
          onSuccess?.();
          break;
        case 'onramp_api.polling_error':
        case 'onramp_api.commit_error':
        case 'onramp_api.load_error': {
          const msg =
            typeof data.data?.errorMessage === 'string'
              ? data.data.errorMessage
              : 'Onramp payment failed';
          log.warn('CDP onramp error', { eventName: data.eventName, msg });
          onError?.(msg);
          toast.error('Buy USDC', { description: msg });
          break;
        }
        case 'onramp_api.cancel':
          log.info('CDP onramp cancelled');
          onError?.('Payment cancelled');
          break;
        default:
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [paymentLink, onSuccess, onError]);

  const openPopup = useCallback(() => {
    if (popupUrl) {
      window.open(popupUrl, '_blank', 'noopener,noreferrer');
    }
  }, [popupUrl]);

  const openInline = useCallback(() => {
    if (!address) {
      onError?.('Connect a wallet first');
      return;
    }
    setInlineOpen(true);
  }, [address, onError]);

  const closeInline = useCallback(() => {
    setInlineOpen(false);
    setPaymentLink(null);
    setPopupUrl(null);
    setPollingSuccess(false);
  }, []);

  const form = (
    <>
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as OnrampPaymentMethod)}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="GUEST_CHECKOUT_APPLE_PAY">
            <Smartphone className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Apple Pay
          </TabsTrigger>
          <TabsTrigger value="GUEST_CHECKOUT_GOOGLE_PAY">
            <Smartphone className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Google Pay
          </TabsTrigger>
          <TabsTrigger value="CARD">
            <CreditCard className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Card / Bank
          </TabsTrigger>
        </TabsList>

        <TabsContent value="GUEST_CHECKOUT_APPLE_PAY" className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Pay with Apple Pay. Requires a US phone number and email for
            Coinbase verification.
          </p>
        </TabsContent>
        <TabsContent value="GUEST_CHECKOUT_GOOGLE_PAY" className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Pay with Google Pay. Requires a US phone number and email for
            Coinbase verification.
          </p>
        </TabsContent>
        <TabsContent value="CARD" className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Pay with card or bank via Coinbase. Opens a secure popup.
          </p>
        </TabsContent>
      </Tabs>

      <div className="mt-3 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="onramp-email">Email</Label>
          <Input
            id="onramp-email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading || Boolean(paymentLink)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="onramp-phone">US phone number</Label>
          <Input
            id="onramp-phone"
            type="tel"
            inputMode="tel"
            placeholder="(555) 123-4567"
            value={formattedPhone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={isLoading || Boolean(paymentLink)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="onramp-amount">Amount (USD)</Label>
          <Input
            id="onramp-amount"
            type="number"
            min="1"
            step="0.01"
            placeholder="25.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isLoading || Boolean(paymentLink)}
          />
        </div>

        {!paymentLink && activeTab !== 'CARD' && (
          <Button
            type="button"
            className="w-full"
            disabled={!canSubmit || isLoading}
            onClick={() => void handleSubmit()}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Opening…
              </>
            ) : (
              <>
                <Wallet className="mr-2 h-4 w-4" aria-hidden />
                Buy USDC with {activeTab === 'GUEST_CHECKOUT_APPLE_PAY' ? 'Apple Pay' : 'Google Pay'}
              </>
            )}
          </Button>
        )}

        {!paymentLink && activeTab === 'CARD' && (
          <Button
            type="button"
            className="w-full"
            disabled={!canSubmit || isLoading}
            onClick={() => void handleSubmit()}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Opening…
              </>
            ) : (
              <>
                <CreditCard className="mr-2 h-4 w-4" aria-hidden />
                Continue to Coinbase
              </>
            )}
          </Button>
        )}

        {paymentLink && !pollingSuccess && (
          <div className="space-y-2">
            <iframe
              src={paymentLink}
              allow="payment"
              sandbox="allow-scripts allow-same-origin allow-popups"
              referrerPolicy="no-referrer"
              title="Coinbase Onramp"
              className="w-full h-[420px] sm:h-[520px] rounded-md border border-border bg-background"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => {
                setPaymentLink(null);
                setPollingSuccess(false);
              }}
            >
              Use a different method
            </Button>
          </div>
        )}

        {popupUrl && (
          <div className="space-y-2">
            <Button
              type="button"
              className="w-full"
              onClick={openPopup}
            >
              <CreditCard className="mr-2 h-4 w-4" aria-hidden />
              Open Coinbase checkout
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              If the popup was blocked, click the button above.
            </p>
          </div>
        )}

        {pollingSuccess && (
          <div className="rounded-md border border-green-500/20 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
            USDC purchase confirmed. You can close this and continue.
          </div>
        )}
      </div>
    </>
  );

  if (children) {
    if (!inlineOpen) {
      return (
        <button
          type="button"
          className={className}
          onClick={openInline}
        >
          {children}
        </button>
      );
    }
    return (
      <div className={className}>
        {form}
        <button
          type="button"
          className="mt-2 text-xs text-muted-foreground underline hover:text-foreground"
          onClick={closeInline}
        >
          Cancel
        </button>
      </div>
    );
  }

  return <div className={className}>{form}</div>;
}
