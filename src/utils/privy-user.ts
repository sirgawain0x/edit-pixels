import type { User } from '@privy-io/react-auth';

/**
 * Extract the logged-in user's email from a Privy User.
 * Prefer email login (`user.email.address`), then Google OAuth (`user.google.email`).
 */
export function getPrivyUserEmail(
  user: User | null | undefined
): string | undefined {
  const fromEmail = user?.email?.address;
  if (fromEmail) return fromEmail;
  const fromGoogle = user?.google?.email;
  if (fromGoogle) return fromGoogle;
  return undefined;
}
