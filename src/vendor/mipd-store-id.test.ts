import { describe, expect, it } from 'vitest'
import { isMipdStoreModule } from './mipd-store-id'

describe('mipd store id', () => {
  it('matches the package store and internal relative imports', () => {
    expect(isMipdStoreModule('mipd/dist/esm/store.js')).toBe(true)
    expect(isMipdStoreModule('/app/node_modules/mipd/dist/esm/store.js')).toBe(true)
    expect(isMipdStoreModule('/app/node_modules/mipd/dist/cjs/store.js')).toBe(true)
    expect(isMipdStoreModule('./store.js', '/app/node_modules/mipd/dist/esm/index.js')).toBe(true)
    expect(isMipdStoreModule('./store.cjs', '/app/node_modules/mipd/dist/cjs/index.js')).toBe(true)
  })

  it('ignores other modules and relative stores imported outside mipd', () => {
    expect(isMipdStoreModule('./store.js', '/app/src/index.js')).toBe(false)
    expect(isMipdStoreModule('mipd/dist/esm/index.js')).toBe(false)
    expect(isMipdStoreModule('./utils.js', '/app/node_modules/mipd/dist/esm/index.js')).toBe(false)
  })
})
