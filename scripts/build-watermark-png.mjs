// One-off asset build: rasterise the CRTV watermark SVG into a PNG the export can decode.
//
// Why this exists: Chrome's `createImageBitmap` cannot decode SVG (`InvalidStateError`), and
// the export worker has no `Image` element, so an SVG mark can never be rasterised on the
// path production uses. A PNG decodes on both threads. 1024px covers the largest placement
// the renderer will ever ask for (9% of an 8K shorter edge is ~389px).
//
// Run: node scripts/build-watermark-png.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SVG_PATH = path.join(ROOT, 'public/brand/crtv-watermark.svg')
const PNG_PATH = path.join(ROOT, 'public/brand/crtv-watermark.png')
const SIZE = 1024

const svg = fs.readFileSync(SVG_PATH, 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } })

// Paint the artwork on transparency so the mark keeps its own alpha when drawn over video.
await page.setContent(
  `<!doctype html><html><body style="margin:0;background:transparent">
     <div id="stage" style="width:${SIZE}px;height:${SIZE}px;display:grid;place-items:center">
       ${svg.replace('<svg ', `<svg width="${SIZE}" height="${SIZE}" `)}
     </div>
   </body></html>`,
  { waitUntil: 'load' },
)

const png = await page.locator('#stage').screenshot({ omitBackground: true })
fs.writeFileSync(PNG_PATH, png)
await browser.close()

console.log(`wrote ${path.relative(ROOT, PNG_PATH)} (${png.length} bytes, ${SIZE}x${SIZE})`)
