/**
 * GET /api/director-agent-info — dual-rail discovery metadata for Creative Director AI.
 *
 * Humans inside edit-pixels authenticate with Privy and pay in CRTVAI via POST /api/director.
 * External AI agents pay $0.25 Base USDC via x402 v2 at hermes-x402-gateway (/v1/x402/creative-director).
 *
 * Keep price, treasury, and route paths aligned with hermes-x402-gateway:
 *   - src/index.ts (`POST /v1/x402/creative-director`, `GET /.well-known/agent-card.json`)
 *   - src/mcp-manifest.ts (`TREASURY_USDC_ADDRESS`)
 */

import { getDirectorAdkAppName, getDirectorAdkBaseUrl } from './_director-adk.js'

const DEFAULT_HERMES_GATEWAY_URL = 'https://hermes-x402-gateway-3ortoh2aiq-uc.a.run.app'
const BASE_USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const DEFAULT_TREASURY_USDC_ADDRESS = '0xf46F1BA19A9280F752a451d0973b047D81c63D70'
const DIRECTOR_X402_PRICE_USD = '$0.25'

const DISCOVERY_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'public, max-age=300',
} as const

function resolveGatewayBaseUrl(): string {
  return (process.env.HERMES_X402_GATEWAY_URL?.trim() || DEFAULT_HERMES_GATEWAY_URL).replace(
    /\/+$/,
    '',
  )
}

function resolveTreasuryUsdcAddress(): string {
  const configured = process.env.TREASURY_USDC_ADDRESS?.trim()
  if (configured && /^0x[0-9a-fA-F]{40}$/.test(configured)) {
    return configured
  }
  return DEFAULT_TREASURY_USDC_ADDRESS
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: DISCOVERY_HEADERS })
}

export async function GET(): Promise<Response> {
  const gatewayUrl = resolveGatewayBaseUrl()

  return Response.json(
    {
      service: 'edit-pixels-creative-director',
      humanAccess: {
        method: 'POST',
        path: '/api/director',
        quotePath: '/api/director-quote',
        token: 'CRTVAI',
        auth: 'privy',
      },
      agentAccess: {
        protocol: 'x402-v2',
        network: 'eip155:8453',
        asset: BASE_USDC_ADDRESS,
        priceUsd: DIRECTOR_X402_PRICE_USD,
        payTo: resolveTreasuryUsdcAddress(),
        endpoint: `${gatewayUrl}/v1/x402/creative-director`,
        mcpUrl: `${gatewayUrl}/mcp`,
        agentCardUrl: `${gatewayUrl}/.well-known/agent-card.json`,
      },
      adk: {
        appName: getDirectorAdkAppName(),
        configured: Boolean(getDirectorAdkBaseUrl()),
      },
    },
    { headers: DISCOVERY_HEADERS },
  )
}
