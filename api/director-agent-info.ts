/**
 * GET /api/director-agent-info — dual-rail discovery metadata for Creative Director AI.
 *
 * Humans inside edit-pixels authenticate with Privy and pay in CRTVAI via POST /api/director.
 * External AI agents pay $0.25 Base USDC via x402 v2 at hermes-x402-gateway (/v1/x402/creative-director).
 */

import { getDirectorAdkAppName, getDirectorAdkBaseUrl } from './_director-adk.js'

const DEFAULT_HERMES_GATEWAY_URL = 'https://hermes-x402-gateway-3ortoh2aiq-uc.a.run.app'
const BASE_USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const SAFE_TREASURY_VAULT = '0xf46F1BA19A9280F752a451d0973b047D81c63D70'

function resolveGatewayBaseUrl(): string {
  return (process.env.HERMES_X402_GATEWAY_URL?.trim() || DEFAULT_HERMES_GATEWAY_URL).replace(
    /\/+$/,
    '',
  )
}

export async function GET(): Promise<Response> {
  const gatewayUrl = resolveGatewayBaseUrl()

  return Response.json({
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
      priceUsd: '$0.25',
      payTo: SAFE_TREASURY_VAULT,
      endpoint: `${gatewayUrl}/v1/x402/creative-director`,
      mcpUrl: `${gatewayUrl}/mcp`,
      agentCardUrl: `${gatewayUrl}/.well-known/agent-card.json`,
    },
    adk: {
      appName: getDirectorAdkAppName(),
      configured: Boolean(getDirectorAdkBaseUrl()),
    },
  })
}
