import {
  getOrCreateOpfsQaWorkspaceHandle,
  isOpfsNavigatorStorageAvailable,
  isQaWorkspaceFallbackEnabled,
} from '@/config/qa-workspace'
import {
  ensureKnownWorkspaceForCurrent,
  getQaOpfsWorkspaceHandleRecord,
  getWorkspaceHandleRecord,
  isFileSystemAccessSupported,
  isLikelyMobileBrowser,
  queryHandlePermission,
  requestHandlePermission,
  saveQaOpfsWorkspaceHandleRecord,
  saveWorkspaceHandleRecord,
} from '@/infrastructure/storage/handles-db'

export type WorkspaceGateStatus =
  | { kind: 'unavailable'; reason: 'browser' | 'mobile' }
  | { kind: 'pick' }
  | { kind: 'reconnect'; handleName: string }
  | { kind: 'ready' }

function workspaceAccessUnavailableStatus(): WorkspaceGateStatus | null {
  const qaOpfsEnabled = isQaWorkspaceFallbackEnabled()
  if (qaOpfsEnabled) {
    return isOpfsNavigatorStorageAvailable() ? null : { kind: 'unavailable', reason: 'browser' }
  }
  if (!isFileSystemAccessSupported()) {
    return { kind: 'unavailable', reason: 'browser' }
  }
  if (isLikelyMobileBrowser()) {
    return { kind: 'unavailable', reason: 'mobile' }
  }
  return null
}

async function activateOpfsQaWorkspace(
  activate: (handle: FileSystemDirectoryHandle) => Promise<void>,
): Promise<void> {
  const handle = await getOrCreateOpfsQaWorkspaceHandle()
  await saveQaOpfsWorkspaceHandleRecord(handle)
  await activate(handle)
}

async function activatePersistedQaOpfsWorkspace(
  activate: (handle: FileSystemDirectoryHandle) => Promise<void>,
): Promise<WorkspaceGateStatus> {
  const qaRecord = await getQaOpfsWorkspaceHandleRecord()
  if (qaRecord) {
    await activate(qaRecord.handle as FileSystemDirectoryHandle)
    return { kind: 'ready' }
  }
  await activateOpfsQaWorkspace(activate)
  return { kind: 'ready' }
}

async function isReadWritePermissionGranted(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const queryState = await queryHandlePermission(handle)
  if (queryState === 'granted') return true
  const finalState = await requestHandlePermission(handle)
  return finalState === 'granted'
}

async function pickDirectoryWithReadWrite(): Promise<FileSystemDirectoryHandle> {
  return window.showDirectoryPicker({
    id: 'pixels-workspace',
    mode: 'readwrite',
    startIn: 'documents',
  })
}

async function resolveSavedWorkspaceStatus(
  activate: (handle: FileSystemDirectoryHandle) => Promise<void>,
): Promise<WorkspaceGateStatus> {
  if (isQaWorkspaceFallbackEnabled()) {
    return activatePersistedQaOpfsWorkspace(activate)
  }

  const record = await getWorkspaceHandleRecord()
  if (!record) {
    return { kind: 'pick' }
  }

  const handle = record.handle as FileSystemDirectoryHandle
  const permission = await queryHandlePermission(handle)
  if (permission === 'granted') {
    await activate(handle)
    return { kind: 'ready' }
  }

  return { kind: 'reconnect', handleName: record.name }
}

export async function bootstrapWorkspaceGate(
  activate: (handle: FileSystemDirectoryHandle) => Promise<void>,
): Promise<WorkspaceGateStatus> {
  const unavailable = workspaceAccessUnavailableStatus()
  if (unavailable) return unavailable

  await ensureKnownWorkspaceForCurrent()
  return resolveSavedWorkspaceStatus(activate)
}

export type PickWorkspaceFolderResult =
  | { kind: 'ready' }
  | { kind: 'cancelled' }
  | { kind: 'reconnect'; handleName: string; messageKey: 'folderPermissionDenied' }

async function pickNativeWorkspaceFolder(
  activate: (handle: FileSystemDirectoryHandle) => Promise<void>,
): Promise<PickWorkspaceFolderResult> {
  const handle = await pickDirectoryWithReadWrite()
  if (!(await isReadWritePermissionGranted(handle))) {
    return {
      kind: 'reconnect',
      handleName: handle.name,
      messageKey: 'folderPermissionDenied',
    }
  }
  await saveWorkspaceHandleRecord(handle)
  await activate(handle)
  return { kind: 'ready' }
}

export async function pickWorkspaceFolder(
  activate: (handle: FileSystemDirectoryHandle) => Promise<void>,
): Promise<PickWorkspaceFolderResult> {
  if (isQaWorkspaceFallbackEnabled()) {
    await activateOpfsQaWorkspace(activate)
    return { kind: 'ready' }
  }

  try {
    return await pickNativeWorkspaceFolder(activate)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { kind: 'cancelled' }
    }
    throw error
  }
}

export type ReconnectWorkspaceResult =
  | { kind: 'ready' }
  | { kind: 'pick' }
  | { kind: 'denied'; messageKey: 'reconnectPermissionDenied' }

export async function reconnectWorkspaceFolder(
  activate: (handle: FileSystemDirectoryHandle) => Promise<void>,
): Promise<ReconnectWorkspaceResult> {
  if (isQaWorkspaceFallbackEnabled()) {
    await activatePersistedQaOpfsWorkspace(activate)
    return { kind: 'ready' }
  }

  const record = await getWorkspaceHandleRecord()
  if (!record) return { kind: 'pick' }

  const handle = record.handle as FileSystemDirectoryHandle
  const permission = await requestHandlePermission(handle)
  if (permission === 'granted') {
    await activate(handle)
    return { kind: 'ready' }
  }

  return { kind: 'denied', messageKey: 'reconnectPermissionDenied' }
}
