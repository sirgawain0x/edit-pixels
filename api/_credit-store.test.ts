import { describe, expect, it } from 'vitest';
import { parseRedisInteger } from './_credit-store';

describe('parseRedisInteger', () => {
  it('parses numbers', () => {
    expect(parseRedisInteger(50)).toBe(50);
    expect(parseRedisInteger(50.9)).toBe(50);
  });

  it('parses numeric strings from Upstash INCRBY', () => {
    expect(parseRedisInteger('175')).toBe(175);
    expect(parseRedisInteger(' 500 ')).toBe(500);
  });

  it('returns 0 for invalid values', () => {
    expect(parseRedisInteger(null)).toBe(0);
    expect(parseRedisInteger(undefined)).toBe(0);
    expect(parseRedisInteger('')).toBe(0);
    expect(parseRedisInteger('abc')).toBe(0);
    expect(parseRedisInteger(NaN)).toBe(0);
  });
});
