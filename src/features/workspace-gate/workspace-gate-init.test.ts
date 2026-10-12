import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  bootstrapWorkspaceGate,
  pickWorkspaceFolder,
  reconnectWorkspaceFolder,
} from './workspace-gate-init'

vi.mock('@/config/qa-workspace', () => ({
  isQaWorkspaceFallbackEnabled: vi.fn(() => false),
  isOpfsNavigatorStorageAvailable: vi.fn(() => true),
  getOrCreateOpfsQaWorkspaceHandle: vi.fn(),
}))

vi.mock('@/infrastructure/storage/handles-db', () => ({
  ensureKnownWorkspaceForCurrent: vi.fn(async () => undefined),
  getWorkspaceHandleRecord: vi.fn(async () => null),
  getQaOpfsWorkspaceHandleRecord: vi.fn(async () => null),
  isFileSystemAccessSupported: vi.fn(() => true),
  isLikelyMobileBrowser: vi.fn(() => false),
  queryHandlePermission: vi.fn(async () => 'granted' as const),
  requestHandlePermission: vi.fn(async () => 'granted' as const),
  saveWorkspaceHandleRecord: vi.fn(async () => undefined),
  saveQaOpfsWorkspaceHandleRecord: vi.fn(async () => undefined),
}))

import * as qaWorkspace from '@/config/qa-workspace'
import * as handlesDb from '@/infrastructure/storage/handles-db'

const realFolderHandle = { name: 'MyProjects' } as FileSystemDirectoryHandle
const qaHandle = { name: 'pixels-qa-workspace' } as FileSystemDirectoryHandle

const realWorkspaceRecord = {
  key: 'workspace:current',
  kind: 'workspace' as const,
  id: 'current',
  handle: realFolderHandle,
  name: 'MyProjects',
  pickedAt: 1,
  activeWorkspaceId: 'user-uuid',
}

describe('bootstrapWorkspaceGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(qaWorkspace.isQaWorkspaceFallbackEnabled).mockReturnValue(false)
    vi.mocked(handlesDb.isFileSystemAccessSupported).mockReturnValue(true)
    vi.mocked(handlesDb.isLikelyMobileBrowser).mockReturnValue(false)
    vi.mocked(handlesDb.getWorkspaceHandleRecord).mockResolvedValue(null)
    vi.mocked(handlesDb.getQaOpfsWorkspaceHandleRecord).mockResolvedValue(null)
  })

  it('returns pick when no saved workspace exists', async () => {
    const activate = vi.fn(async () => undefined)
    await expect(bootstrapWorkspaceGate(activate)).resolves.toEqual({ kind: 'pick' })
    expect(activate).not.toHaveBeenCalled()
  })

  it('auto-activates OPFS when QA fallback is enabled and no QA record exists', async () => {
    vi.mocked(qaWorkspace.isQaWorkspaceFallbackEnabled).mockReturnValue(true)
    vi.mocked(qaWorkspace.getOrCreateOpfsQaWorkspaceHandle).mockResolvedValue(qaHandle)
    const activate = vi.fn(async () => undefined)

    await expect(bootstrapWorkspaceGate(activate)).resolves.toEqual({ kind: 'ready' })
    expect(handlesDb.saveQaOpfsWorkspaceHandleRecord).toHaveBeenCalledWith(qaHandle)
    expect(handlesDb.saveWorkspaceHandleRecord).not.toHaveBeenCalled()
    expect(activate).toHaveBeenCalledWith(qaHandle)
  })

  it('with QA on, ignores a saved real-folder handle and does not query permission', async () => {
    vi.mocked(qaWorkspace.isQaWorkspaceFallbackEnabled).mockReturnValue(true)
    vi.mocked(handlesDb.getWorkspaceHandleRecord).mockResolvedValue(realWorkspaceRecord)
    vi.mocked(handlesDb.getQaOpfsWorkspaceHandleRecord).mockResolvedValue({
      ...realWorkspaceRecord,
      id: 'qa-opfs',
      key: 'workspace:qa-opfs',
      handle: qaHandle,
      name: qaHandle.name,
    })
    const activate = vi.fn(async () => undefined)

    await expect(bootstrapWorkspaceGate(activate)).resolves.toEqual({ kind: 'ready' })
    expect(handlesDb.queryHandlePermission).not.toHaveBeenCalled()
    expect(handlesDb.saveWorkspaceHandleRecord).not.toHaveBeenCalled()
    expect(activate).toHaveBeenCalledWith(qaHandle)
  })

  it('with QA off, restores the saved real-folder handle', async () => {
    vi.mocked(handlesDb.getWorkspaceHandleRecord).mockResolvedValue(realWorkspaceRecord)
    const activate = vi.fn(async () => undefined)

    await expect(bootstrapWorkspaceGate(activate)).resolves.toEqual({ kind: 'ready' })
    expect(handlesDb.queryHandlePermission).toHaveBeenCalledWith(realFolderHandle)
    expect(activate).toHaveBeenCalledWith(realFolderHandle)
    expect(handlesDb.saveQaOpfsWorkspaceHandleRecord).not.toHaveBeenCalled()
  })

  it('after QA session, real workspace record is still available when flag is off', async () => {
    vi.mocked(handlesDb.getWorkspaceHandleRecord).mockResolvedValue(realWorkspaceRecord)
    const activate = vi.fn(async () => undefined)

    vi.mocked(qaWorkspace.isQaWorkspaceFallbackEnabled).mockReturnValue(true)
    vi.mocked(handlesDb.getQaOpfsWorkspaceHandleRecord).mockResolvedValue({
      ...realWorkspaceRecord,
      id: 'qa-opfs',
      key: 'workspace:qa-opfs',
      handle: qaHandle,
      name: qaHandle.name,
    })
    await bootstrapWorkspaceGate(activate)
    expect(handlesDb.saveWorkspaceHandleRecord).not.toHaveBeenCalled()

    vi.mocked(qaWorkspace.isQaWorkspaceFallbackEnabled).mockReturnValue(false)
    vi.clearAllMocks()
    vi.mocked(handlesDb.getWorkspaceHandleRecord).mockResolvedValue(realWorkspaceRecord)
    await bootstrapWorkspaceGate(activate)
    expect(activate).toHaveBeenCalledWith(realFolderHandle)
  })
})

describe('pickWorkspaceFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns cancelled when the native picker aborts', async () => {
    vi.mocked(qaWorkspace.isQaWorkspaceFallbackEnabled).mockReturnValue(false)
    vi.stubGlobal('window', {
      showDirectoryPicker: vi.fn(async () => {
        throw new DOMException('Aborted', 'AbortError')
      }),
    })

    const activate = vi.fn(async () => undefined)
    await expect(pickWorkspaceFolder(activate)).resolves.toEqual({ kind: 'cancelled' })
  })
})

describe('reconnectWorkspaceFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(handlesDb.getQaOpfsWorkspaceHandleRecord).mockResolvedValue(null)
  })

  it('returns pick when no workspace record exists', async () => {
    vi.mocked(handlesDb.getWorkspaceHandleRecord).mockResolvedValue(null)
    const activate = vi.fn(async () => undefined)
    await expect(reconnectWorkspaceFolder(activate)).resolves.toEqual({ kind: 'pick' })
  })

  it('in QA mode, reconnects via the QA workspace without touching the real handle', async () => {
    vi.mocked(qaWorkspace.isQaWorkspaceFallbackEnabled).mockReturnValue(true)
    vi.mocked(handlesDb.getWorkspaceHandleRecord).mockResolvedValue(realWorkspaceRecord)
    vi.mocked(handlesDb.getQaOpfsWorkspaceHandleRecord).mockResolvedValue({
      ...realWorkspaceRecord,
      id: 'qa-opfs',
      key: 'workspace:qa-opfs',
      handle: qaHandle,
      name: qaHandle.name,
    })
    const activate = vi.fn(async () => undefined)

    await expect(reconnectWorkspaceFolder(activate)).resolves.toEqual({ kind: 'ready' })
    expect(handlesDb.requestHandlePermission).not.toHaveBeenCalled()
    expect(activate).toHaveBeenCalledWith(qaHandle)
  })
})
