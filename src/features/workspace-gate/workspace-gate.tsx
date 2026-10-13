/**
 * WorkspaceGate
 *
 * Wraps the router and, when the current URL is a storage-dependent route
 * (`/projects*` or `/editor*`), blocks it until the user has picked a
 * workspace folder and granted read/write permission:
 *
 *   1. Check handles-db for a saved workspace handle
 *   2. If missing → show splash prompting user to pick a folder
 *   3. If present → queryPermission; if granted, set the active root and
 *      render the children. If revoked, show a Reconnect splash.
 *
 * The landing page (`/`) is not a storage-dependent route — it renders
 * without waiting for the gate, so users see no splash flash on first
 * visit. Navigating into a protected route after the handle is initialized
 * falls through to the "ready" path without additional UI.
 *
 * Also listens for permission-lost signals from fs-primitives and flips
 * back to the Reconnect state mid-session.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getWorkspaceHandleRecord } from '@/infrastructure/storage/handles-db'
import { persistQaWorkspaceFallbackFromLocation } from '@/config/qa-workspace'
import {
  bootstrapWorkspaceGate,
  pickWorkspaceFolder,
  reconnectWorkspaceFolder,
} from './workspace-gate-init'
import { onPermissionLost, setWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import { createLogger } from '@/shared/logging/logger'
import { WorkspaceGateSplash } from './workspace-gate-splash'
import { usePathname } from './use-pathname'

/**
 * Routes that read/write the workspace and therefore need the gate to be
 * ready before their loaders run. Anything else renders freely without
 * waiting on storage initialization.
 */
function isStorageProtectedPath(pathname: string): boolean {
  return pathname.startsWith('/projects') || pathname.startsWith('/editor')
}

const logger = createLogger('WorkspaceGate')

type GateStatus =
  | { kind: 'initializing' }
  | { kind: 'unavailable'; reason: 'browser' | 'mobile' }
  | { kind: 'pick' } // No saved handle
  | { kind: 'reconnect'; handleName: string } // Saved handle, permission revoked
  | { kind: 'ready' }

export function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<GateStatus>({ kind: 'initializing' })
  const [error, setError] = useState<string | null>(null)
  const { t } = useTranslation()
  const pathname = usePathname()
  const needsWorkspace = isStorageProtectedPath(pathname)

  useEffect(() => {
    persistQaWorkspaceFallbackFromLocation()
  }, [])

  const activate = useCallback(async (handle: FileSystemDirectoryHandle) => {
    setWorkspaceRoot(handle)
    try {
      const { bootstrapWorkspace } = await import('@/infrastructure/storage/workspace-fs/bootstrap')
      await bootstrapWorkspace(handle)
    } catch (error) {
      logger.warn('bootstrapWorkspace failed', error)
    }
    // Fire the auto-purge sweep for long-trashed projects in the
    // background — it touches disk and we don't want it to block the
    // app render. Wrapped in setTimeout so it runs after first paint.
    setTimeout(() => {
      void import('./deps/trash-auto-purge').then(({ autoPurgeExpiredTrash }) =>
        autoPurgeExpiredTrash(),
      )
    }, 0)
    setStatus({ kind: 'ready' })
    window.dispatchEvent(new Event('pixels:ensure-toaster'))
  }, [])

  // Initial load: check if we have a saved handle, check its permission.
  useEffect(() => {
    let cancelled = false
    void bootstrapWorkspaceGate(activate)
      .then((next) => {
        if (cancelled) return
        setStatus(next)
      })
      .catch((error) => {
        logger.error('Gate initialization failed', error)
        if (!cancelled) setStatus({ kind: 'pick' })
      })
    return () => {
      cancelled = true
    }
  }, [activate])

  // Permission-lost mid-session → flip to reconnect.
  useEffect(() => {
    const unsubscribe = onPermissionLost(() => {
      void (async () => {
        const record = await getWorkspaceHandleRecord()
        setStatus({ kind: 'reconnect', handleName: record?.name ?? 'workspace' })
      })()
    })
    return () => {
      unsubscribe()
    }
  }, [])

  const handlePick = useCallback(async () => {
    setError(null)
    try {
      const result = await pickWorkspaceFolder(activate)
      switch (result.kind) {
        case 'ready':
        case 'cancelled':
          return
        case 'reconnect':
          setError(t('projects.workspaceGate.folderPermissionDenied'))
          setStatus({ kind: 'reconnect', handleName: result.handleName })
          return
        default: {
          const _exhaustive: never = result
          return _exhaustive
        }
      }
    } catch (error) {
      logger.error('Folder pick failed', error)
      setError(t('projects.workspaceGate.folderPickFailed'))
    }
  }, [activate, t])

  const handleReconnect = useCallback(async () => {
    setError(null)
    const result = await reconnectWorkspaceFolder(activate)
    switch (result.kind) {
      case 'ready':
        return
      case 'pick':
        setStatus({ kind: 'pick' })
        return
      case 'denied':
        setError(t('projects.workspaceGate.reconnectPermissionDenied'))
        return
      default: {
        const _exhaustive: never = result
        return _exhaustive
      }
    }
  }, [activate, t])

  // Routes that don't touch storage never wait on the gate — no splash, no
  // flash, even on first load while we're checking handles-db.
  if (!needsWorkspace) {
    return <>{children}</>
  }

  if (status.kind === 'ready') {
    return <>{children}</>
  }

  // On protected routes during initialization, render a bare background
  // block so the transition from "checking" to "ready" or "splash" is
  // invisible instead of a logo+spinner flash.
  if (status.kind === 'initializing') {
    return <div className="min-h-screen bg-background" aria-hidden="true" />
  }

  return (
    <WorkspaceGateSplash
      status={status}
      error={error}
      onPickFolder={handlePick}
      onReconnect={handleReconnect}
    />
  )
}
