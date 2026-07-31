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
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from './lib/cli.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_VERSION = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
).version

const OPTIONS = new Set(['workspace', 'build', 'head', 'help'])
const DEFAULT_FPS = 30
const DEFAULT_WIDTH = 1920
const DEFAULT_HEIGHT = 1080

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

const logger = {
  debug: (...items) => writeLog('DEBUG', items),
  info: (...items) => writeLog('INFO', items),
  warn: (...items) => writeLog('WARN', items),
  error: (...items) => writeLog('ERROR', items),
}

function writeLog(level, items) {
  const line = JSON.stringify({ level, time: new Date().toISOString(), items })
  if (process.env.PIXELS_MCP_LOG) {
    fs.appendFileSync(process.env.PIXELS_MCP_LOG, `${line}\n`)
  } else {
    // Keep stderr free of structured logs by default; MCP traffic uses stdout.
    // Uncomment during heavy debugging:
    // console.error(line)
  }
}

/** Start the Pixels headless HTTP service and wait until /health is OK. */
async function startPixelsService() {
  const port = await getFreePort()
  const child = spawn(
    'node',
    [
      path.join(REPO_ROOT, 'headless', 'serve.mjs'),
      '--workspace',
      workspace,
      '--port',
      String(port),
      '--host',
      '127.0.0.1',
      ...(args.build ? ['--build'] : []),
      ...(args.head ? ['--head'] : []),
    ],
    {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PIXELS_MCP_CHILD: '1' },
    },
  )

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8').trim()
    if (text) logger.warn('pixels-stderr', text)
  })
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8').trim()
    if (text) logger.info('pixels-stdout', text)
  })

  child.on('error', (error) => {
    logger.error('pixels-process-error', error.message)
    throw error
  })

  const serviceUrl = `http://127.0.0.1:${port}`
  await waitForHealth(serviceUrl, { timeoutMs: 120_000 })
  logger.info('pixels-service-ready', { serviceUrl, workspace })
  return { serviceUrl, child }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    import('node:net')
      .then(({ createServer }) => {
        const server = createServer()
        server.listen(0, '127.0.0.1', () => {
          const { port } = server.address()
          server.close(() => resolve(port))
        })
        server.on('error', reject)
      })
      .catch(reject)
  })
}

async function waitForHealth(url, { timeoutMs = 120_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Pixels service did not become healthy: ${lastError?.message ?? 'timeout'}`)
}

/** Low-level HTTP helper. */
async function pixelsFetch(serviceUrl, method, route, body) {
  const init = {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }
  const url = `${serviceUrl}${route}`
  const response = await fetch(url, init)
  const text = await response.text()
  let data
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }
  if (!response.ok) {
    const error = data?.error ?? { code: 'HTTP_ERROR', message: `HTTP ${response.status}` }
    throw new Error(`Pixels ${route} failed: ${error.code} — ${error.message}`)
  }
  return data
}

/* -------------------------------------------------------------------------- */
/* Tool definitions                                                          */
/* -------------------------------------------------------------------------- */

const TOOLS = [
  {
    name: 'pixels_capabilities',
    description:
      'Get Pixels headless capabilities: supported edit operations, GPU effects, render codecs/containers, and JSON schemas.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'pixels_list_projects',
    description: 'List Pixels projects in the workspace.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'pixels_get_project',
    description: 'Get a Pixels project by its workspace id.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string', description: 'Workspace project id' } },
      required: ['projectId'],
    },
  },
  {
    name: 'pixels_create_project',
    description: 'Create a new Pixels project.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Optional explicit project id (alphanumeric, dashes, underscores)' },
        name: { type: 'string', description: 'Project name' },
        description: { type: 'string', description: 'Optional description' },
        width: { type: 'integer', description: `Canvas width (default ${DEFAULT_WIDTH})` },
        height: { type: 'integer', description: `Canvas height (default ${DEFAULT_HEIGHT})` },
        fps: { type: 'integer', description: `Project fps (default ${DEFAULT_FPS})` },
        backgroundColor: { type: 'string', description: 'Hex background color, e.g. #000000' },
      },
      required: ['name'],
    },
  },
  {
    name: 'pixels_update_project',
    description: 'Update a Pixels project metadata. Requires force or expectedRevision.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        width: { type: 'integer' },
        height: { type: 'integer' },
        fps: { type: 'integer' },
        backgroundColor: { type: 'string' },
        expectedRevision: { type: 'string', description: 'sha256:... revision to match' },
        force: { type: 'boolean', description: 'Skip revision check' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'pixels_edit_project',
    description:
      'Apply one or more edit operations to a Pixels project timeline. ' +
      'Every op must have a unique callerId. Reference ids from earlier ops ' +
      'with {"$ref": "callerId#/detail/id"}. Set persist=true to save the result.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        ops: {
          type: 'array',
          description: 'Edit operations: addText, addClip, addTrack, moveItem, split, trimStart, trimEnd, addEffect, setTransform, removeItems, etc.',
          items: { type: 'object' },
        },
        persist: { type: 'boolean', description: 'Save the edited project back to workspace' },
        expectedRevision: { type: 'string' },
        force: { type: 'boolean' },
      },
      required: ['projectId', 'ops'],
    },
  },
  {
    name: 'pixels_list_media',
    description: 'List media imported into the workspace.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'pixels_get_media',
    description: 'Get workspace media metadata by id.',
    inputSchema: {
      type: 'object',
      properties: { mediaId: { type: 'string' } },
      required: ['mediaId'],
    },
  },
  {
    name: 'pixels_import_media',
    description:
      'Import a local media file into the workspace. Provide the absolute file path. Optionally associate it with a project.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the media file' },
        mediaId: { type: 'string', description: 'Optional explicit media id' },
        projectId: { type: 'string', description: 'Optional project to associate' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'pixels_render_project',
    description:
      'Render a Pixels project to a video/audio file. ' +
      'The MCP server writes the file to disk and returns the output path.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        codec: { type: 'string', enum: ['h264', 'h265', 'vp9', 'vp8', 'av1'] },
        container: { type: 'string', enum: ['mp4', 'webm', 'mov', 'mkv', 'mp3', 'wav', 'm4a'] },
        resolution: { type: 'string', description: 'e.g. 1920x1080' },
        fps: { type: 'integer' },
        quality: { type: 'string', enum: ['low', 'medium', 'high', 'ultra'] },
        inSec: { type: 'number', description: 'Render range start in seconds' },
        outSec: { type: 'number', description: 'Render range end in seconds' },
        duration: { type: 'number', description: 'Render duration in seconds (alternative to outSec)' },
        audioOnly: { type: 'boolean' },
        outputPath: { type: 'string', description: 'Absolute output file path (optional; default is a temp file)' },
      },
      required: ['projectId'],
    },
  },
]

/* -------------------------------------------------------------------------- */
/* Resource templates                                                         */
/* -------------------------------------------------------------------------- */

const RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'pixels://projects/{projectId}',
    name: 'Pixels project',
    mimeType: 'application/json',
    description: 'A Pixels project JSON resource.',
  },
  {
    uriTemplate: 'pixels://media/{mediaId}',
    name: 'Pixels media metadata',
    mimeType: 'application/json',
    description: 'Workspace media metadata JSON.',
  },
]

/* -------------------------------------------------------------------------- */
/* Handlers                                                                   */
/* -------------------------------------------------------------------------- */

async function handleTool(serviceUrl, name, args) {
  switch (name) {
    case 'pixels_capabilities': {
      const data = await pixelsFetch(serviceUrl, 'GET', '/v1/capabilities')
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    }
    case 'pixels_list_projects': {
      const data = await pixelsFetch(serviceUrl, 'GET', '/v1/projects')
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    }
    case 'pixels_get_project': {
      const data = await pixelsFetch(serviceUrl, 'GET', `/v1/projects/${encodeURIComponent(args.projectId)}`)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    }
    case 'pixels_create_project': {
      const body = {
        id: args.id,
        name: args.name,
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.width !== undefined ? { width: args.width } : {}),
        ...(args.height !== undefined ? { height: args.height } : {}),
        ...(args.fps !== undefined ? { fps: args.fps } : {}),
        ...(args.backgroundColor !== undefined ? { backgroundColor: args.backgroundColor } : {}),
      }
      const data = await pixelsFetch(serviceUrl, 'POST', '/v1/projects', body)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    }
    case 'pixels_update_project': {
      const body = {
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.width !== undefined ? { width: args.width } : {}),
        ...(args.height !== undefined ? { height: args.height } : {}),
        ...(args.fps !== undefined ? { fps: args.fps } : {}),
        ...(args.backgroundColor !== undefined ? { backgroundColor: args.backgroundColor } : {}),
        ...(args.expectedRevision !== undefined ? { expectedRevision: args.expectedRevision } : {}),
        ...(args.force !== undefined ? { force: args.force } : {}),
      }
      const data = await pixelsFetch(
        serviceUrl,
        'PATCH',
        `/v1/projects/${encodeURIComponent(args.projectId)}`,
        body,
      )
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    }
    case 'pixels_edit_project': {
      const body = {
        ops: args.ops,
        persist: Boolean(args.persist),
        ...(args.expectedRevision !== undefined ? { expectedRevision: args.expectedRevision } : {}),
        ...(args.force !== undefined ? { force: args.force } : {}),
      }
      const data = await pixelsFetch(
        serviceUrl,
        'POST',
        `/v1/projects/${encodeURIComponent(args.projectId)}/edit`,
        body,
      )
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    }
    case 'pixels_list_media': {
      const data = await pixelsFetch(serviceUrl, 'GET', '/v1/media')
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    }
    case 'pixels_get_media': {
      const data = await pixelsFetch(serviceUrl, 'GET', `/v1/media/${encodeURIComponent(args.mediaId)}`)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    }
    case 'pixels_import_media': {
      const filePath = path.resolve(args.filePath)
      if (!fs.existsSync(filePath)) throw new Error(`Media file not found: ${filePath}`)
      const data = await pixelsFetch(serviceUrl, 'POST', '/v1/media/import', {
        file: filePath,
        ...(args.mediaId ? { id: args.mediaId } : {}),
        ...(args.projectId ? { project: args.projectId } : {}),
      })
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    }
    case 'pixels_render_project': {
      const outDir = path.join(os.tmpdir(), 'pixels-mcp-outputs')
      fs.mkdirSync(outDir, { recursive: true })
      const outPath =
        args.outputPath ?? path.join(outDir, `render-${process.pid}-${Date.now()}.out`)
      const body = {
        project: args.projectId,
        ...(args.codec !== undefined ? { codec: args.codec } : {}),
        ...(args.container !== undefined ? { container: args.container } : {}),
        ...(args.resolution !== undefined ? { resolution: args.resolution } : {}),
        ...(args.fps !== undefined ? { fps: args.fps } : {}),
        ...(args.quality !== undefined ? { quality: args.quality } : {}),
        ...(args.inSec !== undefined ? { inSec: args.inSec } : {}),
        ...(args.outSec !== undefined ? { outSec: args.outSec } : {}),
        ...(args.duration !== undefined ? { duration: args.duration } : {}),
        ...(args.audioOnly !== undefined ? { audioOnly: args.audioOnly } : {}),
      }
      const data = await pixelsFetch(serviceUrl, 'POST', '/v1/render', body)
      if (!data?.ok) throw new Error(`Render failed: ${JSON.stringify(data)}`)
      // /v1/render returns the binary directly when rendered inline, but our
      // proxy schema asks for the same HTTP endpoint. Download from the response
      // blob and write to the requested output path.
      const response = await fetch(`${serviceUrl}/v1/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`Render download failed: HTTP ${response.status}`)
      const finalPath = `${outPath}.${data.effectiveSettings?.container ?? 'mp4'}`
      const buffer = Buffer.from(await response.arrayBuffer())
      fs.writeFileSync(finalPath, buffer)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                outputPath: finalPath,
                fileSize: buffer.length,
                durationSeconds: data.durationSeconds,
                effectiveSettings: data.effectiveSettings,
                warnings: data.warnings,
              },
              null,
              2,
            ),
          },
        ],
      }
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

async function handleResource(serviceUrl, uri) {
  const projectMatch = /^pixels:\/\/projects\/(.+)$/.exec(uri)
  if (projectMatch) {
    const data = await pixelsFetch(
      serviceUrl,
      'GET',
      `/v1/projects/${encodeURIComponent(projectMatch[1])}`,
    )
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(data, null, 2),
        },
      ],
    }
  }
  const mediaMatch = /^pixels:\/\/media\/(.+)$/.exec(uri)
  if (mediaMatch) {
    const data = await pixelsFetch(
      serviceUrl,
      'GET',
      `/v1/media/${encodeURIComponent(mediaMatch[1])}`,
    )
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(data, null, 2),
        },
      ],
    }
  }
  throw new Error(`Unknown resource URI: ${uri}`)
}

/* -------------------------------------------------------------------------- */
/* Server bootstrap                                                           */
/* -------------------------------------------------------------------------- */

async function main() {
  const { serviceUrl, child } = await startPixelsService()

  const server = new Server(
    {
      name: 'creative-pixels-mcp',
      version: PACKAGE_VERSION,
    },
    {
      capabilities: {
        resources: { list: true, listTemplates: true, read: true },
        tools: { list: true, call: true },
      },
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    // Dynamic resources: list projects + media from the workspace.
    const projects = await pixelsFetch(serviceUrl, 'GET', '/v1/projects').catch(() => ({ projects: [] }))
    const media = await pixelsFetch(serviceUrl, 'GET', '/v1/media').catch(() => ({ media: [] }))
    const projectResources = (projects.projects ?? []).map((p) => ({
      uri: `pixels://projects/${p.id}`,
      name: p.name,
      mimeType: 'application/json',
    }))
    const mediaResources = (media.media ?? []).map((m) => ({
      uri: `pixels://media/${m.id}`,
      name: m.metadata?.fileName ?? m.id,
      mimeType: 'application/json',
    }))
    return { resources: [...projectResources, ...mediaResources] }
  })
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: RESOURCE_TEMPLATES,
  }))
  server.setRequestHandler(ReadResourceRequestSchema, async (request) =>
    handleResource(serviceUrl, request.params.uri),
  )
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: toolArgs } = request.params
    logger.info('tool-call', { name, args: toolArgs })
    try {
      const result = await handleTool(serviceUrl, name, toolArgs ?? {})
      logger.info('tool-result', { name, ok: true })
      return result
    } catch (error) {
      logger.error('tool-error', { name, message: error.message })
      return {
        content: [
          { type: 'text', text: `Error: ${error.message}` },
        ],
        isError: true,
      }
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  logger.info('mcp-server-connected', { transport: 'stdio' })

  // Graceful shutdown.
  const shutdown = async () => {
    logger.info('mcp-shutdown', { signal: 'SIGINT/SIGTERM' })
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
  logger.error('mcp-fatal', error.message)
  process.exit(1)
})
