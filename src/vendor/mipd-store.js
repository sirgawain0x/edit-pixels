// Inlined from mipd's requestProviders. The package export map blocks
// `mipd/dist/esm/utils.js`, and a relative import would still pull the
// unpatched store through index.js.
function requestProviders(listener) {
  if (typeof window === 'undefined') return undefined
  const handler = (event) => listener(event.detail)
  window.addEventListener('eip6963:announceProvider', handler)
  window.dispatchEvent(new CustomEvent('eip6963:requestProvider'))
  return () => window.removeEventListener('eip6963:announceProvider', handler)
}

export function isValidProviderDetail(providerDetail) {
  return Boolean(providerDetail?.info?.uuid)
}

export function hasProviderUuid(providerDetails, uuid) {
  return providerDetails.some((existing) => existing?.info?.uuid === uuid)
}

export function createStore() {
  const listeners = new Set()
  let providerDetails = []
  const request = () =>
    requestProviders((providerDetail) => {
      if (!isValidProviderDetail(providerDetail)) return
      if (hasProviderUuid(providerDetails, providerDetail.info.uuid)) {
        return
      }
      providerDetails = [...providerDetails, providerDetail]
      listeners.forEach((listener) => listener(providerDetails, { added: [providerDetail] }))
    })
  let unwatch = request()
  return {
    _listeners() {
      return listeners
    },
    clear() {
      listeners.forEach((listener) => listener([], { removed: [...providerDetails] }))
      providerDetails = []
    },
    destroy() {
      this.clear()
      listeners.clear()
      unwatch?.()
    },
    findProvider({ rdns }) {
      return providerDetails.find((providerDetail) => providerDetail?.info?.rdns === rdns)
    },
    getProviders() {
      return providerDetails
    },
    reset() {
      this.clear()
      unwatch?.()
      unwatch = request()
    },
    subscribe(listener, { emitImmediately } = {}) {
      listeners.add(listener)
      if (emitImmediately) listener(providerDetails, { added: providerDetails })
      return () => listeners.delete(listener)
    },
  }
}
