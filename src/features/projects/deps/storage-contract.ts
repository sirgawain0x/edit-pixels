/**
 * Adapter exports for storage capability probes used by projects UI.
 * Import from here instead of reaching into infrastructure directly.
 */

export {
  isFileSystemAccessSupported,
  isLikelyMobileBrowser,
  isLocalWorkspaceFolderAvailable,
} from '@/infrastructure/storage/handles-db'
