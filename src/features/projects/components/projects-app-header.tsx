import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { BookOpen, Github, Menu, Plus, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { PixelsLogo } from '@/components/brand/pixels-logo'
import { DiscordIcon } from '@/components/brand/discord-icon'
import { DISCORD_INVITE_URL, GITHUB_REPO_URL } from '@/config/community'
import { WorkspaceIndicator } from '@/features/projects/deps/workspace-gate'
import { LanguageSwitcher } from '@/shared/ui/language-switcher'
import { WalletConnectButton } from '@/components/wallet-connect-button'
import { cn } from '@/shared/ui/cn'

interface ProjectsAppHeaderProps {
  onImportClick: () => void
  importAvailable: boolean
  walletInitializing: boolean
  requireWalletForNewProject: boolean
  onConnectWallet: () => void
}

function NewProjectButton({
  walletInitializing,
  requireWalletForNewProject,
  onConnectWallet,
  className,
  size = 'lg',
  compact = false,
}: {
  walletInitializing: boolean
  requireWalletForNewProject: boolean
  onConnectWallet: () => void
  className?: string
  size?: 'default' | 'sm' | 'lg'
  compact?: boolean
}) {
  const { t } = useTranslation()
  const label = compact ? (
    <span className="sr-only">{t('projects.newProject')}</span>
  ) : (
    t('projects.newProject')
  )

  if (walletInitializing) {
    return (
      <Button size={size} className={cn('gap-2', className)} disabled aria-label={t('projects.newProject')}>
        <Plus className="w-4 h-4 shrink-0" />
        {label}
      </Button>
    )
  }

  if (requireWalletForNewProject) {
    return (
      <Button
        size={size}
        className={cn('gap-2', className)}
        onClick={onConnectWallet}
        aria-label={t('projects.newProject')}
      >
        <Plus className="w-4 h-4 shrink-0" />
        {label}
      </Button>
    )
  }

  return (
    <Link to="/projects/new">
      <Button size={size} className={cn('gap-2', className)} aria-label={t('projects.newProject')}>
        <Plus className="w-4 h-4 shrink-0" />
        {label}
      </Button>
    </Link>
  )
}

function ImportProjectButton({
  onClick,
  importAvailable,
  className,
  size = 'lg',
  showLabel = true,
}: {
  onClick: () => void
  importAvailable: boolean
  className?: string
  size?: 'default' | 'sm' | 'lg'
  showLabel?: boolean
}) {
  const { t } = useTranslation()
  const tooltip = t('projects.import.unavailable')

  const button = (
    <Button
      variant="outline"
      size={size}
      className={cn('gap-2', className)}
      onClick={importAvailable ? onClick : undefined}
      disabled={!importAvailable}
      aria-disabled={!importAvailable}
    >
      <Upload className="w-4 h-4 shrink-0" />
      {showLabel && t('projects.importProject')}
    </Button>
  )

  if (!importAvailable) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{button}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-center">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    )
  }

  return button
}

function DesktopToolbar({
  onImportClick,
  importAvailable,
  walletInitializing,
  requireWalletForNewProject,
  onConnectWallet,
}: ProjectsAppHeaderProps) {
  const { t } = useTranslation()

  return (
    <div className="hidden md:flex items-center gap-3">
      <LanguageSwitcher size="md" align="end" side="bottom" />

      <Separator orientation="vertical" className="h-6" />

      <Button variant="outline" size="lg" className="gap-2 px-4" asChild>
        <Link to="/docs">
          <BookOpen className="w-4 h-4" />
          Docs
        </Link>
      </Button>
      <Button variant="outline" size="lg" className="gap-2 px-4" asChild>
        <a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">
          <DiscordIcon className="w-4 h-4" />
          Discord
        </a>
      </Button>
      <Button variant="outline" size="lg" className="gap-2 px-4" asChild>
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('projects.viewOnGitHub')}
        >
          <Github className="w-4 h-4" />
          GitHub
        </a>
      </Button>

      <Separator orientation="vertical" className="h-6" />

      <WorkspaceIndicator />
      <WalletConnectButton size="lg" className="h-10 px-4" />
      <ImportProjectButton onClick={onImportClick} importAvailable={importAvailable} />
      <NewProjectButton
        walletInitializing={walletInitializing}
        requireWalletForNewProject={requireWalletForNewProject}
        onConnectWallet={onConnectWallet}
      />
    </div>
  )
}

function MobileToolbar({
  onImportClick,
  importAvailable,
  walletInitializing,
  requireWalletForNewProject,
  onConnectWallet,
}: ProjectsAppHeaderProps) {
  const { t } = useTranslation()

  return (
    <div className="flex md:hidden items-center gap-2 shrink-0">
      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0"
            aria-label={t('projects.header.menu')}
          >
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-[min(100vw,22rem)]">
          <SheetHeader>
            <SheetTitle>{t('projects.header.menu')}</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-2 p-4 pt-0">
            <div className="py-1">
              <LanguageSwitcher size="md" align="start" side="bottom" />
            </div>

            <Button variant="outline" className="h-11 justify-start gap-3 px-4" asChild>
              <Link to="/docs">
                <BookOpen className="w-4 h-4 shrink-0" />
                Docs
              </Link>
            </Button>
            <Button variant="outline" className="h-11 justify-start gap-3 px-4" asChild>
              <a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">
                <DiscordIcon className="w-4 h-4 shrink-0" />
                Discord
              </a>
            </Button>
            <Button variant="outline" className="h-11 justify-start gap-3 px-4" asChild>
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('projects.viewOnGitHub')}
              >
                <Github className="w-4 h-4 shrink-0" />
                GitHub
              </a>
            </Button>

            <Separator />

            <div className="py-1">
              <WorkspaceIndicator />
            </div>

            <ImportProjectButton
              onClick={onImportClick}
              importAvailable={importAvailable}
              className="w-full justify-start px-4 h-11"
            />
          </div>
        </SheetContent>
      </Sheet>

      <WalletConnectButton size="sm" compact className="h-11 shrink-0" />
      <NewProjectButton
        walletInitializing={walletInitializing}
        requireWalletForNewProject={requireWalletForNewProject}
        onConnectWallet={onConnectWallet}
        size="sm"
        compact
        className="h-11 w-11 px-0 shrink-0"
      />
    </div>
  )
}

export function ProjectsAppHeader(props: ProjectsAppHeaderProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="panel-header border-b border-border" data-no-marquee>
        <div className="max-w-[1920px] mx-auto px-4 sm:px-6 py-3 md:py-5 flex items-center justify-between gap-3 min-w-0">
          <Link to="/" className="shrink-0 min-w-0">
            <PixelsLogo
              variant="full"
              size="md"
              className="hover:opacity-80 transition-opacity max-md:[&_span]:hidden"
            />
          </Link>
          <DesktopToolbar {...props} />
          <MobileToolbar {...props} />
        </div>
      </div>
    </TooltipProvider>
  )
}
