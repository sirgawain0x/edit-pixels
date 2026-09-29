import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isFileSystemAccessSupported,
  isLikelyMobileBrowser,
  isLocalWorkspaceFolderAvailable,
} from './handles-db'

describe('handles-db capability probes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('isFileSystemAccessSupported reflects showDirectoryPicker', () => {
    vi.stubGlobal('window', { showDirectoryPicker: vi.fn() })
    expect(isFileSystemAccessSupported()).toBe(true)

    vi.stubGlobal('window', {})
    expect(isFileSystemAccessSupported()).toBe(false)
  })

  it('isLikelyMobileBrowser detects common mobile user agents', () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
      userAgentData: { mobile: true },
    })
    expect(isLikelyMobileBrowser()).toBe(true)
  })

  it('isLikelyMobileBrowser is false for desktop Chrome', () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      platform: 'Win32',
      maxTouchPoints: 0,
      userAgentData: { mobile: false },
    })
    expect(isLikelyMobileBrowser()).toBe(false)
  })

  it('isLocalWorkspaceFolderAvailable requires desktop FS access', () => {
    vi.stubGlobal('window', { showDirectoryPicker: vi.fn() })
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
      userAgentData: { mobile: true },
    })
    expect(isLocalWorkspaceFolderAvailable()).toBe(false)

    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      platform: 'Win32',
      maxTouchPoints: 0,
      userAgentData: { mobile: false },
    })
    expect(isLocalWorkspaceFolderAvailable()).toBe(true)
  })
})
