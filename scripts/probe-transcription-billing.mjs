#!/usr/bin/env node
/**
 * Probe OpenRouter's speech-to-text billing granularity for a transcribe model.
 *
 * Why: per-request rounding is the only cost term that scales with chunk count.
 * Rounding to the minute adds ~4.9% COGS on a 4-hour job; rounding to 5 minutes
 * adds ~24.8% and breaks the priced band. This measures it once, cheaply, so the
 * lockfile can pin `billingGranularity` next to the unit price.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-... node scripts/probe-transcription-billing.mjs
 *   OPENROUTER_API_KEY=... node scripts/probe-transcription-billing.mjs --model nvidia/nemotron-3.5-transcribe
 *
 * Cost: ~1.8 cents total at $0.0000167/audio-second (three clips, see CASES).
 * Sends synthetic sine audio, not user media. No write path, no ledger interaction.
 *
 * Reads: usage.cost off each response, prints implied billed seconds, and the
 * granularity that best explains all three answers.
 */

const ENDPOINT = 'https://openrouter.ai/api/v1/audio/transcriptions'
const SAMPLE_RATE = 16000
const UNIT_PRICE_PER_SECOND = 0.0000166667 // nvidia/nemotron-3.5-transcribe @ PrimeIntellect

// Each case isolates a different grid. See README section of the reply for the maths.
const CASES = [
  { label: 'short 7s', seconds: 7, catches: 'exact vs 10s vs 60s vs 300s + any minimum floor' },
  { label: 'partial 9:37', seconds: 577, catches: '60s rounding on a VAD-length chunk (577 -> 600)' },
  { label: 'partial 8:00', seconds: 480, catches: '300s rounding (480 -> 600)' },
]

const GRANULARITIES = [1, 10, 15, 20, 30, 60, 300]

function sineWavBase64(seconds, frequency = 440) {
  const frames = Math.round(seconds * SAMPLE_RATE)
  const dataBytes = frames * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16) // fmt chunk size
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24)
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28) // byte rate
  buffer.writeUInt16LE(2, 32) // block align
  buffer.writeUInt16LE(16, 34) // bits per sample
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < frames; i += 1) {
    // Slow amplitude envelope so the clip is not a pure tone.
    const envelope = 0.25 * (0.6 + 0.4 * Math.sin((2 * Math.PI * i) / (SAMPLE_RATE * 0.9)))
    const sample = Math.round(envelope * 32767 * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE))
    buffer.writeInt16LE(sample, 44 + i * 2)
  }
  return buffer
}

function roundUp(value, granularity) {
  return Math.ceil(value / granularity) * granularity
}

function expectedCostFor(seconds, granularity) {
  return roundUp(seconds, granularity) * UNIT_PRICE_PER_SECOND
}

async function transcribe({ apiKey, model, seconds, label }) {
  const wav = sineWavBase64(seconds)
  const form = new FormData()
  form.append('file', new Blob([wav], { type: 'audio/wav' }), `${label.replace(/[^a-z0-9]+/gi, '-')}.wav`)
  form.append('model', model)
  form.append('response_format', 'json')

  const startedAt = Date.now()
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  const elapsedMs = Date.now() - startedAt
  const text = await response.text()

  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { unparsed: text.slice(0, 400) }
  }

  if (!response.ok) {
    return { label, seconds, status: response.status, elapsedMs, error: body }
  }

  const cost = typeof body.usage?.cost === 'number' ? body.usage.cost : null
  const impliedSeconds = cost === null ? null : cost / UNIT_PRICE_PER_SECOND

  return {
    label,
    seconds,
    status: response.status,
    elapsedMs,
    cost,
    impliedSeconds,
    responseKeys: Object.keys(body),
    usage: body.usage ?? null,
    // Provider identity is not documented as a response field; log whatever shows up.
    providerHint: body.provider ?? body.provider_name ?? body.model ?? null,
  }
}

function inferGranularity(rows) {
  const usable = rows.filter((row) => typeof row.impliedSeconds === 'number')
  if (usable.length === 0) return null
  const scored = GRANULARITIES.map((granularity) => {
    const residual = usable.reduce(
      (sum, row) => sum + Math.abs(row.impliedSeconds - roundUp(row.seconds, granularity)),
      0,
    )
    return { granularity, residual }
  }).sort((a, b) => a.residual - b.residual)
  return scored[0]
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY
  const modelArgIndex = process.argv.indexOf('--model')
  const model = modelArgIndex > -1 ? process.argv[modelArgIndex + 1] : 'nvidia/nemotron-3.5-transcribe'
  const dryRun = process.argv.includes('--dry-run')

  console.log(`model: ${model}`)
  console.log(`unit price assumption: $${UNIT_PRICE_PER_SECOND}/audio-second\n`)

  if (dryRun) {
    for (const testCase of CASES) {
      const bytes = 44 + Math.round(testCase.seconds * SAMPLE_RATE) * 2
      console.log(
        `${testCase.label.padEnd(18)} ${String(testCase.seconds).padStart(5)}s  ${(bytes / 1024 / 1024).toFixed(2)} MiB` +
          `${bytes > 25 * 1024 * 1024 ? '  OVER 25 MiB multipart cap' : ''}`,
      )
    }
    console.log('\ndry run: no requests sent')
    return
  }

  if (!apiKey) {
    console.error('OPENROUTER_API_KEY is not set. Export it, then re-run.')
    process.exit(1)
  }

  const rows = []
  for (const testCase of CASES) {
    const row = await transcribe({ apiKey, model, seconds: testCase.seconds, label: testCase.label })
    rows.push(row)
    console.log(`--- ${testCase.label} (${testCase.seconds}s) — catches: ${testCase.catches}`)
    console.log(JSON.stringify(row, null, 2))
    console.log()
    // Auth/credit failures are not per-case: stop rather than upload three more bodies.
    if ([401, 402, 403].includes(row.status)) {
      console.error(`aborting: ${row.status} means the key or balance is the problem, not the model.`)
      process.exit(2)
    }
  }

  console.log('=== implied billed seconds vs sent seconds ===')
  console.log('case                sent   implied   exact$    10s$     60s$     300s$')
  for (const row of rows) {
    if (typeof row.impliedSeconds !== 'number') {
      console.log(`${row.label.padEnd(18)}  n/a (status ${row.status})`)
      continue
    }
    const columns = GRANULARITIES.filter((g) => [1, 10, 60, 300].includes(g))
      .map((granularity) => expectedCostFor(row.seconds, granularity).toFixed(7))
      .join('  ')
    console.log(
      `${row.label.padEnd(18)} ${String(row.seconds).padStart(5)} ${row.impliedSeconds
        .toFixed(2)
        .padStart(9)}  ${row.cost.toFixed(7)}  ${columns}`,
    )
  }

  const best = inferGranularity(rows)
  console.log()
  if (best) {
    console.log(`best-fit billing granularity: ${best.granularity}s (residual ${best.residual.toFixed(3)})`)
    console.log(
      best.granularity === 1
        ? '=> exact duration billing. Chunk length is a free choice.'
        : `=> rounded up per request. Plan chunk boundaries on a ${best.granularity}s grid, or budget +${(
            ((roundUp(600, best.granularity) - 600) / 600) *
            100
          ).toFixed(1)}% COGS at a 600s target.`,
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
