/**
 * Client-side persistence for in-flight Creative Pixels generate jobs.
 * Veo resumes via /api/generate-task; Seedance via /api/pixels-generate-task.
 */

import type { PixelsRenderProvider } from '@/config/pixels-render'
import type { SeedanceResolution } from '@/config/seedance'
import type { SeedanceShotBrief } from './seedance-client'

const STORAGE_KEY = 'pixels:generate:active-job'

export interface PixelsGenerateActiveJob {
  requestId: string
  provider: PixelsRenderProvider
  projectId: string
  playheadFrame: number
  brief: SeedanceShotBrief
  resolution: SeedanceResolution
  /** @deprecated use server quote at confirm time */
  seedanceQuoteId?: string
  veoTaskId?: string
  startedAtMs: number
}

function canUseSessionStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'
}

export function savePixelsGenerateJob(job: PixelsGenerateActiveJob): void {
  if (!canUseSessionStorage()) return
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(job))
  } catch {
    // Quota or privacy mode — generation still works without resume.
  }
}

export function loadPixelsGenerateJob(): PixelsGenerateActiveJob | null {
  if (!canUseSessionStorage()) return null
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PixelsGenerateActiveJob
    if (!parsed?.requestId || !parsed.provider || !parsed.projectId || !parsed.brief) return null
    return parsed
  } catch {
    return null
  }
}

export function clearPixelsGenerateJob(): void {
  if (!canUseSessionStorage()) return
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
