/**
 * Integration: wallet EIP-712 → per-wallet cert → claim sign → c2pa-web embed/readback.
 *
 * Cert issuance runs in-process against the real API handlers + an in-memory Redis.
 * Embed + readback need a real browser Worker (jsdom can't host c2pa-web), so that
 * half runs in Playwright Chromium against a tiny local harness that serves the
 * same `/api/c2pa/sign` handler.
 */

/** @vitest-environment node */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { clearC2paCertIdCache, getC2paCertId } from './c2pa-cert'
import { generateC2paTestPems, MINI_JPEG } from './c2pa-test-fixtures'

const redisStore = new Map<string, string>()

vi.mock('../../../../api/_redis-client', () => ({
  getRedis: async () => ({
    get: async (key: string) => redisStore.get(key) ?? null,
    set: async (key: string, value: string) => {
      redisStore.set(key, value)
      return 'OK'
    },
    del: async (key: string) => {
      redisStore.delete(key)
      return 1
    },
  }),
  isRedisConfigured: () => true,
}))

const { POST: challengePost } = await import('../../../../api/c2pa/certs/challenge')
const { POST: certsPost } = await import('../../../../api/c2pa/certs')
const { POST: signPost } = await import('../../../../api/c2pa/sign')

function routeC2paFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const path = raw.replace(/^https?:\/\/[^/]+/, '')
  const request = new Request(`http://c2pa.test${path.startsWith('/') ? path : `/${path}`}`, init)

  if (path.includes('/api/c2pa/certs/challenge')) return challengePost(request)
  if (path.includes('/api/c2pa/certs')) return certsPost(request)
  if (path.includes('/api/c2pa/sign')) return signPost(request)
  return Promise.reject(new Error(`unexpected fetch: ${path}`))
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  res.end(Buffer.from(await response.arrayBuffer()))
}

const C2PA_DIST = join(process.cwd(), 'node_modules/@contentauth/c2pa-web/dist')
const HIGHGAIN_DIST = join(process.cwd(), 'node_modules/highgain/dist')

function serveStatic(root: string, urlPath: string, prefix: string, res: ServerResponse): boolean {
  if (!urlPath.startsWith(prefix)) return false
  const file = urlPath.slice(prefix.length).split('?')[0] ?? ''
  const abs = join(root, file)
  if (!abs.startsWith(root)) {
    res.statusCode = 403
    res.end('forbidden')
    return true
  }
  try {
    const data = readFileSync(abs)
    res.setHeader(
      'content-type',
      file.endsWith('.js')
        ? 'text/javascript'
        : file.endsWith('.wasm')
          ? 'application/wasm'
          : 'application/octet-stream',
    )
    res.end(data)
  } catch {
    res.statusCode = 404
    res.end('not found')
  }
  return true
}

function harnessHtml(wallet: string, certId: string): string {
  const jpegB64 = Buffer.from(MINI_JPEG).toString('base64')
  return `<!doctype html>
<html><body>
<pre id="out">running…</pre>
<script type="importmap">
{
  "imports": {
    "highgain": "/vendor/highgain/index.js"
  }
}
</script>
<script type="module">
import { createC2pa } from '/c2pa/inline.js';

const wallet = ${JSON.stringify(wallet)};
const certId = ${JSON.stringify(certId)};
const jpegB64 = ${JSON.stringify(jpegB64)};

function b64ToUint8(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

try {
  const blob = new Blob([b64ToUint8(jpegB64)], { type: 'image/jpeg' });
  const c2pa = await createC2pa();
  const builder = await c2pa.builder.new();
  try {
    await builder.setIntent('edit');
    await builder.addAssertion('c2pa.actions', { actions: [{ action: 'c2pa.edited' }] });
    await builder.addAssertion('stds.schema-org.CreativeWork', {
      author: [{ '@id': 'did:ethr:' + wallet }],
    });
    const signer = {
      alg: 'es256',
      reserveSize: async () => 4096,
      sign: async (data) => {
        const body = new Uint8Array(data);
        const res = await fetch('/api/c2pa/sign', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-C2PA-CertId': certId,
          },
          body,
        });
        if (!res.ok) throw new Error('sign failed: ' + res.status + ' ' + (await res.text()));
        return new Uint8Array(await res.arrayBuffer());
      },
    };
    const signedBytes = await builder.sign(signer, 'image/jpeg', blob);
    const signedBlob = new Blob([signedBytes], { type: 'image/jpeg' });
    const reader = await c2pa.reader.fromBlob('image/jpeg', signedBlob);
    try {
      const store = await reader.manifestStore();
      const json = JSON.stringify(store);
      window.__C2PA_RESULT__ = { ok: true, json };
      document.getElementById('out').textContent = json;
    } finally {
      await reader.free();
    }
  } finally {
    await builder.free();
  }
} catch (e) {
  const err = { ok: false, error: String(e), stack: e && e.stack };
  window.__C2PA_RESULT__ = err;
  document.getElementById('out').textContent = JSON.stringify(err);
}
</script>
</body></html>`
}

describe('C2PA wallet → cert → sign → c2pa-web readback', () => {
  let wallet: `0x${string}`
  let account: ReturnType<typeof privateKeyToAccount>
  let walletClient: {
    signTypedData: (
      args: Parameters<ReturnType<typeof privateKeyToAccount>['signTypedData']>[0] & {
        account?: unknown
      },
    ) => Promise<`0x${string}`>
  }

  beforeAll(async () => {
    const { keyPem, certPem } = await generateC2paTestPems()
    process.env.C2PA_CERT_KEY = keyPem
    process.env.C2PA_CERT_PEM = certPem
  })

  beforeEach(() => {
    redisStore.clear()
    clearC2paCertIdCache()
    account = privateKeyToAccount(generatePrivateKey())
    wallet = account.address
    // getC2paCertId passes `account: <address>`, which forces JSON-RPC signing on a
    // real WalletClient. Stub a local signer so the EIP-712 proof stays in-process.
    walletClient = {
      signTypedData: (args) =>
        account.signTypedData({
          domain: args.domain,
          types: args.types,
          primaryType: args.primaryType,
          message: args.message,
        }),
    }
    vi.stubGlobal('fetch', routeC2paFetch)
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('issues a per-wallet certId via EIP-712 ownership proof', async () => {
    const certId = await getC2paCertId(wallet, walletClient as never)
    expect(certId).toMatch(/^[0-9a-f]{32}$/)

    const again = await getC2paCertId(wallet, walletClient as never)
    expect(again).toBe(certId)
  })

  it('embeds a signed JPEG and reads back did:ethr author via c2pa-web', async () => {
    const certId = await getC2paCertId(wallet, walletClient as never)
    expect(certId).toBeTruthy()

    const server = createServer(async (req, res) => {
      try {
        const url = req.url ?? '/'
        if (url.startsWith('/api/c2pa/sign') && req.method === 'POST') {
          const body = await readBody(req)
          const headers = new Headers()
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string') headers.set(key, value)
          }
          await writeResponse(
            res,
            await signPost(
              new Request('http://c2pa.test/api/c2pa/sign', {
                method: 'POST',
                headers,
                body: new Uint8Array(body),
              }),
            ),
          )
          return
        }
        if (serveStatic(C2PA_DIST, url, '/c2pa/', res)) return
        if (serveStatic(HIGHGAIN_DIST, url, '/vendor/highgain/', res)) return
        if (url.startsWith('/harness')) {
          res.setHeader('content-type', 'text/html; charset=utf-8')
          res.end(harnessHtml(wallet, certId as string))
          return
        }
        res.statusCode = 404
        res.end('not found')
      } catch (e) {
        res.statusCode = 500
        res.end(String(e))
      }
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      throw new Error('failed to bind harness server')
    }
    const baseUrl = `http://127.0.0.1:${address.port}`

    try {
      const { chromium } = await import('playwright')
      const browser = await chromium.launch({ headless: true })
      try {
        const page = await browser.newPage()
        const consoleLogs: string[] = []
        page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`))
        page.on('pageerror', (err) => consoleLogs.push(`[pageerror] ${err.message}`))
        page.on('requestfailed', (req) =>
          consoleLogs.push(`[requestfailed] ${req.url()} ${req.failure()?.errorText}`),
        )
        await page.goto(`${baseUrl}/harness`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        try {
          await page.waitForFunction(
            () =>
              (window as unknown as { __C2PA_RESULT__?: { ok: boolean } }).__C2PA_RESULT__ != null,
            null,
            { timeout: 60_000 },
          )
        } catch (e) {
          const body = await page.locator('#out').textContent()
          throw new Error(
            `harness timeout; out=${body}; logs=\n${consoleLogs.join('\n')}\n${String(e)}`,
          )
        }
        const result = await page.evaluate(
          () =>
            (
              window as unknown as {
                __C2PA_RESULT__: { ok: boolean; json?: string; error?: string }
              }
            ).__C2PA_RESULT__,
        )
        expect(result.ok, result.error ?? 'c2pa harness failed').toBe(true)
        expect(result.json).toContain(`did:ethr:${wallet}`)
      } finally {
        await browser.close()
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      )
    }
  }, 120_000)
})
