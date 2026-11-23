/**
 * Persist a merged cloud transcript so the rest of the app can use it.
 *
 * Thin on purpose: `saveTranscript` already owns the envelope format, the legacy-path
 * migration and the workspace layout, so this only builds the flat {@link MediaTranscript}
 * record from a merge result. Keeping the write behind one seam is also what lets the
 * caller be tested without a workspace.
 */
import type {
  MediaTranscript,
  MediaTranscriptModel,
  MediaTranscriptQuantization,
} from '@/types/storage'
import { saveTranscript } from '@/infrastructure/storage/workspace-fs/transcripts'
import type { MergedCloudTranscript } from './merge-part-transcripts'

/**
 * Cloud models do not quantize, but the record shape requires a value. `hybrid` is the
 * existing "not applicable" choice for models the on-device quantizer never touched.
 */
const CLOUD_QUANTIZATION: MediaTranscriptQuantization = 'hybrid'

export interface SaveCloudTranscriptInput {
  mediaId: string
  merged: MergedCloudTranscript
  /** The model that actually produced this text, recorded for cache invalidation. */
  model: MediaTranscriptModel
  language?: string
  now?: () => number
  /** Injectable for tests; defaults to the workspace-backed save. */
  save?: (transcript: MediaTranscript) => Promise<MediaTranscript>
}

export async function saveCloudTranscript(
  input: SaveCloudTranscriptInput,
): Promise<MediaTranscript> {
  const timestamp = (input.now ?? Date.now)()

  return (input.save ?? saveTranscript)({
    id: input.mediaId,
    mediaId: input.mediaId,
    model: input.model,
    ...(input.language ? { language: input.language } : {}),
    quantization: CLOUD_QUANTIZATION,
    text: input.merged.text,
    segments: input.merged.segments,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}
