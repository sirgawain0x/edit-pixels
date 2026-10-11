import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Aperture, ImageIcon, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { LiveLooksEngine, type LiveLooksEngineState } from '../engine/live-looks-engine'
import {
  BUNDLED_BACKGROUND_PRESETS,
  DEFAULT_LIVE_LOOKS_SETTINGS,
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

export function LiveLooksPopover() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<LiveLooksSettings>(DEFAULT_LIVE_LOOKS_SETTINGS)
  const [engineState, setEngineState] = useState<LiveLooksEngineState>({
    active: false,
    backend: 'none',
    error: null,
  })
  const [starting, setStarting] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<LiveLooksEngine | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      engineRef.current?.stop()
      engineRef.current = null
      return
    }

    const engine = new LiveLooksEngine(settings)
    engine.setStateListener(setEngineState)
    engineRef.current = engine
    if (canvasRef.current) {
      engine.attachOutputCanvas(canvasRef.current)
    }

    return () => {
      engine.stop()
      engineRef.current = null
    }
  }, [open])

  useEffect(() => {
    engineRef.current?.updateSettings(settings)
  }, [settings])

  const toggleCamera = useCallback(async () => {
    const engine = engineRef.current
    if (!engine) return
    if (engineState.active) {
      await engine.stop()
      return
    }
    setStarting(true)
    try {
      if (canvasRef.current) engine.attachOutputCanvas(canvasRef.current)
      await engine.start()
    } catch {
      // state listener surfaces error
    } finally {
      setStarting(false)
    }
  }, [engineState.active])

  const onCustomImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    engineRef.current?.setCustomBackgroundFromFile(file)
    setSettings((prev) => ({
      ...prev,
      background: { ...prev.background, mode: 'custom', customImageUrl: file.name },
    }))
    event.target.value = ''
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('liveLooks.toolbarAria')}
          data-tooltip={t('liveLooks.toolbarTooltip')}
          data-tooltip-side="bottom"
        >
          <Aperture className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(100vw-2rem,22rem)] space-y-3 p-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('liveLooks.title')}</p>
          <p className="text-xs text-muted-foreground">{t('liveLooks.subtitle')}</p>
        </div>

        <div className="relative overflow-hidden rounded-md border border-border bg-black/80">
          <canvas ref={canvasRef} className="aspect-video w-full" width={480} height={270} />
          {!engineState.active && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
              {t('liveLooks.previewIdle')}
            </div>
          )}
        </div>

        {engineState.error && (
          <p className="text-xs text-destructive" role="alert">{engineState.error}</p>
        )}

        <div className="grid gap-2">
          <Label className="text-xs">{t('liveLooks.background.label')}</Label>
          <Select
            value={settings.background.mode}
            onValueChange={(value) =>
              setSettings((prev) => ({
                ...prev,
                background: { ...prev.background, mode: value as LiveLooksBackgroundMode },
              }))
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
                  setSettings((prev) => ({
                    ...prev,
                    background: { ...prev.background, blurRadius: blurRadius ?? 16 },
                  }))
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
                setSettings((prev) => ({
                  ...prev,
                  background: { ...prev.background, solidColor: event.target.value },
                }))
              }
              aria-label={t('liveLooks.background.solidColor')}
            />
          )}

          {settings.background.mode === 'preset' && (
            <Select
              value={settings.background.presetId ?? BUNDLED_BACKGROUND_PRESETS[0]?.id ?? 'studio'}
              onValueChange={(presetId) =>
                setSettings((prev) => ({
                  ...prev,
                  background: { ...prev.background, presetId },
                }))
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
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onCustomImage}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1 gap-1 text-xs"
                onClick={() => fileInputRef.current?.click()}
              >
                <ImageIcon className="h-3.5 w-3.5" />
                {t('liveLooks.background.pickImage')}
              </Button>
            </div>
          )}
        </div>

        <div className="grid gap-2">
          <Label className="text-xs">{t('liveLooks.style.label')}</Label>
          <Select
            value={settings.styleFilter}
            onValueChange={(value) =>
              setSettings((prev) => ({ ...prev, styleFilter: value as LiveLooksStyleFilter }))
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

        <Button className="w-full" onClick={toggleCamera} disabled={starting}>
          {starting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('liveLooks.starting')}
            </>
          ) : engineState.active ? (
            t('liveLooks.stopCamera')
          ) : (
            t('liveLooks.startCamera')
          )}
        </Button>

        <p className="text-[10px] leading-snug text-muted-foreground">{t('liveLooks.privacy')}</p>
      </PopoverContent>
    </Popover>
  )
}
