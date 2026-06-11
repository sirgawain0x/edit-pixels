#!/usr/bin/env node
/**
 * Admin CLI: create promo codes in Upstash Redis.
 *
 * Usage:
 *   node scripts/generate-promo-codes.mjs --code PIXELS-K7M2-X9P4 --credits 5 --max 1000 --days 30
 *   node scripts/generate-promo-codes.mjs --batch 50 --credits 5 --max 1 --days 30 --prefix CONTEST
 *
 * Requires KV_REST_API_URL + KV_REST_API_TOKEN (Vercel KV) or
 * UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in .env.local
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Redis } from '@upstash/redis';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

try {
  const envPath = join(root, '.env.local');
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) process.env[key] = value;
  }
} catch {
  // env optional if already exported
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--code') args.code = argv[++i];
    else if (a === '--credits') args.credits = Number(argv[++i]);
    else if (a === '--max') args.max = Number(argv[++i]);
    else if (a === '--days') args.days = Number(argv[++i]);
    else if (a === '--batch') args.batch = Number(argv[++i]);
    else if (a === '--prefix') args.prefix = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--single-use') args.singleUse = true;
  }
  return args;
}

function randomCode(prefix) {
  const seg = randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${seg}`;
}

async function createCode(redis, code, meta) {
  await redis.set(`promo:${code.toUpperCase()}`, JSON.stringify(meta));
}

function getRedisClient() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.KV_REST_API_URL?.trim();
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    process.env.KV_REST_API_TOKEN?.trim();
  if (!url || !token) {
    throw new Error(
      'Missing Redis credentials. Set KV_REST_API_URL + KV_REST_API_TOKEN or UPSTASH_REDIS_REST_*'
    );
  }
  return new Redis({ url, token });
}

async function main() {
  const args = parseArgs(process.argv);
  const credits = args.credits ?? 5;
  const maxRedemptions = args.max ?? 1000;
  const days = args.days ?? 30;
  const expiresAt = Date.now() + days * 86400 * 1000;

  const redis = getRedisClient();
  const meta = {
    credits,
    maxRedemptions,
    expiresAt,
    singleUse: Boolean(args.singleUse),
  };

  if (args.code) {
    await createCode(redis, args.code, meta);
    console.log(`Created promo: ${args.code.toUpperCase()}`);
    console.log(JSON.stringify(meta, null, 2));
    return;
  }

  const batch = args.batch ?? 0;
  if (batch <= 0) {
    console.error(
      'Provide --code PIXELS-XXXX or --batch N with optional --prefix CONTEST'
    );
    process.exit(1);
  }

  const prefix = (args.prefix ?? 'PIXELS').toUpperCase();
  const codes = [];
  for (let i = 0; i < batch; i++) {
    let code;
    do {
      code = randomCode(prefix);
    } while (codes.includes(code));
    codes.push(code);
    await createCode(redis, code, { ...meta, maxRedemptions: 1, singleUse: true });
  }

  console.log(`Created ${codes.length} single-use promo codes.`);
  if (args.out) {
    writeFileSync(join(root, args.out), codes.join('\n') + '\n');
    console.log(`Wrote ${args.out}`);
  } else {
    console.log(codes.join('\n'));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
