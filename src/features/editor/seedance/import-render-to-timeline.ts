import { importMediaLibraryService, useMediaLibraryStore } from '@/features/editor/deps/media-library'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { insertGeneratedVideoOnNewTrack } from '../utils/insert-generated-video'

export async function importRenderVideoToTimeline(
  videoUrl: string,
  projectId: string,
  playheadFrame: number,
  tags: string[],
): Promise<{ inserted: boolean; fileName: string }> {
  const response = await fetch(videoUrl)
  if (!response.ok) throw new Error('Failed to download generated video')
  const blob = await response.blob()
  const prefix = tags.includes('seedance') ? 'seedance' : 'pixels-veo'
  const file = new File([blob], `${prefix}-${Date.now()}.mp4`, {
    type: blob.type || 'video/mp4',
  })

  const { mediaLibraryService } = await importMediaLibraryService()
  const media = await mediaLibraryService.importGeneratedVideo(file, projectId, { tags })
  const blobUrl = blobUrlManager.acquire(media.id, file)
  await useMediaLibraryStore.getState().loadMediaItems()

  const inserted = insertGeneratedVideoOnNewTrack(media, blobUrl, playheadFrame)
  return { inserted, fileName: media.fileName }
}
