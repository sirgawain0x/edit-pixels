import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/ui/cn'
import type { PixelsRenderProvider, PixelsRenderQuote } from '@/config/pixels-render'

interface PixelsRenderProviderPickerProps {
  options: PixelsRenderQuote[]
  selected: PixelsRenderProvider | null
  onSelect: (provider: PixelsRenderProvider) => void
  disabled?: boolean
}

export const PixelsRenderProviderPicker = memo(function PixelsRenderProviderPicker({
  options,
  selected,
  onSelect,
  disabled,
}: PixelsRenderProviderPickerProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-foreground">
        {t('seedance.renderProvider', { defaultValue: 'Render provider' })}
      </p>
      <p className="text-[10px] text-muted-foreground">
        {t('seedance.renderProviderHint', {
          defaultValue: 'Planning uses Gemini. Pick which engine renders the video.',
        })}
      </p>
      <div className="space-y-2">
        {options.map((option) => {
          const isSelected = selected === option.provider
          return (
            <button
              key={option.provider}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(option.provider)}
              className={cn(
                'w-full rounded-xl border px-3 py-2.5 text-left transition-colors',
                isSelected
                  ? 'border-primary/50 bg-primary/10 ring-1 ring-primary/30'
                  : 'border-border/70 bg-secondary/15 hover:bg-secondary/30',
                disabled && 'pointer-events-none opacity-60',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-foreground">{option.label}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{option.detail}</p>
                </div>
                <div className="shrink-0 text-right font-mono text-[11px]">
                  <p className="font-semibold text-foreground">
                    {option.crtvaiDisplay.toFixed(option.crtvaiDisplay < 1 ? 3 : 2)} CRTVAI
                  </p>
                  <p className="text-[10px] text-muted-foreground">{option.formattedUsd}</p>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
})
