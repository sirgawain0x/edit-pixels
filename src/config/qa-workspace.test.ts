import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  PRODUCTION_APP_HOSTNAME,
  getOrCreateOpfsQaWorkspaceHandle,
  isProductionDeployEnvironment,
  isQaWorkspaceFallbackEnabled,
  isQaWorkspaceHostEnvironmentAllowed,
  isQaOpfsWorkspaceHandle,
  parseQaWorkspaceFallbackMode,
  readQaWorkspaceFallbackModeFromUrl,
  resolveQaWorkspaceFallbackMode,
} from './qa-workspace'

describe('qa-workspace production gate', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('blocks production hostname even when the query flag is set', () => {
    vi.stubGlobal('window', {
      location: { hostname: PRODUCTION_APP_HOSTNAME, href: `https://${PRODUCTION_APP_HOSTNAME}/?qaWorkspace=opfs` },
      sessionStorage: { getItem: () => null, setItem: vi.fn() },
    })
    vi.stubEnv('VITE_VERCEL_ENV', 'preview')

    expect(isProductionDeployEnvironment()).toBe(true)
    expect(isQaWorkspaceHostEnvironmentAllowed()).toBe(false)
    expect(
      resolveQaWorkspaceFallbackMode({
        url: `https://${PRODUCTION_APP_HOSTNAME}/projects?qaWorkspace=opfs`,
      }),
    ).toBeNull()
    expect(isQaWorkspaceFallbackEnabled()).toBe(false)
  })

  it('blocks when VITE_VERCEL_ENV is missing even with the query flag on vercel.app', () => {
    vi.stubGlobal('window', {
      location: {
        hostname: 'edit-pixels.vercel.app',
        href: 'https://edit-pixels.vercel.app/?qaWorkspace=opfs',
      },
      sessionStorage: { getItem: () => null, setItem: vi.fn() },
    })
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_VERCEL_ENV', '')

    expect(isProductionDeployEnvironment()).toBe(false)
    expect(isQaWorkspaceHostEnvironmentAllowed()).toBe(false)
    expect(resolveQaWorkspaceFallbackMode()).toBeNull()
    expect(isQaWorkspaceFallbackEnabled()).toBe(false)
  })

  it('allows qa mode in Vite dev (import.meta.env.DEV) without VITE_VERCEL_ENV', () => {
    vi.stubGlobal('window', {
      location: {
        hostname: 'localhost',
        href: 'http://localhost:5173/?qaWorkspace=opfs',
      },
      sessionStorage: { getItem: () => null, setItem: vi.fn() },
    })
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_VERCEL_ENV', '')

    expect(isQaWorkspaceHostEnvironmentAllowed()).toBe(true)
    expect(resolveQaWorkspaceFallbackMode()).toBe('opfs')
  })

  it('blocks when VITE_VERCEL_ENV is production even with the query flag', () => {
    vi.stubGlobal('window', {
      location: { hostname: 'pixels-git-staging-example.vercel.app', href: 'https://pixels-git-staging-example.vercel.app/?qaWorkspace=opfs' },
      sessionStorage: { getItem: () => null, setItem: vi.fn() },
    })
    vi.stubEnv('VITE_VERCEL_ENV', 'production')

    expect(isProductionDeployEnvironment()).toBe(true)
    expect(resolveQaWorkspaceFallbackMode()).toBeNull()
    expect(isQaWorkspaceFallbackEnabled()).toBe(false)
  })

  it('enables opfs mode on preview when the query flag is set', () => {
    vi.stubGlobal('window', {
      location: {
        hostname: 'pixels-git-staging-example.vercel.app',
        href: 'https://pixels-git-staging-example.vercel.app/?qaWorkspace=opfs',
      },
      sessionStorage: { getItem: () => null, setItem: vi.fn() },
    })
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_VERCEL_ENV', 'preview')

    expect(readQaWorkspaceFallbackModeFromUrl('https://preview.example/?qaWorkspace=opfs')).toBe(
      'opfs',
    )
    expect(resolveQaWorkspaceFallbackMode()).toBe('opfs')
    expect(isQaWorkspaceFallbackEnabled()).toBe(true)
  })

  it('stays off on preview without the flag or build env', () => {
    vi.stubGlobal('window', {
      location: {
        hostname: 'pixels-git-staging-example.vercel.app',
        href: 'https://pixels-git-staging-example.vercel.app/projects',
      },
      sessionStorage: { getItem: () => null, setItem: vi.fn() },
    })
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_VERCEL_ENV', 'preview')

    expect(resolveQaWorkspaceFallbackMode()).toBeNull()
    expect(isQaWorkspaceFallbackEnabled()).toBe(false)
  })

  it('enables opfs mode on development VITE_VERCEL_ENV when the query flag is set', () => {
    vi.stubGlobal('window', {
      location: {
        hostname: 'pixels-dev.example.vercel.app',
        href: 'https://pixels-dev.example.vercel.app/?qaWorkspace=opfs',
      },
      sessionStorage: { getItem: () => null, setItem: vi.fn() },
    })
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_VERCEL_ENV', 'development')

    expect(isQaWorkspaceHostEnvironmentAllowed()).toBe(true)
    expect(resolveQaWorkspaceFallbackMode()).toBe('opfs')
  })

  it('accepts VITE_QA_WORKSPACE_FALLBACK on allowed hosts', () => {
    vi.stubGlobal('window', {
      location: { hostname: 'localhost', href: 'http://localhost:5173/' },
      sessionStorage: { getItem: () => null, setItem: vi.fn() },
    })
    vi.stubEnv('VITE_QA_WORKSPACE_FALLBACK', 'opfs')
    vi.stubEnv('VITE_VERCEL_ENV', 'development')

    expect(parseQaWorkspaceFallbackMode('opfs')).toBe('opfs')
    expect(resolveQaWorkspaceFallbackMode()).toBe('opfs')
  })
})

describe('getOrCreateOpfsQaWorkspaceHandle', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns an OPFS directory handle with the QA workspace name', async () => {
    const qaDir = { name: 'pixels-qa-workspace', kind: 'directory' } as FileSystemDirectoryHandle
    const getDirectory = vi.fn(async () => ({
      getDirectoryHandle: vi.fn(async () => qaDir),
    }))
    vi.stubGlobal('navigator', { storage: { getDirectory } })

    const handle = await getOrCreateOpfsQaWorkspaceHandle()
    expect(handle).toBe(qaDir)
    expect(isQaOpfsWorkspaceHandle(handle)).toBe(true)
    expect(getDirectory).toHaveBeenCalled()
  })
})
