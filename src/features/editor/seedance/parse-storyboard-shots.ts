import type { DirectorStoryboardShotPayload } from './seedance-client'

const SCENE_HEADER_RE =
  /^(?:#{1,3}\s*)?(?:shot|scene)\s*(\d+)(?:\s*[—–:-]\s*(.+))?$/i
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
    .filter((line) => /^(-|\*)?\s*(shot|scene)\s+\d+/i.test(line) || /^#{1,3}\s*(shot|scene)/i.test(line))

  if (sceneLines.length > 0) {
    const sections: string[] = []
    let current: string[] = []
    for (const line of trimmed.split('\n')) {
      const trimmedLine = line.trim()
      if (/^(-|\*)?\s*(shot|scene)\s+\d+/i.test(trimmedLine) || /^#{1,3}\s*(shot|scene)/i.test(trimmedLine)) {
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

function extractDurationSeconds(section: string): number | undefined {
  const match = section.match(DURATION_RE)
  if (!match) return undefined

  if (match[1]) return Math.round(Number.parseFloat(match[1]))
  if (match[2]) return Math.round(Number.parseFloat(match[2]))
  if (match[3] && match[4] && match[5]) {
    const start = Number.parseInt(match[3], 10) * 60 + Number.parseInt(match[4], 10)
    const end = Number.parseInt(match[3], 10) * 60 + Number.parseInt(match[5], 10)
    const span = Math.max(1, end - start)
    return span
  }
  return undefined
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

  const header = lines[0]?.trim().replace(/^#{1,3}\s*/, '').replace(/^[-*]\s*/, '') ?? ''
  const headerMatch = header.match(SCENE_HEADER_RE)
  if (headerMatch?.[2]) return headerMatch[2].trim()
  return header
}

function shotIdFromSection(section: string, index: number): string {
  const firstLine = section.split('\n')[0]?.trim().replace(/^#{1,3}\s*/, '').replace(/^[-*]\s*/, '') ?? ''
  const match = firstLine.match(SCENE_HEADER_RE)
  if (match?.[1]) return `shot-${match[1]}`
  return `shot-${index + 1}`
}

/** Parse Director storyboard markdown into batch quote shot payloads. */
export function parseStoryboardShots(markdown: string): DirectorStoryboardShotPayload[] {
  const sections = splitStoryboardSections(markdown)
  if (sections.length === 0) return []

  return sections
    .map((section, index) => {
      const prompt = extractPrompt(section)
      if (!prompt) return null

      const aspectMatch = section.match(ASPECT_RE)
      const duration = extractDurationSeconds(section)

      return {
        shotId: shotIdFromSection(section, index),
        prompt,
        ...(duration !== undefined ? { duration } : {}),
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
