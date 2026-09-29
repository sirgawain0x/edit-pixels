import { toast } from 'sonner'

export function runCreatePreflight(options: {
  requireWallet: boolean
  createAvailable: boolean
  promptConnect: () => void
  t: (key: string) => string
}): boolean {
  if (options.requireWallet) {
    options.promptConnect()
    return false
  }
  if (!options.createAvailable) {
    toast.error(options.t('projects.toasts.createFailed'), {
      description: options.t('projects.create.unavailable'),
    })
    return false
  }
  return true
}

export type NewProjectButtonMode = 'initializing' | 'wallet' | 'unavailable' | 'ready'

export function getNewProjectButtonMode(options: {
  walletInitializing: boolean
  requireWalletForNewProject: boolean
  createAvailable: boolean
}): NewProjectButtonMode {
  if (options.walletInitializing) return 'initializing'
  if (options.requireWalletForNewProject) return 'wallet'
  if (!options.createAvailable) return 'unavailable'
  return 'ready'
}

export function getCreateFailureDescription(
  error: string | null | undefined,
  t: (key: string) => string,
): string {
  return error || t('projects.tryAgain')
}

export function getCreatedProjectId(result: {
  success: boolean
  project: { id: string } | null
}): string | null {
  if (!result.success || !result.project) return null
  return result.project.id
}
