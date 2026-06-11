import { describe, expect, it } from 'vitest';
import {
  quoteNanobananaCredits,
  quoteSeedanceCredits,
  creditsToLiveAiMinutes,
} from './credits';

describe('credits config', () => {
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
