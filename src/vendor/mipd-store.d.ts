export function isValidProviderDetail(providerDetail: unknown): boolean

export function hasProviderUuid(providerDetails: readonly unknown[], uuid: string): boolean

export function createStore(): {
  getProviders(): unknown[]
  destroy(): void
  clear(): void
  reset(): void
  subscribe(
    listener: (providers: unknown[], meta: { added?: unknown[]; removed?: unknown[] }) => void,
    options?: { emitImmediately?: boolean },
  ): () => void
}
