import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clapperboard, WandSparkles } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { AiPanel } from './ai-panel'
import { DirectorChatPanel } from '../director'

type AiTabMode = 'generate' | 'director'

/**
 * AI sidebar tab: local generation tools (TTS / music) and Creative Director
 * (Vertex Agent Engine SSE). The on-device Gemma assistant stays hidden.
 */
export const AiTab = memo(function AiTab() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<AiTabMode>('generate')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-1 border-b border-border p-1.5">
        <button
          type="button"
          onClick={() => setMode('generate')}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors',
            mode === 'generate'
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:bg-secondary/40 hover:text-foreground',
          )}
        >
          <WandSparkles className="h-3 w-3 opacity-70" />
          {t('director.tab.generate', { defaultValue: 'Generate' })}
        </button>
        <button
          type="button"
          onClick={() => setMode('director')}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors',
            mode === 'director'
              ? 'bg-primary/15 text-primary ring-1 ring-primary/35'
              : 'text-muted-foreground hover:bg-secondary/40 hover:text-foreground',
          )}
        >
          <Clapperboard className="h-3 w-3 opacity-80" strokeWidth={1.75} />
          {t('director.tab.director', { defaultValue: 'Director' })}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === 'generate' ? <AiPanel /> : <DirectorChatPanel />}
      </div>
    </div>
  )
})
