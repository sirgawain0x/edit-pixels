import { useTranslation } from 'react-i18next'
import { ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import type { LiveLooksEngineState } from '../engine/live-looks-engine'
import {
  BUNDLED_BACKGROUND_PRESETS,
  type LiveLooksBackgroundMode,
  type LiveLooksSettings,
  type LiveLooksStyleFilter,
} from '../engine/types'

const STYLE_FILTERS: LiveLooksStyleFilter[] = [
  'none',
  'mono',
  'warm',
  'cool',
  'highContrast',
  'comic',
  'vhs',
]

const BACKGROUND_MODES: LiveLooksBackgroundMode[] = [
  'none',
  'blur',
  'solid',
  'preset',
  'custom',
]

interface LiveLooksPopoverPanelProps {
  settings: LiveLooksSettings
  engineState: LiveLooksEngineState
  onSettingsChange: (next: LiveLooksSettings) => void
  onPickCustomImage: () => void
}

export function LiveLooksPopoverPanel({
  settings,
  engineState,
  onSettingsChange,
  onPickCustomImage,
}: LiveLooksPopoverPanelProps) {
  const { t } = useTranslation()

  return (
    <>
      <div className="grid gap-2">
        <Label className="text-xs">{t('liveLooks.background.label')}</Label>
        <Select
          value={settings.background.mode}
          onValueChange={(value) =>
            onSettingsChange({
              ...settings,
              background: { ...settings.background, mode: value as LiveLooksBackgroundMode },
            })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BACKGROUND_MODES.map((mode) => (
              <SelectItem key={mode} value={mode} className="text-xs">
                {t(`liveLooks.background.modes.${mode}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {settings.background.mode === 'blur' && (
          <div className="space-y-1">
            <Label className="text-xs">{t('liveLooks.background.blurAmount')}</Label>
            <Slider
              min={4}
              max={32}
              step={1}
              value={[settings.background.blurRadius]}
              onValueChange={([blurRadius]) =>
                onSettingsChange({
                  ...settings,
                  background: { ...settings.background, blurRadius: blurRadius ?? 16 },
                })
              }
            />
          </div>
        )}

        {settings.background.mode === 'solid' && (
          <input
            type="color"
            className="h-8 w-full cursor-pointer rounded border border-border bg-transparent"
            value={settings.background.solidColor}
            onChange={(event) =>
              onSettingsChange({
                ...settings,
                background: { ...settings.background, solidColor: event.target.value },
              })
            }
            aria-label={t('liveLooks.background.solidColor')}
          />
        )}

        {settings.background.mode === 'preset' && (
          <Select
            value={settings.background.presetId ?? BUNDLED_BACKGROUND_PRESETS[0]?.id ?? 'studio'}
            onValueChange={(presetId) =>
              onSettingsChange({
                ...settings,
                background: { ...settings.background, presetId },
              })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BUNDLED_BACKGROUND_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id} className="text-xs">
                  {t(preset.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {settings.background.mode === 'custom' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1 gap-1 text-xs"
            onClick={onPickCustomImage}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            {t('liveLooks.background.pickImage')}
          </Button>
        )}
      </div>

      <div className="grid gap-2">
        <Label className="text-xs">{t('liveLooks.style.label')}</Label>
        <Select
          value={settings.styleFilter}
          onValueChange={(value) =>
            onSettingsChange({ ...settings, styleFilter: value as LiveLooksStyleFilter })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STYLE_FILTERS.map((filter) => (
              <SelectItem key={filter} value={filter} className="text-xs">
                {t(`liveLooks.style.filters.${filter}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {engineState.backend !== 'none' && (
          <p className="text-[10px] text-muted-foreground">
            {t('liveLooks.style.backend', { backend: engineState.backend })}
          </p>
        )}
      </div>
    </>
  )
}
