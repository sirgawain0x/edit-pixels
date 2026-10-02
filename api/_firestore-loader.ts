/// <reference types="node" />
/**
 * Load @google-cloud/firestore on demand.
 *
 * A top-level import evaluates the gRPC client while the Vercel function module
 * loads. If that native module fails, POST /api/director never reaches the
 * handler and Vercel returns `{ error: { code, message } }` with status 500.
 * Persistence is optional — Agent Engine still owns the conversation — so a
 * failed load must not fail the brief.
 *
 * This dynamic import is intentional. It is not a circular dependency.
 */

type FirestoreModule = typeof import('@google-cloud/firestore')

let loaded: FirestoreModule | null | undefined

export async function loadFirestore(): Promise<FirestoreModule | null> {
  if (loaded !== undefined) return loaded
  try {
    loaded = await import('@google-cloud/firestore')
  } catch (error) {
    console.error('Firestore module failed to load', error)
    loaded = null
  }
  return loaded
}
