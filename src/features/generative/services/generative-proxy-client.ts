import { createLogger } from '@/shared/logging/logger';
import {
  quoteNanobananaCredits,
  quoteSeedanceCredits,
} from '@/config/credits';
import {
  buildCreditsAuthMessage,
  generateCreditsNonce,
} from '../deps/credits';
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
  address: `0x${string}`;
  signMessage: (message: string) => Promise<string>;
}

async function withAuth<T extends Record<string, unknown>>(
  params: SignedRequestParams,
  action: string,
  extra: string | undefined,
  payload: T
): Promise<T & { address: string; timestamp: number; nonce: string; signature: string }> {
  const timestamp = Date.now();
  const nonce = generateCreditsNonce();
  const message = buildCreditsAuthMessage(action, params.address, timestamp, nonce, extra);
  const signature = await params.signMessage(message);
  return { ...payload, address: params.address, timestamp, nonce, signature };
}

export function isGenerativeProxyAvailable(): boolean {
  return typeof window !== 'undefined';
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
): Promise<EvolinkTaskDetail & { creditsDebited?: number; balance?: number }> {
  const credits = quoteSeedanceCredits({
    duration: body.duration ?? 5,
    quality: body.quality ?? '720p',
    speed: body.speed ?? 'standard',
    generateAudio: body.generate_audio !== false,
  });
  const signed = await withAuth(
    auth,
    'generate-video',
    `credits: ${credits}`,
    body as Record<string, unknown>
  );

  log.debug('POST /api/generate-video');
  const response = await fetch('/api/generate-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signed),
    signal,
  });

  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as {
      error?: string;
      creditsRequired?: number;
    };
    throw new GenerativeApiError(
      errBody.error ?? `Request failed (${response.status})`,
      response.status,
      errBody.error ?? 'api_error',
    );
  }
  return (await response.json()) as EvolinkTaskDetail & {
    creditsDebited?: number;
    balance?: number;
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
): Promise<EvolinkTaskDetail & { creditsDebited?: number; balance?: number }> {
  const quality = body.quality ?? '2K';
  const credits = quoteNanobananaCredits(quality);
  const signed = await withAuth(
    auth,
    'generate-image',
    `credits: ${credits}`,
    body as Record<string, unknown>
  );

  log.debug('POST /api/generate-image');
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
    creditsDebited?: number;
    balance?: number;
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
