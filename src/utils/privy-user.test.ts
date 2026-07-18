import { describe, expect, it } from 'vitest';
import type { User } from '@privy-io/react-auth';
import { getPrivyUserEmail } from './privy-user';

describe('getPrivyUserEmail', () => {
  it('returns email login address when present', () => {
    const user = {
      email: { address: 'alice@example.com' },
    } as User;

    expect(getPrivyUserEmail(user)).toBe('alice@example.com');
  });

  it('returns Google OAuth email when email login is absent', () => {
    const user = {
      google: { email: 'bob@gmail.com', name: 'Bob', subject: 'sub' },
    } as User;

    expect(getPrivyUserEmail(user)).toBe('bob@gmail.com');
  });

  it('prefers email login over Google email', () => {
    const user = {
      email: { address: 'alice@example.com' },
      google: { email: 'alice@gmail.com', name: 'Alice', subject: 'sub' },
    } as User;

    expect(getPrivyUserEmail(user)).toBe('alice@example.com');
  });

  it('returns undefined when no email is available', () => {
    expect(getPrivyUserEmail(null)).toBeUndefined();
    expect(getPrivyUserEmail(undefined)).toBeUndefined();
    expect(getPrivyUserEmail({} as User)).toBeUndefined();
  });
});
