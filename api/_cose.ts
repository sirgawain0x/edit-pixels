/// <reference types="node" />
// fallow-ignore-file complexity
/**
 * Minimal CBOR encoder + C2PA COSE Sign1 builder for the signing service.
 *
 * The C2PA claim signature is a COSE_Sign1 structure (RFC 9052) carrying the
 * signer's X.509 cert in the protected header's `x5chain` (label 33). This
 * module hand-rolls the tiny, fixed CBOR structures involved so the service
 * needs no CBOR dependency and no native `c2pa-node`/Rust.
 *
 * The structures are small and fixed, so a full CBOR codec is overkill; we
 * encode exactly what C2PA needs:
 *   - unsigned int, negative int, byte string, text string, array, map, null, tag
 */

function head(major: number, value: number): Uint8Array {
  if (value < 24) return new Uint8Array([(major << 5) | value])
  if (value < 0x100) return new Uint8Array([(major << 5) | 24, value])
  if (value < 0x10000) {
    return new Uint8Array([(major << 5) | 25, value >> 8, value & 0xff])
  }
  if (value < 0x100000000) {
    return new Uint8Array([
      (major << 5) | 26,
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ])
  }
  throw new Error('CBOR value too large')
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

/** Major type 2 (byte string) wrapping `data`. */
export function bstr(data: Uint8Array): Uint8Array {
  return concat(head(2, data.length), data)
}

/** Major type 3 (text string). */
function text(s: string): Uint8Array {
  return bstr(new TextEncoder().encode(s))
}

/** Major type 0 (unsigned int). */
function uint(n: number): Uint8Array {
  return head(0, n)
}

/** Major type 1 (negative int). `n` is negative; CBOR stores `-1 - n`. */
function negInt(n: number): Uint8Array {
  return head(1, -1 - n)
}

/** Major type 4 (array). */
function array(items: Uint8Array[]): Uint8Array {
  return concat(head(4, items.length), ...items)
}

/** Major type 5 (map). Entries are [key, value] pairs. */
function map(entries: Uint8Array[][]): Uint8Array {
  return concat(head(5, entries.length), ...entries.flat())
}

/** Major type 6 (tag). */
function tag(t: number, value: Uint8Array): Uint8Array {
  return concat(head(6, t), value)
}

/** Major type 7, value 22 (null). */
const NULL = new Uint8Array([0xf6])

/** COSE algorithm identifiers (RFC 9052 / IANA). ES256 = -7. */
const ES256 = -7

/**
 * Build the COSE protected header: `{ 1: -7 (ES256), 33: <cert DER> }`.
 *
 * Per C2PA spec §14.5, a single certificate is carried as a CBOR byte string
 * (not an array); an array is only used for a multi-cert chain. This matches
 * c2pa-rs's `build_protected_header`, which emits `Value::Bytes` for a single
 * cert — so we do the same to round-trip cleanly through its validator.
 */
export function buildProtectedHeader(certDer: Uint8Array): Uint8Array {
  return map([
    [uint(1), negInt(ES256)],
    [uint(33), bstr(certDer)],
  ])
}

/**
 * Build the COSE Sig_structure (RFC 9052 §4.4) that is actually signed:
 *
 *   Sig_structure = [ "Signature1", protected, bstr(""), claimBytes ]
 *
 * The signature is computed over the CBOR encoding of THIS structure — not the
 * claim bytes directly. `protected` must be the exact same byte string that
 * appears in the final COSE_Sign1.
 */
export function buildSigStructure(protectedBstr: Uint8Array, claimBytes: Uint8Array): Uint8Array {
  return array([
    text('Signature1'),
    protectedBstr,
    bstr(new Uint8Array(0)), // external_aad = empty
    bstr(claimBytes), // payload (detached in the Sign1, present here)
  ])
}

/**
 * Assemble the final COSE_Sign1 (tag 18) with a detached payload:
 *
 *   #6.18([ protected, {}, null, signature ])
 */
export function buildCoseSign1(opts: {
  protectedBstr: Uint8Array
  signature: Uint8Array
}): Uint8Array {
  return tag(
    18,
    array([
      opts.protectedBstr,
      map([]), // unprotected = empty map
      NULL, // detached payload
      bstr(opts.signature),
    ]),
  )
}

/**
 * Strip PEM armor and base64-decode to DER bytes. Tolerates both literal `\n`
 * escape sequences (as dotenv writes them) and real newlines.
 */
export function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\\n/g, '')
    .replace(/\s+/g, '')
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

/**
 * Normalize a PEM string for Node's crypto: convert literal `\n` escapes to
 * real newlines so `createPrivateKey` parses it regardless of how the env var
 * was written.
 */
export function normalizePem(pem: string): string {
  return pem.replace(/\\n/g, '\n')
}
