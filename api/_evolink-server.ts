/// <reference types="node" />
// fallow-ignore-file unused-export
const BASE_URL = 'https://api.evolink.ai/v1'

function getServerApiKey(): string | null {
  const key = process.env.EVOLINK_API_KEY || process.env.VITE_EVOLINK_API_KEY
  return key?.trim() || null
}

export function isEvolinkServerConfigured(): boolean {
  return getServerApiKey() !== null
}

export async function evolinkServerPost<T>(path: string, body: unknown): Promise<T> {
  const apiKey = getServerApiKey()
  if (!apiKey) throw new Error('Evolink API key not configured on server')

  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Evolink error ${response.status}: ${text}`)
  }
  return (await response.json()) as T
}

export async function evolinkServerGet<T>(path: string): Promise<T> {
  const apiKey = getServerApiKey()
  if (!apiKey) throw new Error('Evolink API key not configured on server')

  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Evolink error ${response.status}: ${text}`)
  }
  return (await response.json()) as T
}
