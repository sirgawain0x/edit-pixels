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

async function probeHealth(url) {
  const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2_000) })
  return response.ok
}

async function waitForHealth(url, { timeoutMs = 120_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let lastError = 'timeout'
  while (Date.now() < deadline) {
    try {
      if (await probeHealth(url)) return
    } catch (error) {
      lastError = String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Pixels service did not become healthy: ${lastError}`)
}

function parseBodyText(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

function httpErrorFrom(data, status) {
  if (data && data.error) return data.error
  return { code: 'HTTP_ERROR', message: `HTTP ${status}` }
}

/** Low-level HTTP helper. */
async function pixelsFetch(serviceUrl, method, route, body) {
  const init = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body) init.body = JSON.stringify(body)
  const response = await fetch(`${serviceUrl}${route}`, init)
  const data = parseBodyText(await response.text())
  if (response.ok) return data
  const error = httpErrorFrom(data, response.status)
  throw new Error(`Pixels ${route} failed: ${error.code} — ${error.message}`)
}

function pickDefined(source, keys) {
  const out = {}
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key]
  }
  return out
}

function textResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
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

async function toolCapabilities(serviceUrl) {
  return textResult(await pixelsFetch(serviceUrl, 'GET', '/v1/capabilities'))
}

async function toolListProjects(serviceUrl) {
  return textResult(await pixelsFetch(serviceUrl, 'GET', '/v1/projects'))
}

async function toolGetProject(serviceUrl, args) {
  return textResult(
    await pixelsFetch(serviceUrl, 'GET', `/v1/projects/${encodeURIComponent(args.projectId)}`),
  )
}

async function toolCreateProject(serviceUrl, args) {
  const body = {
    id: args.id,
    name: args.name,
    ...pickDefined(args, ['description', 'width', 'height', 'fps', 'backgroundColor']),
  }
  return textResult(await pixelsFetch(serviceUrl, 'POST', '/v1/projects', body))
}

async function toolUpdateProject(serviceUrl, args) {
  const body = pickDefined(args, [
    'name',
    'description',
    'width',
    'height',
    'fps',
    'backgroundColor',
    'expectedRevision',
    'force',
  ])
  return textResult(
    await pixelsFetch(
      serviceUrl,
      'PATCH',
      `/v1/projects/${encodeURIComponent(args.projectId)}`,
      body,
    ),
  )
}

async function toolEditProject(serviceUrl, args) {
  const body = {
    ops: args.ops,
    persist: Boolean(args.persist),
    ...pickDefined(args, ['expectedRevision', 'force']),
  }
  return textResult(
    await pixelsFetch(
      serviceUrl,
      'POST',
      `/v1/projects/${encodeURIComponent(args.projectId)}/edit`,
      body,
    ),
  )
}

async function toolListMedia(serviceUrl) {
  return textResult(await pixelsFetch(serviceUrl, 'GET', '/v1/media'))
}

async function toolGetMedia(serviceUrl, args) {
  return textResult(
    await pixelsFetch(serviceUrl, 'GET', `/v1/media/${encodeURIComponent(args.mediaId)}`),
  )
}

async function toolImportMedia(serviceUrl, args) {
  const filePath = path.resolve(args.filePath)
  if (!fs.existsSync(filePath)) throw new Error(`Media file not found: ${filePath}`)
  const body = { file: filePath, ...pickDefined({ id: args.mediaId, project: args.projectId }, ['id', 'project']) }
  return textResult(await pixelsFetch(serviceUrl, 'POST', '/v1/media/import', body))
}

function buildRenderBody(args) {
  return {
    project: args.projectId,
    ...pickDefined(args, [
      'codec',
      'container',
      'resolution',
      'fps',
      'quality',
      'inSec',
      'outSec',
      'duration',
      'audioOnly',
    ]),
  }
}

async function downloadRenderBinary(serviceUrl, body) {
  const response = await fetch(`${serviceUrl}/v1/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Render download failed: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

function defaultRenderOutPath() {
  const outDir = path.join(os.tmpdir(), 'pixels-mcp-outputs')
  fs.mkdirSync(outDir, { recursive: true })
  return path.join(outDir, `render-${process.pid}-${Date.now()}.out`)
}

function assertRenderOk(data) {
  if (data && data.ok) return
  throw new Error(`Render failed: ${JSON.stringify(data)}`)
}

function renderContainer(data) {
  const settings = data.effectiveSettings
  if (settings && settings.container) return settings.container
  return 'mp4'
}

async function toolRenderProject(serviceUrl, args) {
  let outPath = args.outputPath
  if (!outPath) outPath = defaultRenderOutPath()
  const body = buildRenderBody(args)
  const data = await pixelsFetch(serviceUrl, 'POST', '/v1/render', body)
  assertRenderOk(data)
  // /v1/render returns the binary directly when rendered inline, but our
  // proxy schema asks for the same HTTP endpoint. Download from the response
  // blob and write to the requested output path.
  const buffer = await downloadRenderBinary(serviceUrl, body)
  const finalPath = `${outPath}.${renderContainer(data)}`
  fs.writeFileSync(finalPath, buffer)
  return textResult({
    ok: true,
    outputPath: finalPath,
    fileSize: buffer.length,
    durationSeconds: data.durationSeconds,
    effectiveSettings: data.effectiveSettings,
    warnings: data.warnings,
  })
}

const TOOL_HANDLERS = {
  pixels_capabilities: toolCapabilities,
  pixels_list_projects: toolListProjects,
  pixels_get_project: toolGetProject,
  pixels_create_project: toolCreateProject,
  pixels_update_project: toolUpdateProject,
  pixels_edit_project: toolEditProject,
  pixels_list_media: toolListMedia,
  pixels_get_media: toolGetMedia,
  pixels_import_media: toolImportMedia,
  pixels_render_project: toolRenderProject,
}

async function handleTool(serviceUrl, name, args) {
  const handler = TOOL_HANDLERS[name]
  if (!handler) throw new Error(`Unknown tool: ${name}`)
  return handler(serviceUrl, args)
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
