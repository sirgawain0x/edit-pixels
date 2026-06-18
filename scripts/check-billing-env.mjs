#!/usr/bin/env node
/**
 * Validates billing-related environment variables for production.
 * Run locally with .env loaded, or in CI against Vercel env exports.
 *
 * Usage: node scripts/check-billing-env.mjs
 */

const REQUIRED_CLIENT = [
  { key: 'VITE_ALCHEMY_API_KEY', pattern: /^.{8,}$/ },
  { key: 'VITE_ARBITRUM_PAYMENT_CONTRACT', pattern: /^0x[a-fA-F0-9]{40}$/ },
  { key: 'VITE_SUPERFLUID_RECEIVER', pattern: /^0x[a-fA-F0-9]{40}$/ },
];

const REQUIRED_SERVER = [
  {
    keys: ['UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL'],
    pattern: /^https:\/\/.+/,
    label: 'Redis URL (UPSTASH_REDIS_REST_URL or KV_REST_API_URL)',
  },
  {
    keys: ['UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN'],
    pattern: /^.{8,}$/,
    label: 'Redis token (UPSTASH_REDIS_REST_TOKEN or KV_REST_API_TOKEN)',
  },
];

const RECOMMENDED = [
  { key: 'VITE_ALCHEMY_POLICY_ID', pattern: /^.{4,}$/ },
  { key: 'VITE_ALCHEMY_GAS_POLICY_TYPE', pattern: /^(sponsorship|erc20)$/i },
  { key: 'VITE_PIXELS_PREMIUM_LOCK_ADDRESS', pattern: /^0x[a-fA-F0-9]{40}$/ },
];

function check(entries) {
  const results = [];
  for (const entry of entries) {
    const keys = entry.keys ?? [entry.key];
    const value =
      keys.map((k) => process.env[k]?.trim()).find((v) => v && v.length > 0) ?? '';
    const ok = value.length > 0 && entry.pattern.test(value);
    const label = entry.label ?? keys.join(' | ');
    results.push({
      key: label,
      ok,
      value: value ? `${value.slice(0, 12)}…` : '(missing)',
    });
  }
  return results;
}

const client = check(REQUIRED_CLIENT);
const server = check(REQUIRED_SERVER);
const recommended = check(RECOMMENDED);

function printSection(title, rows) {
  console.log(`\n${title}`);
  for (const row of rows) {
    console.log(`  ${row.ok ? '✓' : '✗'} ${row.key}${row.ok ? '' : ` — ${row.value}`}`);
  }
}

printSection('Required (client / VITE_*)', client);
printSection('Required (server / API)', server);
printSection('Recommended', recommended);

const failed = [...client, ...server].filter((r) => !r.ok);
if (failed.length > 0) {
  console.error(`\n${failed.length} required billing env var(s) missing or invalid.`);
  console.error('See docs/internal/billing-economics.md for the full checklist.');
  process.exit(1);
}

console.log('\nAll required billing environment variables are set.');
