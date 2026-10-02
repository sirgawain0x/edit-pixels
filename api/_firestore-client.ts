/// <reference types="node" />
/**
 * Director Firestore enablement helpers.
 *
 * Persistence uses the REST client in `_firestore-rest.ts` so the Node SDK
 * (and native gRPC) never loads in Vercel Director functions.
 */

export { isDirectorFirestoreEnabled } from './_firestore-rest.js'
