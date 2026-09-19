import { isLocalWorkspaceFolderAvailable } from '@/features/projects/deps/storage-contract'

const CACHED_INTERFACE_STATE_RE =
  /cached in an interface object|state had changed since it was read from disk/i

function isFilesystemReconnectError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return (
      error.name === 'InvalidStateError' ||
      error.name === 'NotAllowedError' ||
      error.name === 'SecurityError'
    )
  }
  if (error instanceof Error) {
    if (CACHED_INTERFACE_STATE_RE.test(error.message)) return true
    if (/InvalidStateError/i.test(error.message)) return true
  }
  return false
}

/** Map workspace write failures to user-facing i18n copy (never raw DOMException text). */
export function mapCreateProjectError(error: unknown, t: (key: string) => string): string {
  if (!isLocalWorkspaceFolderAvailable()) {
    return t('projects.create.unavailable')
  }
  if (isFilesystemReconnectError(error)) {
    return t('projects.create.reconnectRequired')
  }
  return t('projects.tryAgain')
}
