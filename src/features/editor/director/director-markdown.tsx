import { memo, useMemo, type ReactNode } from 'react'
import type { Element } from 'hast'
import type { Root } from 'mdast'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Plugin } from 'unified'
import { useReducedMotion } from 'motion/react'
import { cn } from '@/shared/ui/cn'

const DIRECTOR_STREAMING_CARET_PROP = 'dataDirectorCaret'

type CaretHost = {
  data?: {
    hProperties?: Record<string, unknown>
  }
}

function remarkMarkStreamingCaretHost(): Plugin<[], Root> {
  return (tree: Root): void => {
    let caretHost: CaretHost | null = null

    const walk = (node: { type?: string; children?: unknown[] }, parent: unknown) => {
      if (node.type === 'text') {
        caretHost = parent as CaretHost | null
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          walk(child as { type?: string; children?: unknown[] }, node)
        }
      }
    }

    walk(tree, null)

    if (!caretHost) return

    const host = caretHost as CaretHost
    host.data = host.data ?? {}
    host.data.hProperties = {
      ...host.data.hProperties,
      [DIRECTOR_STREAMING_CARET_PROP]: true,
    }
  }
}

function isStreamingCaretHost(node: Element | undefined): boolean {
  return node?.properties?.[DIRECTOR_STREAMING_CARET_PROP] === true
}

function StreamingCaret({ reduceMotion }: { reduceMotion: boolean | null }) {
  return (
    <span
      className={cn(
        'ml-0.5 inline-block h-3 w-[2px] translate-y-0.5 bg-primary align-middle',
        !reduceMotion && 'animate-pulse',
      )}
      aria-hidden
    />
  )
}

interface DirectorMarkdownProps {
  content: string
  className?: string
  isStreaming?: boolean
}

function createMarkdownComponents(
  isStreaming: boolean,
  reduceMotion: boolean | null,
): Components {
  const caret = (node: Element | undefined, children: ReactNode) => (
    <>
      {children}
      {isStreaming && isStreamingCaretHost(node) && (
        <StreamingCaret reduceMotion={reduceMotion} />
      )}
    </>
  )

  return {
  h1: ({ children, node }) => (
    <h1 className="mt-3 mb-1.5 text-[14px] font-semibold tracking-tight text-foreground">
      {caret(node, children)}
    </h1>
  ),
  h2: ({ children, node }) => (
    <h2 className="mt-2.5 mb-1.5 text-[13px] font-semibold tracking-tight text-foreground">
      {caret(node, children)}
    </h2>
  ),
  h3: ({ children, node }) => (
    <h3 className="mt-2 mb-1 text-[12px] font-semibold tracking-tight text-foreground">
      {caret(node, children)}
    </h3>
  ),
  h4: ({ children, node }) => (
    <h4 className="mt-1.5 mb-0.5 text-[11.5px] font-semibold text-foreground">
      {caret(node, children)}
    </h4>
  ),
  p: ({ children, node }) => (
    <p className="mb-2 last:mb-0 leading-relaxed text-foreground/95">{caret(node, children)}</p>
  ),
  strong: ({ children, node }) => (
    <strong className="font-semibold text-foreground">{caret(node, children)}</strong>
  ),
  em: ({ children, node }) => <em className="italic text-foreground/90">{caret(node, children)}</em>,
  del: ({ children, node }) => (
    <del className="line-through text-muted-foreground">{caret(node, children)}</del>
  ),
  ul: ({ children }) => (
    <ul className="my-1.5 list-disc list-outside pl-4 space-y-1 marker:text-muted-foreground">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1.5 list-decimal list-outside pl-4 space-y-1 marker:text-muted-foreground">
      {children}
    </ol>
  ),
  li: ({ children, node }) => (
    <li className="leading-relaxed text-foreground/95">{caret(node, children)}</li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-primary/60 pl-2.5 italic text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-border/60" />,
  a: ({ href, children, node }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
    >
      {caret(node, children)}
    </a>
  ),
  pre: ({ children }) => (
    <pre className="my-2 max-w-full overflow-x-auto rounded-md border border-border/70 bg-secondary/40 p-2.5 font-mono text-[11px] leading-snug text-foreground/95">
      {children}
    </pre>
  ),
  code: ({ className, children, node, ...props }) => {
    const isMultiline = typeof children === 'string' && children.includes('\n')
    if (!className && !isMultiline) {
      return (
        <code
          className="rounded border border-border/60 bg-secondary/60 px-1 py-0.5 font-mono text-[11px] text-foreground/90"
          {...props}
        >
          {caret(node, children)}
        </code>
      )
    }
    return (
      <code className={cn('font-mono text-[11px]', className)} {...props}>
        {caret(node, children)}
      </code>
    )
  },
  table: ({ children }) => (
    <div className="my-2 max-w-full overflow-x-auto rounded-md border border-border/60 bg-secondary/20 shadow-xs">
      <table className="w-full border-collapse text-left text-[11px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-border/60 bg-secondary/40 font-semibold text-foreground">
      {children}
    </thead>
  ),
  tbody: ({ children }) => <tbody className="divide-y divide-border/30">{children}</tbody>,
  tr: ({ children }) => <tr className="transition-colors hover:bg-secondary/25">{children}</tr>,
  th: ({ children }) => (
    <th className="border-r border-border/40 px-2.5 py-1.5 font-semibold text-foreground whitespace-nowrap last:border-r-0">
      {children}
    </th>
  ),
  td: ({ children, node }) => (
    <td className="border-r border-border/30 px-2.5 py-1.5 align-top text-foreground/90 last:border-r-0">
      {caret(node, children)}
    </td>
  ),
  }
}

export const DirectorMarkdown = memo(function DirectorMarkdown({
  content,
  className,
  isStreaming = false,
}: DirectorMarkdownProps) {
  const reduceMotion = useReducedMotion()
  const components = useMemo(
    () => createMarkdownComponents(isStreaming, reduceMotion),
    [isStreaming, reduceMotion],
  )

  return (
    <div className={cn('min-w-0 break-words text-[12px] leading-relaxed', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMarkStreamingCaretHost]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
