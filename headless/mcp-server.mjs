#!/usr/bin/env node
/**
 * Pixels MCP server.
 *
 * Exposes the existing Pixels headless render/editing API as a Model Context
 * Protocol (MCP) stdio server. AI agents can use these tools to create,
 * inspect, edit, and render Pixels video projects locally.
 *
 * Transport: stdio (use with Hermes Agent, Claude Desktop, etc.).
 * Under the hood: launches `node headless/serve.mjs` for the configured
 * workspace and proxies tool calls to its HTTP lifecycle API.
 *
 * Usage:
 *   node headless/mcp-server.mjs --workspace <dir> [--build] [--head]
 *
 * Environment:
 *   PIXELS_WORKSPACE  default workspace directory
 *   PIXELS_MCP_LOG    optional log file path (stderr otherwise)
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { parseArgs } from './lib/cli.mjs'
import { createMcpLogger, createMcpServer, startPixelsService } from './lib/mcp-server-core.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const OPTIONS = new Set(['workspace', 'build', 'head', 'help'])
const args = parseArgs(process.argv.slice(2), { allowed: OPTIONS })

if (args.help) {
  process.stdout.write(`Usage: node headless/mcp-server.mjs --workspace <dir> [options]\n\n`)
  process.stdout.write(`Options:\n`)
  process.stdout.write(`  --workspace <dir>  Pixels workspace directory (required)\n`)
  process.stdout.write(`  --build            Build the harness before starting\n`)
  process.stdout.write(`  --head             Run Chrome in headed mode (debug only)\n`)
  process.exit(0)
}

const workspace = path.resolve(args.workspace ?? process.env.PIXELS_WORKSPACE ?? '')
if (!workspace || !fs.existsSync(workspace)) {
  console.error(`Workspace not found: ${workspace || '(missing --workspace or PIXELS_WORKSPACE)'}`)
  process.exit(1)
}

const logger = createMcpLogger()

async function main() {
  const { serviceUrl, child } = await startPixelsService({
    repoRoot: REPO_ROOT,
    workspace,
    build: args.build,
    head: args.head,
  })

  const { server } = createMcpServer({ serviceUrl, child, logger })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  logger('INFO', 'mcp-server-connected', { transport: 'stdio' })

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
  logger('ERROR', 'mcp-fatal', error.message)
  process.exit(1)
})
