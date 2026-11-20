import { render } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { DirectorMarkdown } from './director-markdown'

describe('DirectorMarkdown', () => {
  it('renders headings and bold text', () => {
    const markdown = '### **Batch Render Quote Summary**\nSome introductory text.'
    const { container, getByRole, getByText } = render(<DirectorMarkdown content={markdown} />)

    const heading = getByRole('heading', { level: 3 })
    expect(heading).toBeInTheDocument()
    expect(heading).toHaveTextContent('Batch Render Quote Summary')

    const bold = container.querySelector('strong')
    expect(bold).toBeInTheDocument()
    expect(bold).toHaveTextContent('Batch Render Quote Summary')

    expect(getByText('Some introductory text.')).toBeInTheDocument()
  })

  it('renders markdown lists and inline code badges', () => {
    const markdown = '* **Batch Quote ID:** `9adf4046`\n* **Aspect Ratio:** 16:9'
    const { container, getByText } = render(<DirectorMarkdown content={markdown} />)

    const list = container.querySelector('ul')
    expect(list).toBeInTheDocument()

    const listItems = container.querySelectorAll('li')
    expect(listItems).toHaveLength(2)

    const code = container.querySelector('code')
    expect(code).toBeInTheDocument()
    expect(code).toHaveTextContent('9adf4046')
    expect(getByText(/Aspect Ratio:/)).toBeInTheDocument()
  })

  it('renders GFM markdown tables', () => {
    const markdown = `| Scene | Timestamp | Duration |
| --- | --- | --- |
| 1 | 00:00:00 | 4s |
| 2 | 00:00:04 | 5s |`

    const { container, getAllByRole } = render(<DirectorMarkdown content={markdown} />)

    const table = container.querySelector('table')
    expect(table).toBeInTheDocument()

    const ths = getAllByRole('columnheader')
    expect(ths).toHaveLength(3)
    expect(ths[0]).toHaveTextContent('Scene')
    expect(ths[1]).toHaveTextContent('Timestamp')
    expect(ths[2]).toHaveTextContent('Duration')

    const rows = getAllByRole('row')
    // 1 header row + 2 data rows = 3 rows
    expect(rows).toHaveLength(3)
  })

  it('renders streaming indicator when isStreaming is true', () => {
    const { container } = render(<DirectorMarkdown content="Generating brief..." isStreaming />)
    const cursor = container.querySelector('.bg-primary')
    expect(cursor).toBeInTheDocument()
  })

  it('renders explicit markdown links with external target and rel attributes', () => {
    const markdown = 'Watch [Master Video](https://storage.googleapis.com/bucket/master.mp4).'
    const { getByRole } = render(<DirectorMarkdown content={markdown} />)

    const link = getByRole('link', { name: 'Master Video' })
    expect(link).toHaveAttribute('href', 'https://storage.googleapis.com/bucket/master.mp4')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('linkifies bare URLs across prose, lists, quotes, parentheses, colons, and balanced parens', () => {
    const markdown = [
      'Master:https://storage.googleapis.com/bucket/master.mp4',
      '- Quoted: "https://storage.googleapis.com/bucket/quoted.mp4"',
      '- Paren: (https://storage.googleapis.com/bucket/paren.mp4).',
      '- Balanced: https://storage.googleapis.com/bucket/All_in_(0.92x)_(Remastered).mp3.',
    ].join('\n')

    const { container } = render(<DirectorMarkdown content={markdown} />)
    const links = Array.from(container.querySelectorAll('a'))

    expect(links.map((el) => el.getAttribute('href'))).toEqual([
      'https://storage.googleapis.com/bucket/master.mp4',
      'https://storage.googleapis.com/bucket/quoted.mp4',
      'https://storage.googleapis.com/bucket/paren.mp4',
      'https://storage.googleapis.com/bucket/All_in_(0.92x)_(Remastered).mp3',
    ])
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    }
  })

  it('linkifies inline-code URLs while leaving non-URL inline code unlinked', () => {
    const markdown =
      'Download `https://storage.googleapis.com/bucket/master.mp4` for quote `9adf4046`.'
    const { container } = render(<DirectorMarkdown content={markdown} />)

    const links = container.querySelectorAll('a')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', 'https://storage.googleapis.com/bucket/master.mp4')
    expect(links[0]?.querySelector('code')).toHaveTextContent(
      'https://storage.googleapis.com/bucket/master.mp4',
    )

    const codes = Array.from(container.querySelectorAll('code'))
    expect(codes).toHaveLength(2)
    expect(codes[1]).toHaveTextContent('9adf4046')
    expect(codes[1]?.closest('a')).toBeNull()
  })

  it('does not create nested anchors around already-linked inline code', () => {
    const markdown = '[`https://example.com/a`](https://example.com/a)'
    const { container } = render(<DirectorMarkdown content={markdown} />)

    const links = container.querySelectorAll('a')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', 'https://example.com/a')
    expect(links[0]?.querySelector('a')).toBeNull()
    expect(links[0]?.querySelector('code')).toHaveTextContent('https://example.com/a')
  })

  it('converts gs:// URIs in prose, inline code, and markdown links to GCS HTTPS URLs', () => {
    const markdown = [
      'Bare: gs://creative-renders/masters/out_1.mp4',
      'Code: `gs://creative-renders/provenance/manifest.json`',
      'Link: [Ingredients](gs://creative-renders/provenance/ingredients.json)',
    ].join('\n\n')

    const { container } = render(<DirectorMarkdown content={markdown} />)
    const links = Array.from(container.querySelectorAll('a'))

    expect(links.map((el) => el.getAttribute('href'))).toEqual([
      'https://storage.googleapis.com/creative-renders/masters/out_1.mp4',
      'https://storage.googleapis.com/creative-renders/provenance/manifest.json',
      'https://storage.googleapis.com/creative-renders/provenance/ingredients.json',
    ])
  })

  it('renders URLs inside fenced code blocks as clickable links without capturing quotes', () => {
    const markdown = [
      '```json',
      '{"master_timeline_url": "https://storage.googleapis.com/bucket/final.mp4"}',
      '```',
    ].join('\n')

    const { container } = render(<DirectorMarkdown content={markdown} />)
    const pre = container.querySelector('pre')
    expect(pre).toBeInTheDocument()

    const link = pre?.querySelector('a')
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', 'https://storage.googleapis.com/bucket/final.mp4')
    expect(link).toHaveTextContent('https://storage.googleapis.com/bucket/final.mp4')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(pre).toHaveTextContent(
      '{"master_timeline_url": "https://storage.googleapis.com/bucket/final.mp4"}',
    )
  })

  it('does not render unsafe protocols as clickable links', () => {
    const markdown = [
      '[XSS](javascript:alert(1))',
      '[Data](data:text/html,<script>alert(1)</script>)',
      'Inline `javascript:alert(1)` and bare javascript:alert(1)',
    ].join('\n\n')

    const { container } = render(<DirectorMarkdown content={markdown} />)
    expect(container.querySelectorAll('a')).toHaveLength(0)
  })
})
