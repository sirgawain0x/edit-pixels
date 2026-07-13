import { createLogger } from '@/shared/logging/logger';
import type { EvolinkTaskDetail, NanobananaQuality, SeedanceQuality, SeedanceSpeed } from '../types';

const log = createLogger('GenerativeProxy');

export class GenerativeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'GenerativeApiError';
  }
}

export interface SignedRequestParams {
  getAccessToken: () => Promise<string | null>;
  walletAddress: `0x${string}`;
}

async function withAuth<T extends Record<string, unknown>>(
  params: SignedRequestParams,
  action: string,
  extra: string | undefined,
  payload: T
): Promise<
  T & {
    action: string;
    extra?: string;
    timestamp: number;
    requestId: string;
    walletAddress: `0x${string}`;
    token: string;
  }
> {
  const token = await params.getAccessToken();
  if (!token) {
    throw new GenerativeApiError('Not authenticated', 401, 'not_authenticated');
  }
  return {
    ...payload,
    action,
    ...(extra ? { extra } : {}),
    timestamp: Date.now(),
    requestId: crypto.randomUUID(),
    walletAddress: params.walletAddress,
    token,
  };
}

export function isGenerativeProxyAvailable(): boolean {
  return typeof window !== 'undefined';
}

/**
 * Quote Seedance video render cost in USDC-equivalent (6 decimals).
 * Based on ~$0.10/credit legacy rate: 1.4 credits/sec base.
 */
function quoteSeedanceCostUsdc6(params: {
  duration: number;
  quality: SeedanceQuality;
  speed: SeedanceSpeed;
  generateAudio: boolean;
}): number {
  const { duration, quality, speed, generateAudio } = params;
  const qMult = quality === '1080p' ? 2.5 : quality === '720p' ? 1.6 : 1;
  const sMult = speed === 'fast' ? 0.75 : 1;
  let credits = duration * 1.4 * qMult * sMult;
  if (generateAudio) credits *= 1.15;
  credits = Math.max(1, Math.ceil(credits));
  // $0.10 USDC per credit
  return credits * 100_000;
}

/**
 * Quote Nanobanana image render cost in USDC-equivalent (6 decimals).
 */
function quoteNanobananaCostUsdc6(quality: NanobananaQuality): number {
  const creditMap: Record<NanobananaQuality, number> = {
    '0.5K': 5,
    '1K': 8,
    '2K': 12,
    '4K': 18,
  };
  const credits = creditMap[quality] ?? 10;
  return credits * 100_000;
}

/** Format USDC6 cost for display. */
function formatCostUsdc6(usdc6: number): string {
  const usd = usdc6 / 1_000_000;
  return `$${usd.toFixed(2)}`;
}

export async function proxySubmitVideo(
  auth: SignedRequestParams,
  body: {
    prompt: string;
    image_urls: string[];
    duration?: number;
    quality?: SeedanceQuality;
    speed?: SeedanceSpeed;
    aspect_ratio?: string;
    generate_audio?: boolean;
  },
  signal?: AbortSignal
): Promise<EvolinkTaskDetail & { costUsdc6?: number; crtvaiRequired?: string }> {
  const costUsdc6 = quoteSeedanceCostUsdc6({
    duration: body.duration ?? 5,
    quality: body.quality ?? '720p',
    speed: body.speed ?? 'standard',
    generateAudio: body.generate_audio !== false,
  });

  const signed = await withAuth(
    auth,
    'generate-video',
    `cost: ${formatCostUsdc6(costUsdc6)} USDC (CRTVAI)`,
    body as Record<string, unknown>
  );

  log.debug('POST /api/generate-video', { costUsdc6 });
  const response = await fetch('/api/generate-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signed),
    signal,
  });

  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as {
      error?: string;
      costUsdc6?: number;
      crtvaiRequired?: string;
    };
    throw new GenerativeApiError(
      errBody.error ?? `Request failed (${response.status})`,
      response.status,
      errBody.error ?? 'api_error',
    );
  }
  return (await response.json()) as EvolinkTaskDetail & {
    costUsdc6?: number;
    crtvaiRequired?: string;
  };
}

export async function proxySubmitImage(
  auth: SignedRequestParams,
  body: {
    prompt: string;
    size?: string;
    quality?: NanobananaQuality;
    image_urls?: string[];
  },
  signal?: AbortSignal
): Promise<EvolinkTaskDetail & { costUsdc6?: number; crtvaiRequired?: string }> {
  const quality = body.quality ?? '2K';
  const costUsdc6 = quoteNanobananaCostUsdc6(quality);

  const signed = await withAuth(
    auth,
    'generate-image',
    `cost: ${formatCostUsdc6(costUsdc6)} USDC (CRTVAI)`,
    body as Record<string, unknown>
  );

  log.debug('POST /api/generate-image', { costUsdc6 });
  const response = await fetch('/api/generate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signed),
    signal,
  });

  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as { error?: string };
    throw new GenerativeApiError(
      errBody.error ?? `Request failed (${response.status})`,
      response.status,
      errBody.error ?? 'api_error',
    );
  }
  return (await response.json()) as EvolinkTaskDetail & {
    costUsdc6?: number;
    crtvaiRequired?: string;
  };
}

export async function proxyGetTask(
  taskId: string,
  signal?: AbortSignal
): Promise<EvolinkTaskDetail> {
  const url = new URL('/api/generate-task', window.location.origin);
  url.searchParams.set('id', taskId);
  const response = await fetch(url.toString(), { signal });
  if (!response.ok) {
    throw new GenerativeApiError(
      `Poll failed (${response.status})`,
      response.status,
      'poll_error',
    );
  }
  return (await response.json()) as EvolinkTaskDetail;
}

// Export cost helpers for UI display
export { quoteSeedanceCostUsdc6, quoteNanobananaCostUsdc6, formatCostUsdc6 };