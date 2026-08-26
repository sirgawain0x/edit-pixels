#!/usr/bin/env node
/**
 * Pixels MCP server with CRTVAI usage-based billing.
 *
 * Wraps the core MCP server and adds a credit ledger. Every paid operation
 * (render, edit) requires sufficient USDC-equivalent credits. Users deposit
 * CRTVAI to a platform treasury address, then call `pixels_deposit_credits`
 * with the transaction hash to be credited.
 *
 * Usage:
 *   node headless/mcp-server-billing.mjs --workspace <dir> --account <address-or-key> [options]
 *
 * Environment:
 *   PIXELS_WORKSPACE            default workspace directory
 *   PIXELS_MCP_LOG              optional log file path
 *   PIXELS_LEDGER_PATH          credit ledger file (default: <workspace>/.pixels/ledger.json)
 *   PIXELS_TREASURY_ADDRESS     platform address that receives CRTVAI deposits
 *   VITE_ALCHEMY_API_KEY        used to read CRTVAI price/balance on Base
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from './lib/cli.mjs'
import { createMcpLogger, createMcpServer, startPixelsService, TOOLS as CORE_TOOLS } from './lib/mcp-server-core.mjs'
import { CreditLedger } from './lib/billing/ledger.mjs'
import {
  estimateRenderCostUsdc6,
  estimateEditCostUsdc6,
  metokenWeiToUsdc6,
  formatUsdc6,
  INTERVAL_COST_PREMIUM_USDC6,
  INTERVAL_COST_RETAIL_USDC6,
} from './lib/billing/pricing.mjs'
import { verifyCrtvaiTransfer, readCrtvaiCurrentPrice } from './lib/billing/crtvai.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const OPTIONS = new Set([
  'workspace',
  'account',
  'treasury',
  'build',
  'head',
  'ledger',
  'help',
  'premium',
])
const args = parseArgs(process.argv.slice(2), { allowed: OPTIONS })

if (args.help) {
  process.stdout.write(
    `Usage: node headless/mcp-server-billing.mjs --workspace <dir> --account <address> [options]\n\n`,
  )
  process.stdout.write(`Options:\n`)
  process.stdout.write(`  --workspace <dir>    Pixels workspace directory (required)\n`)
  process.stdout.write(`  --account <id>      Wallet address or API key to bill (required)\n`)
  process.stdout.write(`  --treasury <addr>   Platform treasury address for CRTVAI deposits\n`)
  process.stdout.write(
    `  --ledger <path>     Ledger JSON file (default: <workspace>/.pixels/ledger.json)\n`,
  )
  process.stdout.write(`  --premium           Apply premium interval pricing\n`)
  process.stdout.write(`  --build             Build the harness before starting\n`)
  process.stdout.write(`  --head              Run Chrome in headed mode (debug only)\n`)
  process.exit(0)
}

const workspace = path.resolve(args.workspace ?? process.env.PIXELS_WORKSPACE ?? '')
if (!workspace || !requireWorkspace(workspace)) {
  console.error(`Workspace not found: ${workspace || '(missing --workspace or PIXELS_WORKSPACE)'}`)
  process.exit(1)
}

const accountId = args.account ?? process.env.PIXELS_ACCOUNT_ID
if (!accountId) {
  console.error('Missing --account or PIXELS_ACCOUNT_ID')
  process.exit(1)
}

const treasuryAddress = args.treasury ?? process.env.PIXELS_TREASURY_ADDRESS
const ledgerPath =
  args.ledger ?? process.env.PIXELS_LEDGER_PATH ?? path.join(workspace, '.pixels', 'ledger.json')
const intervalCostUsdc6 = args.premium ? INTERVAL_COST_PREMIUM_USDC6 : INTERVAL_COST_RETAIL_USDC6

const ledger = new CreditLedger({ storePath: ledgerPath })
const logger = createMcpLogger()

function requireWorkspace(dir) {
  try {
    return fs.existsSync(dir)
  } catch {
    return false
  }
}

/* -------------------------------------------------------------------------- */
/* Billing helpers                                                            */
/* -------------------------------------------------------------------------- */

function isPaidTool(name) {
  return name === 'pixels_render_project' || name === 'pixels_edit_project'
}

// fallow-ignore-next-line complexity
function estimateToolCost(name, args) {
  if (name === 'pixels_render_project') {
    // If duration is explicit use it; otherwise we cannot estimate until the project is loaded.
    const durationSeconds =
      typeof args.duration === 'number'
        ? args.duration
        : typeof args.outSec === 'number' && typeof args.inSec === 'number'
          ? args.outSec - args.inSec
          : null
    if (durationSeconds === null) return null
    return estimateRenderCostUsdc6({
      durationSeconds,
      intervalCostUsdc6,
      quality: args.quality,
      gpuDensity: args.gpuDensity,
      audioOnly: args.audioOnly,
    })
  }

  if (name === 'pixels_edit_project') {
    const opCount = Array.isArray(args.ops) ? args.ops.length : 0
    return estimateEditCostUsdc6({ opCount, intervalCostUsdc6 })
  }

  return 0
}

function textResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function errorResult(message) {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
}

/* -------------------------------------------------------------------------- */
/* Billing tools                                                              */
/* -------------------------------------------------------------------------- */

const BILLING_TOOLS = [
  {
    name: 'pixels_account_balance',
    description:
      'Get the current credit balance, available credits, and pricing tier for the billing account.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'pixels_estimate_cost',
    description:
      'Estimate the cost of a render or edit operation in USD-equivalent credits before running it.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', enum: ['pixels_render_project', 'pixels_edit_project'] },
        projectId: { type: 'string' },
        duration: { type: 'number', description: 'Render duration in seconds' },
        quality: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'ultra'],
          description: 'Render quality tier',
        },
        gpuDensity: {
          type: 'string',
          enum: ['none', 'light', 'medium', 'heavy'],
          description: 'Approximate GPU effect density',
        },
        audioOnly: { type: 'boolean' },
        opCount: { type: 'integer', description: 'Number of edit operations' },
      },
      required: ['tool'],
    },
  },
  {
    name: 'pixels_deposit_credits',
    description:
      'Verify a CRTVAI deposit transfer to the platform treasury and credit the account. ' +
      'Provide the transaction hash, the sending wallet address, and (optionally) the treasury address.',
    inputSchema: {
      type: 'object',
      properties: {
        txHash: { type: 'string', description: 'Base transaction hash of the CRTVAI transfer' },
        from: { type: 'string', description: 'Wallet address that sent CRTVAI' },
        treasury: { type: 'string', description: 'Override treasury address' },
      },
      required: ['txHash', 'from'],
    },
  },
]

async function toolAccountBalance() {
  const summary = ledger.summary(accountId)
  return textResult({
    ...summary,
    tier: intervalCostUsdc6 === INTERVAL_COST_PREMIUM_USDC6 ? 'premium' : 'retail',
    hourlyRateUsdc6: intervalCostUsdc6 * 12,
    formattedBalance: formatUsdc6(summary.balanceUsdc6),
    formattedAvailable: formatUsdc6(summary.availableUsdc6),
  })
}

// fallow-ignore-next-line complexity
async function toolEstimateCost(args) {
  if (args.tool === 'pixels_render_project') {
    const cost = estimateRenderCostUsdc6({
      durationSeconds: args.duration,
      intervalCostUsdc6,
      quality: args.quality,
      gpuDensity: args.gpuDensity,
      audioOnly: args.audioOnly,
    })
    return textResult({
      tool: args.tool,
      estimatedCostUsdc6: cost,
      formattedCost: formatUsdc6(cost),
      tier: intervalCostUsdc6 === INTERVAL_COST_PREMIUM_USDC6 ? 'premium' : 'retail',
      inputs: pickDefined(args, ['duration', 'quality', 'gpuDensity', 'audioOnly']),
    })
  }

  if (args.tool === 'pixels_edit_project') {
    const cost = estimateEditCostUsdc6({
      opCount: args.opCount,
      intervalCostUsdc6,
    })
    return textResult({
      tool: args.tool,
      estimatedCostUsdc6: cost,
      formattedCost: formatUsdc6(cost),
      tier: intervalCostUsdc6 === INTERVAL_COST_PREMIUM_USDC6 ? 'premium' : 'retail',
      inputs: pickDefined(args, ['opCount']),
    })
  }

  return errorResult(`Unsupported tool for estimation: ${args.tool}`)
}

// fallow-ignore-next-line complexity
async function toolDepositCredits(args) {
  if (!treasuryAddress && !args.treasury) {
    return errorResult(
      'Treasury address is not configured. Set --treasury or PIXELS_TREASURY_ADDRESS.',
    )
  }
  const to = (args.treasury ?? treasuryAddress).toLowerCase()
  const from = args.from.toLowerCase()
  const normalizedAccount = accountId.toLowerCase()
  if (from !== normalizedAccount) {
    return errorResult('Deposit sender must match the billing account (--account / PIXELS_ACCOUNT_ID).')
  }
  if (ledger.hasDepositTx(args.txHash)) {
    return errorResult('This deposit transaction hash was already credited.')
  }
  const price = await readCrtvaiCurrentPrice(process.env.VITE_ALCHEMY_API_KEY)
  const verify = await verifyCrtvaiTransfer({
    txHash: args.txHash,
    from,
    to,
    alchemyKey: process.env.VITE_ALCHEMY_API_KEY,
  })
  if (!verify.ok) {
    return errorResult(`Deposit verification failed: ${verify.reason}`)
  }
  const usdc6 = metokenWeiToUsdc6(verify.amountWei, price)
  ledger.credit(accountId, usdc6, {
    txHash: args.txHash,
    from,
    to,
    metokenWei: verify.amountWei.toString(),
  })
  return textResult({
    ok: true,
    creditedUsdc6: usdc6,
    formattedCredited: formatUsdc6(usdc6),
    accountId,
    balanceUsdc6: ledger.getBalance(accountId),
    txHash: args.txHash,
  })
}

const BILLING_HANDLERS = {
  pixels_account_balance: toolAccountBalance,
  pixels_estimate_cost: toolEstimateCost,
  pixels_deposit_credits: toolDepositCredits,
}

function pickDefined(source, keys) {
  const out = {}
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key]
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* Middleware                                                                 */
/* -------------------------------------------------------------------------- */

// fallow-ignore-next-line complexity
async function onToolCall(name, args, serviceUrl, next) {
  // Billing tools are free.
  if (BILLING_HANDLERS[name]) {
    return BILLING_HANDLERS[name](args)
  }

  if (!isPaidTool(name)) {
    return next()
  }

  const estimate = estimateToolCost(name, args)
  if (estimate === null) {
    // Cannot estimate upfront; block with instructions. For edit, we could
    // still allow it with a flat reserve; for render we need duration.
    if (name === 'pixels_render_project') {
      return errorResult(
        'Render cost cannot be estimated without --duration or --outSec/--inSec. ' +
          'Call pixels_estimate_cost first, then provide a duration.',
      )
    }
  }

  const reserveEstimate = estimate ?? estimateEditCostUsdc6({ opCount: 100, intervalCostUsdc6 })
  const reserve = ledger.reserve(accountId, reserveEstimate)
  if (!reserve.ok) {
    return errorResult(
      `${reserve.reason}. Call pixels_account_balance to check credits or ` +
        'pixels_deposit_credits to top up with CRTVAI.',
    )
  }

  logger('INFO', 'billing-reserve', { accountId, tool: name, estimateUsdc6: reserveEstimate })

  let result
  let actualCost = reserveEstimate
  try {
    result = await next()
    if (name === 'pixels_render_project') {
      const text = result?.content?.[0]?.text
      const parsed = text ? JSON.parse(text) : null
      const duration = parsed?.durationSeconds ?? parsed?.duration
      if (typeof duration !== 'number' || duration <= 0) {
        actualCost = reserveEstimate
      } else {
        actualCost = estimateRenderCostUsdc6({
          durationSeconds: duration,
          intervalCostUsdc6,
          quality: args.quality,
          gpuDensity: args.gpuDensity,
          audioOnly: args.audioOnly,
        })
      }
    }
    if (name === 'pixels_edit_project') {
      // Edit actual cost uses the same flat estimate; adjust later when the
      // headless API returns timing metadata.
      actualCost = estimate ?? reserveEstimate
    }
  } catch (error) {
    ledger.releaseReservation(accountId, reserve.reservationId)
    throw error
  }

  const settlement = ledger.finalizeReservation(accountId, reserve.reservationId, actualCost)
  logger('INFO', 'billing-settle', { accountId, tool: name, chargedUsdc6: settlement.chargedUsdc6 })

  // Append billing metadata to the tool result text.
  if (result?.content?.[0]?.text) {
    try {
      const parsed = JSON.parse(result.content[0].text)
      parsed.billing = {
        chargedUsdc6: settlement.chargedUsdc6,
        returnedUsdc6: settlement.returnedUsdc6,
        balanceUsdc6: settlement.balanceUsdc6,
        formattedCharged: formatUsdc6(settlement.chargedUsdc6),
        formattedBalance: formatUsdc6(settlement.balanceUsdc6),
      }
      result.content[0].text = JSON.stringify(parsed, null, 2)
    } catch {
      // Non-JSON result; leave as-is.
    }
  }

  return result
}

/* -------------------------------------------------------------------------- */
/* Bootstrap                                                                    */
/* -------------------------------------------------------------------------- */

async function main() {
  const { serviceUrl, child } = await startPixelsService({
    repoRoot: REPO_ROOT,
    workspace,
    build: args.build,
    head: args.head,
  })

  const { server } = createMcpServer({ serviceUrl, child, logger, onToolCall })

  // Patch tool list to include billing tools.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...CORE_TOOLS, ...BILLING_TOOLS],
  }))

  const transport = new StdioServerTransport()
  await server.connect(transport)
  logger('INFO', 'mcp-billing-server-connected', {
    transport: 'stdio',
    accountId,
    tier: intervalCostUsdc6 === INTERVAL_COST_PREMIUM_USDC6 ? 'premium' : 'retail',
  })

  const shutdown = async () => {
    logger('INFO', 'mcp-shutdown', { signal: 'SIGINT/SIGTERM' })
    try {
      await transport.close()
      child.kill('SIGTERM')
    } catch {
      child.kill('SIGKILL')
    }
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  logger('ERROR', 'mcp-billing-fatal', error.message)
  process.exit(1)
})
