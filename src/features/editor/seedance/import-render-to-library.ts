import { importMediaLibraryService } from '@/features/editor/deps/media-library'
import { useMediaLibraryStore } from '@/features/editor/deps/media-library'
import type { PixelsRenderProvider } from '@/config/pixels-render'

const MIN_VIDEO_BYTES = 64 * 1024

/** Download the rendered clip, validating it before the media library ever sees it.
 * A registered-but-undecodable item surfaces as the "thumbnail with blank video"
 * bug, so reject tiny/garbage responses — transient download glitches get one
 * fresh retry before failing the shot. */
async function fetchRenderVideoBlob(videoUrl: string): Promise<Blob> {
  const tooSmall = (b: Blob) => b.size < MIN_VIDEO_BYTES

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await fetch(videoUrl)
    if (!response.ok) {
      throw new Error(`Failed to download generated video (HTTP ${response.status})`)
    }
    const blob = await response.blob()
    if (!tooSmall(blob)) {
      return blob
    }
    if (attempt === 2) {
      throw new Error(
        `Generated video download came back incomplete (${blob.size} bytes) — retry the shot`,
      )
    }
  }
  throw new Error('Failed to download generated video')
}

export async function importRenderVideoToLibrary(
  videoUrl: string,
  projectId: string,
  provider: PixelsRenderProvider,
  shotId?: string,
): Promise<{ fileName: string; mediaId: string }> {
  const blob = await fetchRenderVideoBlob(videoUrl)
  const suffix = shotId ? `-${shotId}` : ''
  const file = new File([blob], `director-batch${suffix}-${Date.now()}.mp4`, {
    type: blob.type || 'video/mp4',
  })
  const tags =
    provider === 'seedance'
      ? ['ai-generated', 'director', 'seedance']
      : provider === 'omni'
        ? ['ai-generated', 'director', 'omni', 'pixels']
        : ['ai-generated', 'director', 'veo', 'pixels']
  const { mediaLibraryService } = await importMediaLibraryService()
  const media = await mediaLibraryService.importGeneratedVideo(file, projectId, { tags })
  await useMediaLibraryStore.getState().loadMediaItems()
  return { fileName: file.name, mediaId: media.id }
}
