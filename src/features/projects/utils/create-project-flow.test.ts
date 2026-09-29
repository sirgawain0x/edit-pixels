import { describe, expect, it, vi } from 'vitest'
import {
  getCreateFailureDescription,
  getCreatedProjectId,
  getNewProjectButtonMode,
  runCreatePreflight,
} from './create-project-flow'

describe('runCreatePreflight', () => {
  it('prompts wallet connect when required', () => {
    const promptConnect = vi.fn()
    expect(
      runCreatePreflight({
        requireWallet: true,
        createAvailable: true,
        promptConnect,
        t: (key) => key,
      }),
    ).toBe(false)
    expect(promptConnect).toHaveBeenCalledOnce()
  })

  it('blocks when local workspace create is unavailable', () => {
    expect(
      runCreatePreflight({
        requireWallet: false,
        createAvailable: false,
        promptConnect: vi.fn(),
        t: (key) => key,
      }),
    ).toBe(false)
  })

  it('allows create when wallet and workspace are ready', () => {
    expect(
      runCreatePreflight({
        requireWallet: false,
        createAvailable: true,
        promptConnect: vi.fn(),
        t: (key) => key,
      }),
    ).toBe(true)
  })
})

describe('getNewProjectButtonMode', () => {
  it('prioritizes initializing over other gates', () => {
    expect(
      getNewProjectButtonMode({
        walletInitializing: true,
        requireWalletForNewProject: true,
        createAvailable: false,
      }),
    ).toBe('initializing')
  })

  it('returns unavailable when create is blocked on device', () => {
    expect(
      getNewProjectButtonMode({
        walletInitializing: false,
        requireWalletForNewProject: false,
        createAvailable: false,
      }),
    ).toBe('unavailable')
  })
})

describe('getCreatedProjectId', () => {
  it('returns the project id on success', () => {
    expect(getCreatedProjectId({ success: true, project: { id: 'p1' } })).toBe('p1')
  })

  it('returns null when create failed', () => {
    expect(getCreatedProjectId({ success: false, project: null })).toBeNull()
  })
})

describe('getCreateFailureDescription', () => {
  it('falls back to tryAgain copy', () => {
    expect(getCreateFailureDescription(null, (key) => key)).toBe('projects.tryAgain')
  })
})
