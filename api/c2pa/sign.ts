/// <reference types="node" />
// fallow-ignore-file complexity
/**
 * C2PA signing endpoint (embedded mode).
 *
 * Receives the rendered export blob + a manifest template, signs it with the
 * service's X.509 cert, and returns the re-signed file (JUMBF box injected).
 *
 * The browser cannot sign C2PA manifests (no X.509 key client-side), so this
 * serverless route is the trust boundary that holds the signing cert.
 *
 * Current state: STUB. Real signing requires a C2PA signing cert + the
 * `c2pa-node` native bindings (LocalSigner). Until a cert is provisioned
 * (C2PA_CERT_PEM / C2PA_CERT_KEY env vars) AND the c2pa-node integration below
 * is implemented, this returns 503 so the export worker's non-fatal fallback
 * delivers the unsigned blob unchanged.
 *
 * The wallet-challenge cert-issuance endpoint (`POST /api/c2pa/cert`) is
 * specced separately by the signing-service owner; this route only signs.
 */

const MAX_BLOB_BYTES = 2 * 1024 * 1024 * 1024 // 2 GiB guard

function hasSigningCert(): boolean {
  return Boolean(process.env.C2PA_CERT_PEM && process.env.C2PA_CERT_KEY)
}

export async function POST(request: Request): Promise<Response> {
  if (!hasSigningCert()) {
    return Response.json(
      { error: 'C2PA signing not configured: no signing certificate provisioned' },
      { status: 503 },
    )
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const file = form.get('file')
  const manifestRaw = form.get('manifest')

  if (!(file instanceof File)) {
    return Response.json({ error: 'Missing file' }, { status: 400 })
  }
  if (typeof manifestRaw !== 'string') {
    return Response.json({ error: 'Missing manifest' }, { status: 400 })
  }
  if (file.size > MAX_BLOB_BYTES) {
    return Response.json({ error: 'File too large' }, { status: 413 })
  }

  // Parse the manifest template (validated for shape; not trusted for identity).
  let manifest: unknown
  try {
    manifest = JSON.parse(manifestRaw)
  } catch {
    return Response.json({ error: 'Invalid manifest JSON' }, { status: 400 })
  }

  // ── Real signing (TODO: wire c2pa-node once a cert is provisioned) ─────────
  // const { sign } = await import('c2pa-node')
  // const signer = await sign({
  //   manifest,
  //   cert: process.env.C2PA_CERT_PEM,
  //   privateKey: process.env.C2PA_CERT_KEY,
  // })
  // const signed = await signer.sign({ asset: await file.arrayBuffer() })
  // return new Response(signed, { headers: { 'Content-Type': file.type } })
  // ──────────────────────────────────────────────────────────────────────────

  // Not yet implemented — fail closed so the worker falls back to unsigned.
  void manifest
  return Response.json(
    { error: 'C2PA signing not implemented: c2pa-node integration pending' },
    { status: 503 },
  )
}
