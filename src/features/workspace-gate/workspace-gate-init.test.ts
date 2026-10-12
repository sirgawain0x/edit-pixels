import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  bootstrapWorkspaceGate,
  pickWorkspaceFolder,
  reconnectWorkspaceFolder,
} from './workspace-gate-init'

vi.mock('@/config/qa-workspace', () => ({
  isQaWorkspaceFallbackEnabled: vi.fn(() => false),
  isOpfsNavigatorStorageAvailable: vi.fn(() => true),
  isQaOpfsWorkspaceHandle: vi.fn(() => false),
  getOrCreateOpfsQaWorkspaceHandle: vi.fn(),
}))

vi.mock('@/infrastructure/storage/handles-db', () => ({
  ensureKnownWorkspaceForCurrent: vi.fn(async () => undefined),
  getWorkspaceHandleRecord: vi.fn(async () => null),
  isFileSystemAccessSupported: vi.fn(() => true),
  isLikelyMobileBrowser: vi.fn(() => false),
  queryHandlePermission: vi.fn(async () => 'granted' as const),
  requestHandlePermission: vi.fn(async () => 'granted' as const),
  saveWorkspaceHandleRecord: vi.fn(async () => undefined),
}))

import * as qaWorkspace from '@/config/qa-workspace'
import * as handlesDb from '@/infrastructure/storage/handles-db'

describe('bootstrapWorkspaceGate', () => {
  beforeEach(() => {
    vi.mocked(qaWorkspace.isQaWorkspaceFallbackEnabled).mockReturnValue(false)
    vi.mocked(handlesDb.isFileSystemAccessSupported).mockReturnValue(true)
    vi.mocked(handlesDb.isLikelyMobileBrowser).mockReturnValue(false)
    vi.mocked(handlesDb.getWorkspaceHandleRecord).mockResolvedValue(null)
  })

  it('returns pick when no saved workspace exists', async () => {
    const activate = vi.fn(async () => undefined)
    await expect(bootstrapWorkspaceGate(activate)).resolves.toEqual({ kind: 'pick' })
    expect(activate).not.toHaveBeenCalled()
  })

  it('auto-activates OPFS when QA fallback is enabled', async () => {
    const handle = { name: 'pixels-qa-workspace' } as FileSystemDirectoryHandle
    vi.mocked(qaWorkspace.isQaWorkspaceFallbackEnabled).mockReturnValue(true)
    vi.mocked(qaWorkspace.getOrCreateOpfsQaWorkspaceHandle).mockResolvedValue(handle)
    const activate = vi.fn(async () => undefined)

    await expect(bootstrapWorkspaceGate(activate)).resolves.toEqual({ kind: 'ready' })
    expect(handlesDb.saveWorkspaceHandleRecord).toHaveBeenCalledWith(handle)
    expect(activate).toHaveBeenCalledWith(handle)
  })
})

describe('pickWorkspaceFolder', () => {
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
  it('returns pick when no workspace record exists', async () => {
    vi.mocked(handlesDb.getWorkspaceHandleRecord).mockResolvedValue(null)
    const activate = vi.fn(async () => undefined)
    await expect(reconnectWorkspaceFolder(activate)).resolves.toEqual({ kind: 'pick' })
  })
})
