import type { Config } from 'tailwindcss';

/**
 * Tailwind config: app content only.
 *
 * The previous @account-kit/react/tailwind plugin was removed during the
 * Alchemy v5 + Privy migration. Privy's default modal styling is applied by
 * its own React components and does not require a Tailwind plugin.
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
};

export default config;
