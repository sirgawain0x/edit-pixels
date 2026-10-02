import { describe, expect, it } from 'vitest'
import { createStore, hasProviderUuid, isValidProviderDetail } from './mipd-store.js'

describe('mipd store patch', () => {
  it('ignores a null wallet announcement', () => {
    expect(isValidProviderDetail(null)).toBe(false)
    expect(isValidProviderDetail({ info: null })).toBe(false)
  })

  it('does not throw when an existing provider detail has no info', () => {
    expect(hasProviderUuid([null, { info: null }], 'abc')).toBe(false)
    expect(hasProviderUuid([{ info: { uuid: 'abc' } }], 'abc')).toBe(true)
  })

  it('drops a null EIP-6963 announcement instead of reading info', () => {
    const store = createStore()
    expect(() => {
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: null }))
    }).not.toThrow()
    expect(store.getProviders()).toEqual([])
    store.destroy()
  })
})
