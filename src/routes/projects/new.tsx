import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createLogger } from '@/shared/logging/logger'
import { InlineCreateProjectForm } from '@/features/projects/components/project-form'
import { useCreateProject } from '@/features/projects/hooks/use-project-actions'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { PixelsLogo } from '@/components/brand/pixels-logo'
import { Button } from '@/components/ui/button'
import { Github } from 'lucide-react'
import { DiscordIcon } from '@/components/brand/discord-icon'
import { DISCORD_INVITE_URL, GITHUB_REPO_URL } from '@/config/community'
import type { ProjectFormData } from '@/features/projects/utils/validation'
import { WalletConnectButton } from '@/components/wallet-connect-button'
import { useWalletContext } from '@/context/wallet-context'
import { isLocalWorkspaceFolderAvailable } from '@/features/projects/deps/storage-contract'
import { runCreatePreflight, getCreateFailureDescription, getCreatedProjectId } from '@/features/projects/utils/create-project-flow'

const logger = createLogger('NewProject')

export const Route = createFileRoute('/projects/new')({
  component: NewProject,
  beforeLoad: async () => {
    try {
      const { loadProjects } = useProjectStore.getState()
      await loadProjects()
    } catch (err) {
      logger.warn('Failed to pre-load projects in beforeLoad:', err)
    }
  },
})

function useWalletCreateGate() {
  const { configured, ready, authenticated, wallet, connect } = useWalletContext()
  const requireWallet = configured && ready && !(authenticated && wallet)

  const promptConnect = () => {
    toast.message('Connect your wallet to continue', {
      description: 'Wallet connection is required before creating a project.',
    })
    connect()
  }

  return { requireWallet, promptConnect }
}

function NewProject() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const createProject = useCreateProject()
  const { requireWallet, promptConnect } = useWalletCreateGate()
  const createAvailable = isLocalWorkspaceFolderAvailable()

  const handleSubmit = async (data: ProjectFormData) => {
    if (!runCreatePreflight({ requireWallet, createAvailable, promptConnect, t })) return

    setIsSubmitting(true)
    const result = await createProject(data)
    const projectId = getCreatedProjectId(result)
    if (projectId) {
      navigate({ to: '/editor/$projectId', params: { projectId } })
      return
    }

    toast.error(t('projects.toasts.createFailed'), {
      description: getCreateFailureDescription(result.error, t),
    })
    setIsSubmitting(false)
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="panel-header border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link to="/">
            <PixelsLogo variant="full" size="md" className="hover:opacity-80 transition-opacity" />
          </Link>
          <div className="flex items-center gap-3">
            <WalletConnectButton size="lg" className="h-10 px-4" />
            <Button variant="outline" size="lg" className="gap-2" asChild>
              <a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">
                <DiscordIcon className="w-4 h-4" />
                Discord
              </a>
            </Button>
            <Button variant="outline" size="icon" className="h-10 w-10" asChild>
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                data-tooltip={t('projects.viewOnGitHub')}
                data-tooltip-side="left"
              >
                <Github className="w-5 h-5" />
              </a>
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {requireWallet ? (
          <div className="mb-6 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Connect your wallet to create a project and use AI features.
          </div>
        ) : null}
        {!createAvailable ? (
          <div
            className="mb-6 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground"
            role="status"
          >
            {t('projects.create.unavailable')}
          </div>
        ) : null}
        <InlineCreateProjectForm
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          submitDisabled={!createAvailable}
        />
      </div>
    </div>
  )
}
