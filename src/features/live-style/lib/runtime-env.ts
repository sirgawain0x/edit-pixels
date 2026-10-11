/** Matches Vercel + Node production detection used for server guards. */
export function isRuntimeProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV === 'production' || env.NODE_ENV === 'production'
}
