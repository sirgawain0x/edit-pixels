import { Film, PanelRight, WandSparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useEditorStore } from '@/shared/state/editor'
import { MediaSidebar } from './media-sidebar'
import { PropertiesSidebar } from './properties-sidebar'
import { ErrorBoundary } from '@/app/error-boundary'
import type { EditorViewportMode } from '@/config/editor-layout'

/**
 * Tablet/phone overlay chrome: docked sidebars become sheets so preview stays full-bleed.
 * Phone also exposes a bottom bar that opens Media (incl. AI/Flow/Director) and Properties.
 */
export function EditorOverlayChrome({ mode }: { mode: EditorViewportMode }) {
  const leftSidebarOpen = useEditorStore((s) => s.leftSidebarOpen)
  const rightSidebarOpen = useEditorStore((s) => s.rightSidebarOpen)
  const setLeftSidebarOpen = useEditorStore((s) => s.setLeftSidebarOpen)
  const setRightSidebarOpen = useEditorStore((s) => s.setRightSidebarOpen)
  const setActiveTab = useEditorStore((s) => s.setActiveTab)
  const isPhone = mode === 'phone'

  return (
    <>
      <Sheet open={leftSidebarOpen} onOpenChange={setLeftSidebarOpen}>
        <SheetContent
          side={isPhone ? 'bottom' : 'left'}
          className={isPhone ? 'p-0' : 'w-[min(100vw,22rem)] p-0'}
        >
          <div className="flex h-full min-h-0 flex-col overflow-hidden pt-8">
            <ErrorBoundary level="feature">
              <MediaSidebar />
            </ErrorBoundary>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={rightSidebarOpen} onOpenChange={setRightSidebarOpen}>
        <SheetContent
          side={isPhone ? 'bottom' : 'right'}
          className={isPhone ? 'p-0' : 'w-[min(100vw,22rem)] p-0'}
        >
          <div className="flex h-full min-h-0 flex-col overflow-hidden pt-8">
            <ErrorBoundary level="feature">
              <PropertiesSidebar />
            </ErrorBoundary>
          </div>
        </SheetContent>
      </Sheet>

      {isPhone && (
        <nav
          className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          aria-label="Editor panels"
        >
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border/80 bg-background/95 p-1 shadow-lg backdrop-blur-md">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-10 gap-1.5 rounded-full px-3 text-[11px]"
              onClick={() => {
                setActiveTab('media')
                setLeftSidebarOpen(true)
              }}
            >
              <Film className="h-4 w-4" />
              Media
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-10 gap-1.5 rounded-full px-3 text-[11px]"
              onClick={() => {
                setActiveTab('ai')
                setLeftSidebarOpen(true)
              }}
            >
              <WandSparkles className="h-4 w-4" />
              AI
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-10 gap-1.5 rounded-full px-3 text-[11px]"
              onClick={() => setRightSidebarOpen(true)}
            >
              <PanelRight className="h-4 w-4" />
              Inspect
            </Button>
          </div>
        </nav>
      )}

      {mode === 'tablet' && (
        <div className="pointer-events-none fixed inset-y-0 left-0 z-30 flex flex-col justify-center p-2">
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="pointer-events-auto h-10 w-10 rounded-full shadow-md"
            aria-label="Open media library"
            onClick={() => setLeftSidebarOpen(true)}
          >
            <Film className="h-4 w-4" />
          </Button>
        </div>
      )}

      {mode === 'tablet' && (
        <div className="pointer-events-none fixed inset-y-0 right-0 z-30 flex flex-col justify-center p-2">
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="pointer-events-auto h-10 w-10 rounded-full shadow-md"
            aria-label="Open properties"
            onClick={() => setRightSidebarOpen(true)}
          >
            <PanelRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </>
  )
}
