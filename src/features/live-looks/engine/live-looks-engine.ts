import type { ImageSegmenter, MPMask } from '@mediapipe/tasks-vision'
import type { LiveLooksRendererBackend, LiveLooksSettings } from './types'
import { loadImageSegmenter } from './segmentation'
import { createStyleFilterPipeline, type StyleFilterPipeline } from './style-filter-pipeline'
import { BUNDLED_BACKGROUND_PRESETS } from './types'

const PREVIEW_WIDTH = 480
const PREVIEW_HEIGHT = 270

export interface LiveLooksEngineState {
  active: boolean
  backend: LiveLooksRendererBackend | 'none'
  error: string | null
}

export class LiveLooksEngine {
  private video: HTMLVideoElement | null = null
  private stream: MediaStream | null = null
  private segmenter: ImageSegmenter | null = null
  private stylePipeline: StyleFilterPipeline | null = null
  private readonly compositeCanvas = document.createElement('canvas')
  private readonly compositeCtx = this.compositeCanvas.getContext('2d', { alpha: false })
  private readonly maskCanvas = document.createElement('canvas')
  private readonly maskCtx = this.maskCanvas.getContext('2d', { alpha: true })
  private readonly maskScratchCanvas = document.createElement('canvas')
  private maskImageData: ImageData | null = null
  private startGeneration = 0
  private readonly personCanvas = document.createElement('canvas')
  private readonly personCtx = this.personCanvas.getContext('2d', { alpha: true })
  private readonly backgroundCanvas = document.createElement('canvas')
  private readonly backgroundCtx = this.backgroundCanvas.getContext('2d', { alpha: false })
  private readonly presetImages = new Map<string, HTMLImageElement>()
  private customBackground: HTMLImageElement | null = null
  private rafId: number | null = null
  private settings: LiveLooksSettings
  private outputCanvas: HTMLCanvasElement | null = null
  private onStateChange: ((state: LiveLooksEngineState) => void) | null = null

  constructor(settings: LiveLooksSettings) {
    this.settings = settings
    this.compositeCanvas.width = PREVIEW_WIDTH
    this.compositeCanvas.height = PREVIEW_HEIGHT
    this.maskCanvas.width = PREVIEW_WIDTH
    this.maskCanvas.height = PREVIEW_HEIGHT
    this.personCanvas.width = PREVIEW_WIDTH
    this.personCanvas.height = PREVIEW_HEIGHT
    this.backgroundCanvas.width = PREVIEW_WIDTH
    this.backgroundCanvas.height = PREVIEW_HEIGHT
  }

  setStateListener(listener: ((state: LiveLooksEngineState) => void) | null): void {
    this.onStateChange = listener
  }

  private emit(partial: Partial<LiveLooksEngineState>): void {
    this.onStateChange?.({
      active: Boolean(this.stream),
      backend: this.stylePipeline?.backend ?? 'none',
      error: null,
      ...partial,
    })
  }

  attachOutputCanvas(canvas: HTMLCanvasElement): void {
    this.outputCanvas = canvas
    canvas.width = PREVIEW_WIDTH
    canvas.height = PREVIEW_HEIGHT
  }

  updateSettings(settings: LiveLooksSettings): void {
    this.settings = settings
  }

  async start(): Promise<void> {
    if (this.stream) return
    if (!this.compositeCtx || !this.maskCtx || !this.personCtx || !this.backgroundCtx) {
      throw new Error('Canvas contexts unavailable')
    }

    const generation = ++this.startGeneration

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      if (generation !== this.startGeneration) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      this.stream = stream
      this.video = document.createElement('video')
      this.video.srcObject = this.stream
      this.video.muted = true
      this.video.playsInline = true
      await this.video.play()
      if (generation !== this.startGeneration) {
        await this.stop()
        return
      }

      this.segmenter = await loadImageSegmenter()
      if (generation !== this.startGeneration) {
        await this.stop()
        return
      }

      this.stylePipeline = await createStyleFilterPipeline(PREVIEW_WIDTH, PREVIEW_HEIGHT)
      if (generation !== this.startGeneration) {
        await this.stop()
        return
      }

      this.emit({ backend: this.stylePipeline.backend, error: null })
      this.loop()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Camera failed to start'
      if (generation === this.startGeneration) {
        await this.stop({ keepError: message })
      }
      throw error
    }
  }

  async stop(options?: { keepError?: string }): Promise<void> {
    this.startGeneration++
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    if (this.video) {
      this.video.srcObject = null
      this.video = null
    }
    this.stylePipeline?.dispose()
    this.stylePipeline = null
    this.segmenter = null
    this.emit({
      active: false,
      backend: 'none',
      error: options?.keepError ?? null,
    })
  }

  setCustomBackgroundFromFile(file: File): void {
    const url = URL.createObjectURL(file)
    if (this.customBackground?.src.startsWith('blob:')) {
      URL.revokeObjectURL(this.customBackground.src)
    }
    const image = new Image()
    image.onload = () => {
      this.customBackground = image
    }
    image.src = url
  }

  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop)
    this.renderFrame()
  }

  private renderFrame(): void {
    const video = this.video
    const segmenter = this.segmenter
    const stylePipeline = this.stylePipeline
    const output = this.outputCanvas
    if (!video || !segmenter || !stylePipeline || !output || !this.compositeCtx) return

    const needsSegmentation = this.settings.background.mode !== 'none'

    if (needsSegmentation) {
      const result = segmenter.segmentForVideo(video, performance.now())
      const mask = result.confidenceMasks?.[0]
      if (mask) {
        this.drawBackground(video)
        this.drawPersonWithMask(video, mask)
        this.compositeCtx.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
        this.compositeCtx.drawImage(this.backgroundCanvas, 0, 0)
        this.compositeCtx.drawImage(this.personCanvas, 0, 0)
        mask.close()
      } else {
        this.compositeCtx.drawImage(video, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
      }
    } else {
      this.compositeCtx.drawImage(video, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
    }

    const filtered = stylePipeline.apply(this.compositeCanvas, this.settings.styleFilter)
    const outCtx = output.getContext('2d')
    if (outCtx) {
      outCtx.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
      outCtx.drawImage(filtered, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
    }
  }

  private drawBackground(video: HTMLVideoElement): void {
    const ctx = this.backgroundCtx
    if (!ctx) return
    const { background } = this.settings
    ctx.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)

    switch (background.mode) {
      case 'none':
        ctx.drawImage(video, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
        break
      case 'blur':
        ctx.filter = `blur(${background.blurRadius}px)`
        ctx.drawImage(video, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
        ctx.filter = 'none'
        break
      case 'solid':
        ctx.fillStyle = background.solidColor
        ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
        break
      case 'preset':
        this.drawPresetBackground(ctx, background.presetId)
        break
      case 'custom':
        if (this.customBackground?.complete) {
          this.drawCoverImage(ctx, this.customBackground)
        } else {
          ctx.fillStyle = '#0f172a'
          ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
        }
        break
      default: {
        const _exhaustive: never = background.mode
        void _exhaustive
        ctx.drawImage(video, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
      }
    }
  }

  private drawPresetBackground(ctx: CanvasRenderingContext2D, presetId: string | null): void {
    const fallback = BUNDLED_BACKGROUND_PRESETS[0]
    if (!fallback) return
    const preset =
      BUNDLED_BACKGROUND_PRESETS.find((p) => p.id === presetId) ?? fallback
    let image = this.presetImages.get(preset.id)
    if (!image) {
      image = new Image()
      image.src = preset.url
      this.presetImages.set(preset.id, image)
    }
    if (image.complete && image.naturalWidth > 0) {
      this.drawCoverImage(ctx, image)
    } else {
      image.onload = () => this.drawCoverImage(ctx, image!)
      ctx.fillStyle = '#0f172a'
      ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
    }
  }

  private drawCoverImage(ctx: CanvasRenderingContext2D, image: CanvasImageSource): void {
    const iw = (image as HTMLImageElement).naturalWidth || PREVIEW_WIDTH
    const ih = (image as HTMLImageElement).naturalHeight || PREVIEW_HEIGHT
    const scale = Math.max(PREVIEW_WIDTH / iw, PREVIEW_HEIGHT / ih)
    const dw = iw * scale
    const dh = ih * scale
    const dx = (PREVIEW_WIDTH - dw) / 2
    const dy = (PREVIEW_HEIGHT - dh) / 2
    ctx.drawImage(image, dx, dy, dw, dh)
  }

  private drawPersonWithMask(video: HTMLVideoElement, mask: MPMask): void {
    const pCtx = this.personCtx
    const mCtx = this.maskCtx
    if (!pCtx || !mCtx) return

    pCtx.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
    pCtx.drawImage(video, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)

    this.paintConfidenceMask(mask)

    pCtx.globalCompositeOperation = 'destination-in'
    pCtx.drawImage(this.maskCanvas, 0, 0)
    pCtx.globalCompositeOperation = 'source-over'
  }

  private paintConfidenceMask(mask: MPMask): void {
    const mCtx = this.maskCtx
    if (!mCtx) return

    const mw = mask.width
    const mh = mask.height
    if (!this.maskImageData || this.maskImageData.width !== mw || this.maskImageData.height !== mh) {
      this.maskImageData = new ImageData(mw, mh)
    }

    const pixels = this.maskImageData.data
    if (mask.hasFloat32Array()) {
      const confidence = mask.getAsFloat32Array()
      for (let i = 0, p = 0; i < confidence.length; i++, p += 4) {
        const value = confidence[i] ?? 0
        pixels[p] = 255
        pixels[p + 1] = 255
        pixels[p + 2] = 255
        pixels[p + 3] = Math.min(255, Math.max(0, Math.round(value * 255)))
      }
    } else {
      const confidence = mask.getAsUint8Array()
      for (let i = 0, p = 0; i < confidence.length; i++, p += 4) {
        const value = confidence[i] ?? 0
        pixels[p] = 255
        pixels[p + 1] = 255
        pixels[p + 2] = 255
        pixels[p + 3] = value
      }
    }

    this.maskScratchCanvas.width = mw
    this.maskScratchCanvas.height = mh
    const scratchCtx = this.maskScratchCanvas.getContext('2d', { alpha: true })
    if (!scratchCtx) return
    scratchCtx.putImageData(this.maskImageData, 0, 0)

    mCtx.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
    mCtx.drawImage(this.maskScratchCanvas, 0, 0, mw, mh, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
  }
}
