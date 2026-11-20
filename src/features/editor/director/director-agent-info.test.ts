import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET, OPTIONS } from '../../../../api/director-agent-info.js'

describe('GET /api/director-agent-info', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns dual-rail human CRTVAI and x402 Base USDC discovery metadata with CORS and cache headers', async () => {
    vi.stubEnv('DIRECTOR_ADK_BASE_URL', 'https://creative-director-3ortoh2aiq-ue.a.run.app')
    vi.stubEnv('DIRECTOR_ADK_APP_NAME', 'agent')

    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300')

    const body = (await response.json()) as {
      service: string
      humanAccess: { method: string; path: string; quotePath: string; token: string; auth: string }
      agentAccess: {
        protocol: string
        network: string
        asset: string
        priceUsd: string
        payTo: string
        endpoint: string
        mcpUrl: string
        agentCardUrl: string
      }
      adk: { appName: string; configured: boolean }
    }

    expect(body.service).toBe('edit-pixels-creative-director')
    expect(body.humanAccess).toMatchObject({
      method: 'POST',
      path: '/api/director',
      quotePath: '/api/director-quote',
      token: 'CRTVAI',
      auth: 'privy',
    })
    expect(body.agentAccess).toMatchObject({
      protocol: 'x402-v2',
      network: 'eip155:8453',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      priceUsd: '$0.25',
      payTo: '0xf46F1BA19A9280F752a451d0973b047D81c63D70',
      endpoint: 'https://hermes-x402-gateway-3ortoh2aiq-uc.a.run.app/v1/x402/creative-director',
      mcpUrl: 'https://hermes-x402-gateway-3ortoh2aiq-uc.a.run.app/mcp',
      agentCardUrl:
        'https://hermes-x402-gateway-3ortoh2aiq-uc.a.run.app/.well-known/agent-card.json',
    })
    expect(body.adk).toEqual({ appName: 'agent', configured: true })
  })

  it('respects custom HERMES_X402_GATEWAY_URL override', async () => {
    vi.stubEnv('HERMES_X402_GATEWAY_URL', 'https://gateway.example.com/')

    const response = await GET()
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      agentAccess: { endpoint: string; mcpUrl: string; agentCardUrl: string }
    }
    expect(body.agentAccess.endpoint).toBe('https://gateway.example.com/v1/x402/creative-director')
    expect(body.agentAccess.mcpUrl).toBe('https://gateway.example.com/mcp')
    expect(body.agentAccess.agentCardUrl).toBe(
      'https://gateway.example.com/.well-known/agent-card.json',
    )
  })

  it('uses TREASURY_USDC_ADDRESS override when valid and falls back when invalid or blank', async () => {
    const customTreasury = '0x1111111111111111111111111111111111111111'
    vi.stubEnv('TREASURY_USDC_ADDRESS', `  ${customTreasury}  `)

    const customResponse = await GET()
    const customBody = (await customResponse.json()) as { agentAccess: { payTo: string } }
    expect(customBody.agentAccess.payTo).toBe(customTreasury)

    vi.stubEnv('TREASURY_USDC_ADDRESS', 'not-an-address')
    const invalidResponse = await GET()
    const invalidBody = (await invalidResponse.json()) as { agentAccess: { payTo: string } }
    expect(invalidBody.agentAccess.payTo).toBe('0xf46F1BA19A9280F752a451d0973b047D81c63D70')

    vi.stubEnv('TREASURY_USDC_ADDRESS', '   ')
    const blankResponse = await GET()
    const blankBody = (await blankResponse.json()) as { agentAccess: { payTo: string } }
    expect(blankBody.agentAccess.payTo).toBe('0xf46F1BA19A9280F752a451d0973b047D81c63D70')
  })

  it('responds to OPTIONS preflight with 204 and CORS + cache headers', () => {
    const response = OPTIONS()
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS')
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300')
  })
})
