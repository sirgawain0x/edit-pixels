const ABSOLUTE_MIPD_STORE = /(?:^|\/)mipd\/dist\/(?:esm|cjs)\/store\.js$/
const RELATIVE_MIPD_STORE = /^\.\/store\.(?:js|cjs)$/

function slashPath(value: string): string {
  return value.replaceAll('\\', '/')
}

function isRelativeStoreFromMipd(sourcePath: string, importer: string | null | undefined): boolean {
  if (!RELATIVE_MIPD_STORE.test(sourcePath)) return false
  return slashPath(importer ?? '').includes('/mipd/dist/')
}

/** True when Vite should swap mipd's store for the null-safe patch. */
export function isMipdStoreModule(source: string, importer?: string | null): boolean {
  const sourcePath = slashPath(source)
  if (ABSOLUTE_MIPD_STORE.test(sourcePath)) return true
  return isRelativeStoreFromMipd(sourcePath, importer)
}
