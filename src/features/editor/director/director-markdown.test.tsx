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
})
