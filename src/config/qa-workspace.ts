/**
 * QA-only OPFS workspace fallback for environments where the File System Access
 * `showDirectoryPicker` cannot run (headless browsers, automated preview tests).
 *
 * Hard-disabled on production deploys regardless of flags.
 */

export const PRODUCTION_APP_HOSTNAME = 'create.creativeplatform.xyz'

const QA_WORKSPACE_QUERY_PARAM = 'qaWorkspace'
const QA_OPFS_ROOT_DIRECTORY_NAME = 'pixels-qa-workspace'
const QA_SESSION_STORAGE_KEY = 'pixels:qaWorkspaceFallback'

export type QaWorkspaceFallbackMode = 'opfs'

function readViteVercelEnv(): string | undefined {
  const value = import.meta.env.VITE_VERCEL_ENV
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function getRuntimeHostname(): string | null {
  if (typeof window === 'undefined') return null
  return window.location.hostname
}

/**
 * True when this build/runtime must never expose the QA workspace fallback,
 * including when a user manually adds `?qaWorkspace=opfs` on production.
 */
export function isProductionDeployEnvironment(): boolean {
  const hostname = getRuntimeHostname()
  if (hostname === PRODUCTION_APP_HOSTNAME) return true

  const vercelEnv = readViteVercelEnv()
  if (vercelEnv === 'production') return true

  return false
}

/**
 * Non-production deploy surfaces where the fallback may be turned on via flag.
 */
export function isQaWorkspaceHostEnvironmentAllowed(): boolean {
  if (isProductionDeployEnvironment()) return false

  if (import.meta.env.DEV) return true

  const vercelEnv = readViteVercelEnv()
  if (vercelEnv === 'preview' || vercelEnv === 'development') return true

  const hostname = getRuntimeHostname()
  if (!hostname) return false
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true
  if (hostname.endsWith('.vercel.app')) return true

  return false
}

export function parseQaWorkspaceFallbackMode(
  raw: string | null | undefined,
): QaWorkspaceFallbackMode | null {
  if (!raw) return null
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'opfs' || normalized === 'true' || normalized === '1') {
    return 'opfs'
  }
  return null
}

export function readQaWorkspaceFallbackModeFromUrl(url: string | URL): QaWorkspaceFallbackMode | null {
  const parsed = typeof url === 'string' ? new URL(url, 'http://localhost') : url
  return parseQaWorkspaceFallbackMode(parsed.searchParams.get(QA_WORKSPACE_QUERY_PARAM))
}

function readQaWorkspaceFallbackModeFromBuildEnv(): QaWorkspaceFallbackMode | null {
  return parseQaWorkspaceFallbackMode(import.meta.env.VITE_QA_WORKSPACE_FALLBACK)
}

function readQaWorkspaceFallbackModeFromSession(
  storage: Storage | null | undefined,
): QaWorkspaceFallbackMode | null {
  if (!storage) return null
  try {
    return parseQaWorkspaceFallbackMode(storage.getItem(QA_SESSION_STORAGE_KEY))
  } catch {
    return null
  }
}

/**
 * Persist `?qaWorkspace=opfs` for the tab session so in-app navigation keeps QA mode.
 */
export function persistQaWorkspaceFallbackFromLocation(
  storage: Storage | null | undefined = typeof window !== 'undefined'
    ? window.sessionStorage
    : null,
): void {
  if (!storage || typeof window === 'undefined') return
  const fromUrl = readQaWorkspaceFallbackModeFromUrl(window.location.href)
  if (!fromUrl) return
  try {
    storage.setItem(QA_SESSION_STORAGE_KEY, fromUrl)
  } catch {
    // Ignore quota / private-mode errors — URL flag still applies for this load.
  }
}

export function resolveQaWorkspaceFallbackMode(options?: {
  url?: string | URL
  storage?: Storage | null
}): QaWorkspaceFallbackMode | null {
  if (!isQaWorkspaceHostEnvironmentAllowed()) return null

  const fromEnv = readQaWorkspaceFallbackModeFromBuildEnv()
  if (fromEnv) return fromEnv

  const storage =
    options?.storage ??
    (typeof window !== 'undefined' ? window.sessionStorage : null)

  if (options?.url) {
    const fromUrl = readQaWorkspaceFallbackModeFromUrl(options.url)
    if (fromUrl) return fromUrl
  } else if (typeof window !== 'undefined') {
    const fromUrl = readQaWorkspaceFallbackModeFromUrl(window.location.href)
    if (fromUrl) return fromUrl
  }

  return readQaWorkspaceFallbackModeFromSession(storage)
}

export function isQaWorkspaceFallbackEnabled(): boolean {
  return resolveQaWorkspaceFallbackMode() === 'opfs'
}

export function isOpfsNavigatorStorageAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
}

export function isQaOpfsWorkspaceHandle(handle: FileSystemDirectoryHandle): boolean {
  return handle.name === QA_OPFS_ROOT_DIRECTORY_NAME
}

/**
 * OPFS-backed directory handle implementing the same surface as a picker result.
 */
export async function getOrCreateOpfsQaWorkspaceHandle(): Promise<FileSystemDirectoryHandle> {
  if (!isOpfsNavigatorStorageAvailable()) {
    throw new Error('OPFS navigator.storage.getDirectory is not available')
  }
  const originRoot = await navigator.storage.getDirectory()
  return originRoot.getDirectoryHandle(QA_OPFS_ROOT_DIRECTORY_NAME, { create: true })
}
