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

  const handleSubmit = async (data: ProjectFormData) => {
    if (requireWallet) {
      promptConnect()
      return
    }

    setIsSubmitting(true)
    try {
      const result = await createProject(data)
      if (result.success && result.project) {
        navigate({
          to: '/editor/$projectId',
          params: { projectId: result.project.id },
        })
        return
      }
      toast.error(t('projects.toasts.createFailed'), { description: result.error })
    } catch (error) {
      logger.error('Failed to create project:', error)
      toast.error(t('projects.toasts.createFailed'), { description: t('projects.tryAgain') })
    }
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
        <InlineCreateProjectForm onSubmit={handleSubmit} isSubmitting={isSubmitting} />
      </div>
    </div>
  )
}
