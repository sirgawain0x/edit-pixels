/// <reference types="node" />
/**
 * Lazy Firestore client for Director product persistence.
 * Uses the same WIF / ADC auth path as Vertex (`api/_vertex-auth.ts`).
 */

import { Firestore } from '@google-cloud/firestore'
import { getGoogleAuthClient, getVertexProject } from './_vertex-auth.js'

let firestore: Firestore | null = null
let firestoreInit: Promise<Firestore | null> | null = null

/** Named Firestore DB in GCP (Studio: creative-director-1). Override via FIRESTORE_DATABASE_ID. */
const DEFAULT_DATABASE_ID = 'creative-director-1'

export function getFirestoreDatabaseId(): string {
  return process.env.FIRESTORE_DATABASE_ID?.trim() || DEFAULT_DATABASE_ID
}

export function isDirectorFirestoreEnabled(): boolean {
  if (process.env.DIRECTOR_FIRESTORE_DISABLED === '1') return false
  return Boolean(getVertexProject())
}

async function createFirestore(): Promise<Firestore | null> {
  if (!isDirectorFirestoreEnabled()) return null
  try {
    const authClient = await getGoogleAuthClient()
    return new Firestore({
      projectId: getVertexProject(),
      databaseId: getFirestoreDatabaseId(),
      authClient,
    })
  } catch (error) {
    console.error('Firestore init failed', error)
    return null
  }
}

export async function getFirestoreDb(): Promise<Firestore | null> {
  if (!isDirectorFirestoreEnabled()) return null
  if (firestore) return firestore
  if (!firestoreInit) {
    firestoreInit = createFirestore().then((db) => {
      firestore = db
      return db
    })
  }
  return firestoreInit
}
