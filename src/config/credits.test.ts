import { describe, expect, it } from 'vitest';
import {
  CREDIT_PACKS,
  quoteNanobananaCredits,
  quoteSeedanceCredits,
  creditsToLiveAiMinutes,
} from './credits';

describe('credits config', () => {
  it('defines retail packs aligned with PaymentContract', () => {
    expect(CREDIT_PACKS).toHaveLength(3);
    expect(CREDIT_PACKS[0]).toMatchObject({ id: 0, usdc6: 5_000_000, credits: 50 });
    expect(CREDIT_PACKS[1]).toMatchObject({ id: 1, usdc6: 15_000_000, credits: 175 });
    expect(CREDIT_PACKS[2]).toMatchObject({ id: 2, usdc6: 40_000_000, credits: 500 });
  });

  it('quotes seedance with quality multiplier', () => {
    const low = quoteSeedanceCredits({
      duration: 5,
      quality: '480p',
      speed: 'standard',
      generateAudio: false,
    });
    const high = quoteSeedanceCredits({
      duration: 15,
      quality: '1080p',
      speed: 'standard',
      generateAudio: true,
    });
    expect(high).toBeGreaterThan(low);
  });

  it('quotes nanobanana by quality', () => {
    expect(quoteNanobananaCredits('4K')).toBeGreaterThan(quoteNanobananaCredits('1K'));
  });

  it('maps 50 credits to ~45 min live AI', () => {
    const minutes = creditsToLiveAiMinutes(50);
    expect(minutes).toBeGreaterThan(44);
    expect(minutes).toBeLessThan(46);
  });
});
