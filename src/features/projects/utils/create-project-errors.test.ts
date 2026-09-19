import { describe, expect, it, vi } from 'vitest'
import { mapCreateProjectError } from './create-project-errors'
import { isLocalWorkspaceFolderAvailable } from '@/features/projects/deps/storage-contract'

vi.mock('@/features/projects/deps/storage-contract', () => ({
  isLocalWorkspaceFolderAvailable: vi.fn(() => true),
}))

const t = (key: string) => key

describe('mapCreateProjectError', () => {
  it('maps InvalidStateError to reconnect copy on desktop', () => {
    const error = new DOMException(
      'An operation that depends on state cached in an interface object was made but the state had changed since it was read from disk.',
      'InvalidStateError',
    )
    expect(mapCreateProjectError(error, t)).toBe('projects.create.reconnectRequired')
  })

  it('maps NotAllowedError to reconnect copy', () => {
    expect(mapCreateProjectError(new DOMException('denied', 'NotAllowedError'), t)).toBe(
      'projects.create.reconnectRequired',
    )
  })

  it('returns unavailable copy when local workspace is not supported', () => {
    vi.mocked(isLocalWorkspaceFolderAvailable).mockReturnValueOnce(false)
    expect(mapCreateProjectError(new Error('anything'), t)).toBe('projects.create.unavailable')
  })

  it('falls back to tryAgain for unknown errors', () => {
    expect(mapCreateProjectError(new Error('disk full'), t)).toBe('projects.tryAgain')
  })
})
