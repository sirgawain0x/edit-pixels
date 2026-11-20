import type { Root } from 'mdast'
import type { Plugin } from 'unified'

type DirectorTextSegment =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string }

interface MdastNodeLike {
  type?: string
  url?: string
  title?: string | null
  value?: string
  children?: unknown[]
}

const URL_CANDIDATE_RE = /(?:https?:\/\/|gs:\/\/)[^\s<>'"`]+/gi
const URL_PRESENCE_RE = /(?:https?:\/\/|gs:\/\/)/i
const GS_URI_RE = /^gs:\/\/([a-z0-9][a-z0-9._-]{1,61}[a-z0-9])\/(.+)$/i
const SIMPLE_TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?'])
const MATCHING_OPENERS: Record<string, string> = {
  ')': '(',
  ']': '[',
  '}': '{',
}

function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0
    )
  } catch {
    return false
  }
}

function resolveGsUri(trimmed: string): string | null {
  const match = GS_URI_RE.exec(trimmed)
  const bucket = match?.[1]
  const objectPath = match?.[2]
  if (!bucket || !objectPath) return null
  const httpsUrl = `https://storage.googleapis.com/${bucket}/${objectPath}`
  return isValidHttpUrl(httpsUrl) ? httpsUrl : null
}

function resolveHttpUrl(trimmed: string): string | null {
  if (!/^https?:\/\//i.test(trimmed)) return null
  return isValidHttpUrl(trimmed) ? trimmed : null
}

/** Validate http(s) URLs and map gs:// URIs to public GCS HTTPS links; reject unsafe schemes. */
function resolveDirectorHref(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  return resolveGsUri(trimmed) ?? resolveHttpUrl(trimmed)
}

function hasUnmatchedClosingBracket(value: string, closer: string): boolean {
  const opener = MATCHING_OPENERS[closer]
  if (!opener) return false

  let opens = 0
  let closes = 0
  for (const ch of value) {
    if (ch === opener) opens += 1
    else if (ch === closer) closes += 1
  }
  return closes > opens
}

function trimTrailingUrlPunctuation(raw: string): string {
  let current = raw
  while (current.length > 0) {
    const last = current[current.length - 1]
    if (last && SIMPLE_TRAILING_PUNCTUATION.has(last)) {
      current = current.slice(0, -1)
      continue
    }
    if (last && hasUnmatchedClosingBracket(current, last)) {
      current = current.slice(0, -1)
      continue
    }
    break
  }
  return current
}

function pushTextSegment(segments: DirectorTextSegment[], text: string): void {
  if (!text) return
  const prev = segments[segments.length - 1]
  if (prev?.type === 'text') {
    prev.text += text
    return
  }
  segments.push({ type: 'text', text })
}

/** Split plain text into alternating text and validated clickable link segments. */
export function splitTextWithDirectorLinks(text: string): DirectorTextSegment[] {
  if (!text) return []
  if (!URL_PRESENCE_RE.test(text)) return [{ type: 'text', text }]

  const segments: DirectorTextSegment[] = []
  let lastIndex = 0
  URL_CANDIDATE_RE.lastIndex = 0

  for (const match of text.matchAll(URL_CANDIDATE_RE)) {
    const matchIndex = match.index ?? 0
    const rawMatch = match[0]
    if (matchIndex > lastIndex) {
      pushTextSegment(segments, text.slice(lastIndex, matchIndex))
    }

    const candidate = trimTrailingUrlPunctuation(rawMatch)
    const trailing = rawMatch.slice(candidate.length)
    const href = resolveDirectorHref(candidate)

    if (href) {
      segments.push({ type: 'link', text: candidate, href })
      pushTextSegment(segments, trailing)
    } else {
      pushTextSegment(segments, rawMatch)
    }

    lastIndex = matchIndex + rawMatch.length
  }

  if (lastIndex < text.length) {
    pushTextSegment(segments, text.slice(lastIndex))
  }

  return segments
}

function linkifyTextNode(node: MdastNodeLike): MdastNodeLike[] | null {
  const value = node.value
  if (typeof value !== 'string' || !URL_PRESENCE_RE.test(value)) {
    return null
  }
  const segments = splitTextWithDirectorLinks(value)
  if (!segments.some((segment) => segment.type === 'link')) {
    return null
  }
  return segments.map((segment) =>
    segment.type === 'link'
      ? {
          type: 'link',
          url: segment.href,
          title: null,
          children: [{ type: 'text', value: segment.text }],
        }
      : { type: 'text', value: segment.text },
  )
}

function linkifyInlineCodeNode(node: MdastNodeLike): MdastNodeLike | null {
  const value = node.value
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || /\s/.test(trimmed)) return null

  const href = resolveDirectorHref(trimmed)
  if (!href) return null

  return {
    type: 'link',
    url: href,
    title: null,
    children: [node],
  }
}

const SKIP_LINKIFY_TYPES = new Set(['linkReference', 'code', 'definition'])

function normalizeExistingLinkNode(node: MdastNodeLike): void {
  if (typeof node.url !== 'string' || !/^gs:\/\//i.test(node.url.trim())) {
    return
  }
  const resolved = resolveDirectorHref(node.url)
  if (resolved) {
    node.url = resolved
  }
}

function transformChildNode(rawChild: unknown): unknown[] {
  const child = rawChild as MdastNodeLike
  if (child.type === 'text') {
    return linkifyTextNode(child) ?? [rawChild]
  }
  if (child.type === 'inlineCode') {
    const wrapped = linkifyInlineCodeNode(child)
    return wrapped ? [wrapped] : [rawChild]
  }
  walkAndLinkify(child)
  return [rawChild]
}

function walkAndLinkify(node: MdastNodeLike): void {
  if (node.type === 'link') {
    normalizeExistingLinkNode(node)
    return
  }
  if ((node.type && SKIP_LINKIFY_TYPES.has(node.type)) || !Array.isArray(node.children)) {
    return
  }
  node.children = node.children.flatMap(transformChildNode)
}

/**
 * Remark plugin (run after remarkGfm) that converts bare http(s)/gs:// URLs
 * and inline-code URLs into clickable links while preventing nested links.
 */
export const remarkLinkifyDirectorUrls: Plugin<[], Root> = () => {
  return (tree: Root) => {
    walkAndLinkify(tree as unknown as MdastNodeLike)
  }
}
