import type { DirectorStoryboardShotPayload } from './seedance-client'

const SCENE_HEADER_RE = /^(?:#{1,3}\s*)?(?:shot|scene)\s*(\d+)(?:\s*[—–:-]\s*(.+))?$/i
const DURATION_RE =
  /(?:\((\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?\)|(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)\b|(\d+):(\d{2})(?:–|-)(\d+):(\d{2}))/i
const ASPECT_RE = /\b(16:9|9:16|4:3|3:4|1:1|21:9)\b/
const CONSISTENT_CHARACTER_RE =
  /\b(consistent\s*character|same\s+(hero|character|protagonist)|character\s+consistency)\b/i

// fallow-ignore-next-line complexity
function splitStoryboardSections(markdown: string): string[] {
  const trimmed = markdown.trim()
  if (!trimmed) return []

  const byHeading = trimmed.split(/\n(?=##\s+)/)
  if (byHeading.length > 1) {
    return byHeading.map((section) => section.trim()).filter(Boolean)
  }

  const byShotHeading = trimmed.split(/\n(?=#{1,3}\s*(?:shot|scene)\s+\d+)/i)
  if (byShotHeading.length > 1) {
    return byShotHeading.map((section) => section.trim()).filter(Boolean)
  }

  const sceneLines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) => /^(-|\*)?\s*(shot|scene)\s+\d+/i.test(line) || /^#{1,3}\s*(shot|scene)/i.test(line),
    )

  if (sceneLines.length > 0) {
    const sections: string[] = []
    let current: string[] = []
    for (const line of trimmed.split('\n')) {
      const trimmedLine = line.trim()
      if (
        /^(-|\*)?\s*(shot|scene)\s+\d+/i.test(trimmedLine) ||
        /^#{1,3}\s*(shot|scene)/i.test(trimmedLine)
      ) {
        if (current.length > 0) sections.push(current.join('\n').trim())
        current = [line]
      } else if (current.length > 0) {
        current.push(line)
      }
    }
    if (current.length > 0) sections.push(current.join('\n').trim())
    return sections.filter(Boolean)
  }

  return []
}

function parseTimecodeToSeconds(minutes: string, seconds: string): number {
  return Number.parseInt(minutes, 10) * 60 + Number.parseInt(seconds, 10)
}

function extractTimingHints(section: string): {
  duration?: number
  startSeconds?: number
  endSeconds?: number
} {
  const match = section.match(DURATION_RE)
  if (!match) return {}

  if (match[1]) {
    return { duration: Math.round(Number.parseFloat(match[1])) }
  }
  if (match[2]) {
    return { duration: Math.round(Number.parseFloat(match[2])) }
  }
  if (match[3] && match[4] && match[5] && match[6]) {
    const startSeconds = parseTimecodeToSeconds(match[3], match[4])
    const endSeconds = parseTimecodeToSeconds(match[5], match[6])
    const span = Math.max(1, endSeconds - startSeconds)
    return { startSeconds, endSeconds, duration: span }
  }
  return {}
}

// fallow-ignore-next-line complexity
function extractPrompt(section: string): string {
  const lines = section.split('\n')
  const body: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (SCENE_HEADER_RE.test(trimmed.replace(/^[-*]\s*/, ''))) continue
    if (/^#{1,3}\s/.test(trimmed)) {
      const withoutHash = trimmed.replace(/^#{1,3}\s*/, '')
      if (SCENE_HEADER_RE.test(withoutHash)) continue
    }
    body.push(trimmed.replace(/^[-*]\s+/, ''))
  }

  const joined = body.join(' ').trim()
  if (joined) return joined

  const header =
    lines[0]
      ?.trim()
      .replace(/^#{1,3}\s*/, '')
      .replace(/^[-*]\s*/, '') ?? ''
  const headerMatch = header.match(SCENE_HEADER_RE)
  if (headerMatch?.[2]) return headerMatch[2].trim()
  return header
}

function shotIdFromSection(section: string, index: number): string {
  const firstLine =
    section
      .split('\n')[0]
      ?.trim()
      .replace(/^#{1,3}\s*/, '')
      .replace(/^[-*]\s*/, '') ?? ''
  const match = firstLine.match(SCENE_HEADER_RE)
  if (match?.[1]) return `shot-${match[1]}`
  return `shot-${index + 1}`
}

// ---------------------------------------------------------------------------
// Structured Creative Director scenes (`#### Scene 1: …` + `**visual_prompt**: …`)
// ---------------------------------------------------------------------------

const STRUCTURED_SCENE_HEADING_RE =
  /^\s*(?:#{1,6}\s*)?(?:[-*]\s*)?(?:\*\*)?(?:shot|scene)\s*(\d+)\b(?!_)/i
const MARKDOWN_HEADING_RE = /^\s*#{1,6}\s/
const HORIZONTAL_RULE_RE = /^\s*(?:[-*_]\s*){3,}$/

function readSceneField(section: string, name: string): string | null {
  const re = new RegExp(`\\*{0,2}${name}\\*{0,2}\\s*:\\s*([^|\\n]+)`, 'i')
  const match = section.match(re)
  if (!match?.[1]) return null
  const value = match[1].replace(/`/g, '').replace(/\*\*/g, '').trim()
  return value || null
}

/** `00:15`, `02:28.23`, or `1:02:03` → seconds. */
function parseClockToSeconds(value: string | null): number | undefined {
  if (!value) return undefined
  const parts = value.trim().split(':')
  if (parts.length < 2 || parts.length > 3) return undefined
  const nums = parts.map((part) => Number.parseFloat(part))
  if (nums.some((n) => !Number.isFinite(n))) return undefined
  return nums.reduce((total, n) => total * 60 + n, 0)
}

function stripTrailingPeriod(value: string): string {
  return value.replace(/[.\s]+$/, '')
}

function splitStructuredSceneSections(markdown: string): Array<{ heading: string; body: string }> {
  const sections: Array<{ heading: string; body: string[] }> = []
  let current: { heading: string; body: string[] } | null = null
  for (const line of markdown.split('\n')) {
    if (STRUCTURED_SCENE_HEADING_RE.test(line)) {
      current = { heading: line, body: [] }
      sections.push(current)
      continue
    }
    if (!current) continue
    // A rule or an unrelated heading (e.g. "### Next Step") ends the scene.
    if (HORIZONTAL_RULE_RE.test(line) || MARKDOWN_HEADING_RE.test(line)) {
      current = null
      continue
    }
    current.body.push(line)
  }
  return sections.map((section) => ({ heading: section.heading, body: section.body.join('\n') }))
}

function parseStructuredScenes(markdown: string): DirectorStoryboardShotPayload[] {
  if (!/visual_prompt\**\s*:/i.test(markdown)) return []
  const globalAspect = markdown.match(ASPECT_RE)?.[1]

  return splitStructuredSceneSections(markdown)
    .map(({ heading, body }, index) => {
      const visual = readSceneField(body, 'visual_prompt')
      if (!visual) return null
      const camera = readSceneField(body, 'camera_movement')
      const lighting = readSceneField(body, 'lighting')
      const prompt = [
        stripTrailingPeriod(visual),
        camera ? `Camera movement: ${stripTrailingPeriod(camera)}` : null,
        lighting ? `Lighting: ${stripTrailingPeriod(lighting)}` : null,
      ]
        .filter(Boolean)
        .join('. ')
        .concat('.')

      const sceneIndex =
        readSceneField(body, 'scene_index')?.match(/\d+/)?.[0] ??
        heading.match(STRUCTURED_SCENE_HEADING_RE)?.[1] ??
        String(index + 1)
      const startSeconds = parseClockToSeconds(readSceneField(body, 'timestamp_start'))
      const endSeconds = parseClockToSeconds(readSceneField(body, 'timestamp_end'))
      const durationField = Number.parseFloat(readSceneField(body, 'duration_seconds') ?? '')
      const duration = Number.isFinite(durationField)
        ? Math.max(1, Math.round(durationField))
        : startSeconds !== undefined && endSeconds !== undefined && endSeconds > startSeconds
          ? Math.max(1, Math.round(endSeconds - startSeconds))
          : undefined
      const aspect = body.match(ASPECT_RE)?.[1] ?? globalAspect

      return {
        shotId: `shot-${sceneIndex}`,
        prompt,
        ...(duration !== undefined ? { duration } : {}),
        ...(startSeconds !== undefined ? { startSeconds } : {}),
        ...(endSeconds !== undefined ? { endSeconds } : {}),
        ...(aspect ? { aspectRatio: aspect } : {}),
        ...(CONSISTENT_CHARACTER_RE.test(body) ? { consistentCharacter: true } : {}),
      }
    })
    .filter((shot): shot is DirectorStoryboardShotPayload => shot !== null)
}

/** Parse Director storyboard markdown into batch quote shot payloads. */
export function parseStoryboardShots(markdown: string): DirectorStoryboardShotPayload[] {
  const structured = parseStructuredScenes(markdown)
  if (structured.length > 0) return structured

  const sections = splitStoryboardSections(markdown)
  if (sections.length === 0) return []

  return sections
    .map((section, index) => {
      const prompt = extractPrompt(section)
      if (!prompt) return null

      const aspectMatch = section.match(ASPECT_RE)
      const timing = extractTimingHints(section)

      return {
        shotId: shotIdFromSection(section, index),
        prompt,
        ...(timing.duration !== undefined ? { duration: timing.duration } : {}),
        ...(timing.startSeconds !== undefined ? { startSeconds: timing.startSeconds } : {}),
        ...(timing.endSeconds !== undefined ? { endSeconds: timing.endSeconds } : {}),
        ...(aspectMatch ? { aspectRatio: aspectMatch[1] } : {}),
        ...(CONSISTENT_CHARACTER_RE.test(section) ? { consistentCharacter: true } : {}),
      }
    })
    .filter((shot): shot is DirectorStoryboardShotPayload => shot !== null)
}

export function findStoryboardShotsFromMessages(
  messages: Array<{ role: string; content: string }>,
): DirectorStoryboardShotPayload[] | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== 'assistant') continue
    const shots = parseStoryboardShots(message.content)
    if (shots.length >= 2) return shots
  }
  return null
}
