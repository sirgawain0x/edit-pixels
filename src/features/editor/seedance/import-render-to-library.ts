import { importMediaLibraryService } from '@/features/editor/deps/media-library'
import { useMediaLibraryStore } from '@/features/editor/deps/media-library'
import type { PixelsRenderProvider } from '@/config/pixels-render'

export async function importRenderVideoToLibrary(
  videoUrl: string,
  projectId: string,
  provider: PixelsRenderProvider,
  shotId?: string,
): Promise<{ fileName: string }> {
  const response = await fetch(videoUrl)
  if (!response.ok) {
    throw new Error('Failed to download generated video')
  }
  const blob = await response.blob()
  const suffix = shotId ? `-${shotId}` : ''
  const file = new File([blob], `director-batch${suffix}-${Date.now()}.mp4`, {
    type: blob.type || 'video/mp4',
  })
  const tags =
    provider === 'seedance'
      ? ['ai-generated', 'director', 'seedance']
      : ['ai-generated', 'director', 'veo', 'pixels']
  const { mediaLibraryService } = await importMediaLibraryService()
  await mediaLibraryService.importGeneratedVideo(file, projectId, { tags })
  await useMediaLibraryStore.getState().loadMediaItems()
  return { fileName: file.name }
}
