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

const BRAND_MARK_SRC = '/assets/brand/pixels-mark-icon-256.png'

function PixelsIcon({ className }: { className?: string }) {
  return (
    <img
      src={BRAND_MARK_SRC}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn('shrink-0 object-contain', className)}
    />
  )
}

export function PixelsLogo({ variant = 'full', size = 'md', className }: PixelsLogoProps) {
  const config = sizeConfig[size]

  if (variant === 'icon') {
    return <PixelsIcon className={cn(config.icon, className)} />
  }

  return (
    <div className={cn('flex items-center', config.gap, className)}>
      <PixelsIcon className={config.icon} />
      <span className={cn(config.text, 'font-semibold tracking-tight text-foreground')}>
        Pixels
      </span>
    </div>
  )
}
