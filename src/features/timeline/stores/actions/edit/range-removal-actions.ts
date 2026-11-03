import type { TimelineItem } from '@/types/timeline'
import { useItemsStore } from '../../items-store'
import { useTransitionsStore } from '../../transitions-store'
import { useKeyframesStore } from '../../keyframes-store'
import { useTimelineSettingsStore } from '../../timeline-settings-store'
import { execute, applyTransitionRepairs } from '../shared'
import { expandIdsWithLinkedItems, getLinkedItemsForEdit } from '../linked-edit'
import {
  sourceSecondsToTimelineFrame,
  getItemSourceSpanSeconds,
} from '../../../utils/media-item-frames'
import { getUniqueLinkedItemAnchorIds } from '../../../utils/linked-items'
import { isTrackSyncLockEnabled } from '../../../utils/track-sync-lock'
import { propagateRemovedIntervalsToSyncLockedTracks } from '../sync-lock-ripple'
import { applySplitBookkeeping, type SplitResultEntry } from '../split-bookkeeping'
import {
  isLinkedSelectionEnabled,
  isInTransitionOverlap,
  requestPostEditWarmForItems,
} from './shared'

export interface RemoveSilenceRange {
  start: number
  end: number
}

export interface RemoveSilenceResult {
  analyzedItemCount: number
  removedRangeCount: number
  removedItemCount: number
  splitCount: number
}

/**
 * Why a committed range did not leave the timeline. Surfaced to the user so a
 * failed delete is retryable instead of silent — see `skipped` below.
 */
export type TranscriptRemovalSkipReason =
  /** No clip of that media is on the timeline right now. */
  | 'no-timeline-clip'
  /** The range maps to frames at or outside the clip's in/out, so there is nothing to split. */
  | 'clip-edge'
  /** A boundary frame landed inside a transition overlap, where splits are not allowed. */
  | 'transition-overlap'
  /** A linked partner could not split with the anchor, so the whole split was aborted. */
  | 'linked-split-failed'
  /** The piece could not be isolated to the coverage threshold and kept its speech. */
  | 'coverage'

export interface SkippedRange {
  mediaId: string
  range: RemoveSilenceRange
  reason: TranscriptRemovalSkipReason
}

export interface TranscriptRemovalResult extends RemoveSilenceResult {
  /** Ranges that actually left the timeline, keyed by mediaId. */
  landedRangesByMediaId: Record<string, RemoveSilenceRange[]>
  /**
   * Ranges that were committed but did not land, with the reason. Callers must
   * keep these ranges staged so the user can retry rather than re-mark them.
   * Invariant: landed + skipped === every committed range.
   */
  skipped: SkippedRange[]
}

// A post-split segment is removed when at least this fraction of its source-time
// span is covered by detected silence. The threshold guards two cases:
//   1. Frames that couldn't be split cleanly (e.g. inside a transition overlap)
//      leave a partial segment whose start/end still bracket loud audio — we
//      keep those so users don't lose speech to the silence cutter.
//   2. Floating-point rounding when converting source seconds → timeline frames
//      can leave a few frames of audible content on either side of a "fully
//      silent" segment — 0.75 is permissive enough to remove those anyway.
const SILENCE_COVERAGE_REMOVAL_THRESHOLD = 0.75

function isMostlyInsideRanges(
  span: { start: number; end: number },
  ranges: readonly RemoveSilenceRange[],
): boolean {
  const duration = span.end - span.start
  if (duration <= 0) return false

  const covered = ranges.reduce((sum, range) => {
    const overlapStart = Math.max(span.start, range.start)
    const overlapEnd = Math.min(span.end, range.end)
    return sum + Math.max(0, overlapEnd - overlapStart)
  }, 0)

  return covered / duration >= SILENCE_COVERAGE_REMOVAL_THRESHOLD
}

function applyRippleRemoval(ids: string[]): { removedIds: string[]; affectedIds: string[] } {
  const items = useItemsStore.getState().items
  const linkedSelectionEnabled = isLinkedSelectionEnabled()
  const expandedIds = expandIdsWithLinkedItems(items, ids, linkedSelectionEnabled)
  if (expandedIds.length === 0) return { removedIds: [], affectedIds: [] }

  const idsToDelete = new Set(expandedIds)
  const remainingItems = items.filter((item) => !idsToDelete.has(item.id))
  const baseShiftByItemId = new Map<string, number>()
  const editedTrackIds = new Set(
    items.filter((item) => idsToDelete.has(item.id)).map((item) => item.trackId),
  )
  const removedIntervals = items
    .filter((item) => idsToDelete.has(item.id))
    .map((item) => ({
      start: item.from,
      end: item.from + item.durationInFrames,
    }))

  for (const item of remainingItems) {
    const shiftAmount = items
      .filter((candidate) => idsToDelete.has(candidate.id))
      .filter(
        (deletedItem) =>
          deletedItem.trackId === item.trackId &&
          deletedItem.from + deletedItem.durationInFrames <= item.from,
      )
      .reduce((sum, deletedItem) => sum + deletedItem.durationInFrames, 0)

    if (shiftAmount > 0) {
      baseShiftByItemId.set(item.id, shiftAmount)
    }
  }

  const trackById = new Map(useItemsStore.getState().tracks.map((track) => [track.id, track]))
  const itemById = new Map(remainingItems.map((item) => [item.id, item]))
  const shiftByItemId = new Map<string, number>()

  for (const [itemId, shiftAmount] of baseShiftByItemId) {
    if (shiftAmount <= 0) continue

    const relatedIds = expandIdsWithLinkedItems(remainingItems, [itemId], linkedSelectionEnabled)
    for (const relatedId of relatedIds) {
      const relatedItem = itemById.get(relatedId)
      if (!relatedItem) continue

      const handledBySyncLock =
        !editedTrackIds.has(relatedItem.trackId) &&
        isTrackSyncLockEnabled(trackById.get(relatedItem.trackId))
      if (handledBySyncLock) continue

      shiftByItemId.set(relatedId, Math.max(shiftByItemId.get(relatedId) ?? 0, shiftAmount))
    }
  }

  const updates = remainingItems.flatMap((item) => {
    const shiftAmount = shiftByItemId.get(item.id) ?? 0
    return shiftAmount > 0 ? [{ id: item.id, from: item.from - shiftAmount }] : []
  })

  const shiftedById = new Map(updates.map((update) => [update.id, update.from]))
  const coveredIds: string[] = []
  for (const item of remainingItems) {
    if (shiftedById.has(item.id)) continue
    const itemEnd = item.from + item.durationInFrames
    for (const other of remainingItems) {
      const newFrom = shiftedById.get(other.id)
      if (newFrom === undefined || other.trackId !== item.trackId) continue
      const newEnd = newFrom + other.durationInFrames
      if (newFrom < itemEnd && newEnd > item.from) {
        coveredIds.push(item.id)
        break
      }
    }
  }

  const expandedCoveredIds = expandIdsWithLinkedItems(
    remainingItems,
    coveredIds,
    linkedSelectionEnabled,
  )
  const allRemoveIds = [...expandedIds, ...expandedCoveredIds]
  const coveredSet = new Set(expandedCoveredIds)
  const filteredUpdates =
    coveredSet.size > 0 ? updates.filter((update) => !coveredSet.has(update.id)) : updates

  const store = useItemsStore.getState()
  store._removeItems(allRemoveIds)
  if (filteredUpdates.length > 0) {
    store._moveItems(filteredUpdates)
  }

  const syncLockResult = propagateRemovedIntervalsToSyncLockedTracks({
    editedTrackIds,
    intervals: removedIntervals,
  })

  const cascadedRemoveIds = Array.from(new Set([...allRemoveIds, ...syncLockResult.removedIds]))
  useTransitionsStore.getState()._removeTransitionsForItems(cascadedRemoveIds)
  useKeyframesStore.getState()._removeKeyframesForItems(cascadedRemoveIds)

  if (filteredUpdates.length > 0) {
    applyTransitionRepairs(filteredUpdates.map((update) => update.id))
  }

  const repairedClipIds = Array.from(
    new Set([...updates.map((update) => update.id), ...syncLockResult.affectedIds]),
  )
  if (repairedClipIds.length > 0) {
    applyTransitionRepairs(repairedClipIds, new Set(cascadedRemoveIds))
  }

  return {
    removedIds: cascadedRemoveIds,
    affectedIds: Array.from(new Set([...repairedClipIds, ...filteredUpdates.map((u) => u.id)])),
  }
}

export function removeSilenceFromItems(
  itemIds: string[],
  silenceRangesByMediaId: Record<string, RemoveSilenceRange[]>,
): RemoveSilenceResult {
  const { analyzedItemCount, removedRangeCount, removedItemCount, splitCount } =
    removeTimelineRangesFromItems('REMOVE_SILENCE', itemIds, silenceRangesByMediaId)
  return { analyzedItemCount, removedRangeCount, removedItemCount, splitCount }
}

export function removeFillerWordsFromItems(
  itemIds: string[],
  fillerRangesByMediaId: Record<string, RemoveSilenceRange[]>,
): RemoveSilenceResult {
  const { analyzedItemCount, removedRangeCount, removedItemCount, splitCount } =
    removeTimelineRangesFromItems('REMOVE_FILLER_WORDS', itemIds, fillerRangesByMediaId)
  return { analyzedItemCount, removedRangeCount, removedItemCount, splitCount }
}

/**
 * Remove the source-time ranges a user selected in the transcript editor.
 * Ranges are in source-native seconds, keyed by mediaId — the same shape the
 * silence/filler removers use — so this reuses the split-then-ripple machinery
 * and lands as a single "remove transcript selection" undo step.
 *
 * Unlike the silence/filler variants this reports per-range outcome: which
 * ranges actually left the timeline and, for the ones that did not, why. The
 * caller keeps the skipped ranges staged so a failed delete is retryable
 * instead of silently losing the user's review state.
 */
export function removeTranscriptRangesFromItems(
  itemIds: string[],
  rangesByMediaId: Record<string, RemoveSilenceRange[]>,
): TranscriptRemovalResult {
  return removeTimelineRangesFromItems('REMOVE_TRANSCRIPT_SELECTION', itemIds, rangesByMediaId)
}

/** A committed range counts as landed once this much of it left the timeline. */
const RANGE_LANDED_COVERAGE = 0.9

// When a range fails for more than one reason, report the most actionable one.
const SKIP_REASON_PRIORITY: Record<TranscriptRemovalSkipReason, number> = {
  'no-timeline-clip': 0,
  coverage: 1,
  'clip-edge': 2,
  'linked-split-failed': 3,
  'transition-overlap': 4,
}

interface CommittedRange {
  mediaId: string
  range: RemoveSilenceRange
  key: string
}

function collectCommittedRanges(
  rangesByMediaId: Record<string, RemoveSilenceRange[]>,
): CommittedRange[] {
  return Object.entries(rangesByMediaId).flatMap(([mediaId, ranges]) =>
    ranges.map((range, index) => ({ mediaId, range, key: `${mediaId}:${index}` })),
  )
}

/** Merge overlapping spans so coverage is never double-counted. */
function unionSpans(spans: readonly RemoveSilenceRange[]): RemoveSilenceRange[] {
  const sorted = [...spans].toSorted((left, right) => left.start - right.start)
  const merged: RemoveSilenceRange[] = []
  for (const span of sorted) {
    const last = merged.at(-1)
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end)
      continue
    }
    merged.push({ start: span.start, end: span.end })
  }
  return merged
}

function overlapSeconds(spans: readonly RemoveSilenceRange[], range: RemoveSilenceRange): number {
  return spans.reduce((sum, span) => {
    const overlapStart = Math.max(range.start, span.start)
    const overlapEnd = Math.min(range.end, span.end)
    return sum + Math.max(0, overlapEnd - overlapStart)
  }, 0)
}

function removeTimelineRangesFromItems(
  commandType: 'REMOVE_SILENCE' | 'REMOVE_FILLER_WORDS' | 'REMOVE_TRANSCRIPT_SELECTION',
  itemIds: string[],
  rangesByMediaId: Record<string, RemoveSilenceRange[]>,
): TranscriptRemovalResult {
  const committed = collectCommittedRanges(rangesByMediaId)

  const allSkipped = (reason: TranscriptRemovalSkipReason): SkippedRange[] =>
    committed.map((entry) => ({ mediaId: entry.mediaId, range: entry.range, reason }))

  if (itemIds.length === 0) {
    return {
      analyzedItemCount: 0,
      removedRangeCount: 0,
      removedItemCount: 0,
      splitCount: 0,
      landedRangesByMediaId: {},
      skipped: allSkipped('no-timeline-clip'),
    }
  }

  return execute(
    commandType,
    () => {
      const timelineFps = useTimelineSettingsStore.getState().fps
      const initialItems = useItemsStore.getState().items
      const anchorIds = getUniqueLinkedItemAnchorIds(initialItems, itemIds)
      const anchors = anchorIds
        .map((id) => initialItems.find((item) => item.id === id))
        .filter(
          (item): item is TimelineItem =>
            item !== undefined &&
            (item.type === 'video' || item.type === 'audio') &&
            !!item.mediaId &&
            (rangesByMediaId[item.mediaId]?.length ?? 0) > 0,
        )

      if (anchors.length === 0) {
        return {
          analyzedItemCount: 0,
          removedRangeCount: 0,
          removedItemCount: 0,
          splitCount: 0,
          landedRangesByMediaId: {},
          skipped: allSkipped('no-timeline-clip'),
        }
      }

      const anchorDescriptors = anchors.map((item) => ({
        id: item.id,
        mediaId: item.mediaId!,
        originId: item.originId ?? item.id,
      }))
      const anchoredMediaIds = new Set(anchorDescriptors.map((entry) => entry.mediaId))

      // Attribute every failed split back to the committed range that produced it,
      // so a range that survives can say why instead of vanishing.
      const failures = new Map<string, TranscriptRemovalSkipReason>()
      const noteFailure = (key: string, reason: TranscriptRemovalSkipReason) => {
        const current = failures.get(key)
        if (current && SKIP_REASON_PRIORITY[current] >= SKIP_REASON_PRIORITY[reason]) return
        failures.set(key, reason)
      }

      let splitCount = 0
      for (const anchor of anchors) {
        const mediaId = anchor.mediaId!
        const ranges = rangesByMediaId[mediaId] ?? []
        if (ranges.length === 0) continue

        // One attempt per distinct boundary frame, remembering which range owns it.
        const attemptByFrame = new Map<number, { frame: number; key: string }>()
        ranges.forEach((range, index) => {
          const key = `${mediaId}:${index}`
          for (const seconds of [range.start, range.end]) {
            const frame = sourceSecondsToTimelineFrame(anchor, seconds, timelineFps)
            if (!attemptByFrame.has(frame)) attemptByFrame.set(frame, { frame, key })
          }
        })

        const clipEnd = anchor.from + anchor.durationInFrames
        let splitAborted = false

        for (const attempt of Array.from(attemptByFrame.values()).toSorted(
          (left, right) => right.frame - left.frame,
        )) {
          if (splitAborted) {
            noteFailure(attempt.key, 'linked-split-failed')
            continue
          }

          // Frames on the clip's in/out are not split points: whatever sits on the
          // far side of them is removed whole by the coverage pass, or not at all.
          if (attempt.frame <= anchor.from || attempt.frame >= clipEnd) {
            noteFailure(attempt.key, 'clip-edge')
            continue
          }

          // Re-resolved per attempt: a split replaces the right-hand piece with a
          // new id, so a snapshot taken before the first split goes stale.
          const itemsToSplit = getLinkedItemsForEdit(
            useItemsStore.getState().items,
            anchor.id,
            isLinkedSelectionEnabled(),
          )
          if (itemsToSplit.length === 0) {
            noteFailure(attempt.key, 'linked-split-failed')
            continue
          }

          const currentItemsById = useItemsStore.getState().itemById
          const blockingReason = itemsToSplit.reduce<TranscriptRemovalSkipReason | null>(
            (reason, item) => {
              if (reason) return reason
              const currentItem = currentItemsById[item.id]
              if (!currentItem) return 'linked-split-failed'
              if (
                attempt.frame <= currentItem.from ||
                attempt.frame >= currentItem.from + currentItem.durationInFrames
              ) {
                return 'clip-edge'
              }
              const relativeFrame = attempt.frame - currentItem.from
              return isInTransitionOverlap(
                currentItem.id,
                relativeFrame,
                currentItem.durationInFrames,
              )
                ? 'transition-overlap'
                : null
            },
            null,
          )
          if (blockingReason) {
            noteFailure(attempt.key, blockingReason)
            continue
          }

          const frameSplitResults = itemsToSplit
            .map((item) => ({
              originalId: item.id,
              originalLinkedGroupId: item.linkedGroupId,
              result: useItemsStore.getState()._splitItem(item.id, attempt.frame),
            }))
            .filter((entry): entry is SplitResultEntry => entry.result !== null)

          if (frameSplitResults.length !== itemsToSplit.length) {
            noteFailure(attempt.key, 'linked-split-failed')
            splitAborted = true
            continue
          }

          applySplitBookkeeping(frameSplitResults)
          splitCount += 1

          for (const entry of frameSplitResults) {
            applyTransitionRepairs([entry.result.leftItem.id, entry.result.rightItem.id])
          }
        }
      }

      const currentItems = useItemsStore.getState().items
      const idsToRemove = new Set<string>()
      const removedSpansByMedia = new Map<string, RemoveSilenceRange[]>()

      for (const descriptor of anchorDescriptors) {
        const ranges = rangesByMediaId[descriptor.mediaId]
        if (!ranges || ranges.length === 0) continue

        for (const candidate of currentItems) {
          if (candidate.type !== 'video' && candidate.type !== 'audio') continue
          if (candidate.mediaId !== descriptor.mediaId) continue
          if ((candidate.originId ?? candidate.id) !== descriptor.originId) continue

          const span = getItemSourceSpanSeconds(candidate, timelineFps)
          if (span !== null && isMostlyInsideRanges(span, ranges)) {
            idsToRemove.add(candidate.id)
            const spans = removedSpansByMedia.get(descriptor.mediaId) ?? []
            spans.push({ start: span.start, end: span.end })
            removedSpansByMedia.set(descriptor.mediaId, spans)
          }
        }
      }

      const landedRangesByMediaId: Record<string, RemoveSilenceRange[]> = {}
      const skipped: SkippedRange[] = []
      for (const entry of committed) {
        const duration = entry.range.end - entry.range.start
        const covered = overlapSeconds(
          unionSpans(removedSpansByMedia.get(entry.mediaId) ?? []),
          entry.range,
        )
        if (duration > 0 && covered / duration >= RANGE_LANDED_COVERAGE) {
          ;(landedRangesByMediaId[entry.mediaId] ??= []).push(entry.range)
          continue
        }
        skipped.push({
          mediaId: entry.mediaId,
          range: entry.range,
          reason: anchoredMediaIds.has(entry.mediaId)
            ? (failures.get(entry.key) ?? 'coverage')
            : 'no-timeline-clip',
        })
      }

      const landedCount = Object.values(landedRangesByMediaId).reduce(
        (sum, ranges) => sum + ranges.length,
        0,
      )

      if (idsToRemove.size === 0) {
        return {
          analyzedItemCount: anchors.length,
          removedRangeCount: landedCount,
          removedItemCount: 0,
          splitCount,
          landedRangesByMediaId,
          skipped,
        }
      }

      const removalResult = applyRippleRemoval(Array.from(idsToRemove))
      const affectedIds = Array.from(new Set([...idsToRemove, ...removalResult.affectedIds]))
      requestPostEditWarmForItems(affectedIds)
      useTimelineSettingsStore.getState().markDirty()

      return {
        analyzedItemCount: anchors.length,
        removedRangeCount: landedCount,
        removedItemCount: removalResult.removedIds.length,
        splitCount,
        landedRangesByMediaId,
        skipped,
      }
    },
    { itemIds, mediaCount: Object.keys(rangesByMediaId).length },
  )
}
