import { cn } from '@/shared/ui/cn'

interface PixelsLogoProps {
  variant?: 'full' | 'icon'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeConfig = {
  sm: {
    icon: 'w-5 h-5',
    text: 'text-base',
    gap: 'gap-1.5',
  },
  md: {
    icon: 'w-7 h-7',
    text: 'text-xl',
    gap: 'gap-2',
  },
  lg: {
    icon: 'w-10 h-10',
    text: 'text-3xl',
    gap: 'gap-3',
  },
}

function PixelsIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" className={className}>
      <rect x="64" y="64" width="160" height="160" rx="24" fill="currentColor" />
      <rect x="288" y="64" width="160" height="160" rx="24" fill="currentColor" opacity="0.7" />
      <rect x="64" y="288" width="160" height="160" rx="24" fill="currentColor" opacity="0.7" />
      <rect x="288" y="288" width="160" height="160" rx="24" fill="currentColor" />
    </svg>
  )
}

export function PixelsLogo({ variant = 'full', size = 'md', className }: PixelsLogoProps) {
  const config = sizeConfig[size]

  if (variant === 'icon') {
    return <PixelsIcon className={cn(config.icon, 'text-primary', className)} />
  }

  return (
    <div className={cn('flex items-center', config.gap, className)}>
      <PixelsIcon className={cn(config.icon, 'text-primary')} />
      <span className={cn(config.text, 'font-semibold tracking-tight text-foreground')}>
        Pixels
      </span>
    </div>
  )
}
