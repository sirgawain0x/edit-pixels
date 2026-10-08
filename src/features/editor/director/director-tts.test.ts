import { describe, expect, it } from 'vite-plus/test'
import { cleanMarkdownForSpeech, isSpeechSynthesisSupported } from './director-tts'

describe('director-tts', () => {
  describe('cleanMarkdownForSpeech', () => {
    it('strips headers, bold markers, and bullet points', () => {
      const markdown = '### **Batch Render Quote Summary**\n* **Batch Quote ID:** `9adf4046`'
      const clean = cleanMarkdownForSpeech(markdown)
      expect(clean).toContain('Batch Render Quote Summary')
      expect(clean).not.toContain('###')
      expect(clean).not.toContain('**')
      expect(clean).not.toContain('`')
      expect(clean).not.toContain('*')
    })

    it('cleans tables into readable comma-separated text', () => {
      const markdown = `| Scene | Timestamp | Duration |
| --- | --- | --- |
| 1 | 00:00:00 | 4s |`
      const clean = cleanMarkdownForSpeech(markdown)
      expect(clean).toContain('Scene , Timestamp , Duration')
      expect(clean).toContain('1 , 00:00:00 , 4s')
      expect(clean).not.toContain('---')
      expect(clean).not.toContain('|')
    })

    it('strips links and image tags while preserving link text', () => {
      const markdown = 'Check this [link text](https://example.com) and ![alt image](img.png).'
      const clean = cleanMarkdownForSpeech(markdown)
      expect(clean).toContain('Check this link text and .')
      expect(clean).not.toContain('https://example.com')
      expect(clean).not.toContain('alt image')
    })

    it('handles empty input gracefully', () => {
      expect(cleanMarkdownForSpeech('')).toBe('')
    })
  })

  describe('isSpeechSynthesisSupported', () => {
    it('returns boolean without throwing', () => {
      expect(typeof isSpeechSynthesisSupported()).toBe('boolean')
    })
  })
})
