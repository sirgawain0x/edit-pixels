import { lazy, Suspense } from 'react'
import { Aperture } from 'lucide-react'
import { Button } from '@/components/ui/button'

const LazyLiveLooksPopover = lazy(() =>
  import('./live-looks-popover').then((module) => ({ default: module.LiveLooksPopover })),
)

export function LiveLooksToolbarEntry() {
  return (
    <Suspense
      fallback={
        <Button variant="ghost" size="icon" disabled aria-hidden>
          <Aperture className="h-4 w-4 opacity-40" />
        </Button>
      }
    >
      <LazyLiveLooksPopover />
    </Suspense>
  )
}
