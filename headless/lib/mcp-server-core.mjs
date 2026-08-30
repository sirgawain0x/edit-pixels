import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PACKAGE_VERSION = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
).version

const DEFAULT_FPS = 30
const DEFAULT_WIDTH = 1920
const DEFAULT_HEIGHT = 1080

/* -------------------------------------------------------------------------- */
/* Tool definitions                                                          */
/* -------------------------------------------------------------------------- */

export const TOOLS = [
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
        id: {
          type: 'string',
          description: 'Optional explicit project id (alphanumeric, dashes, underscores)',
        },
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
          description:
            'Edit operations: addText, addClip, addTrack, moveItem, split, trimStart, trimEnd, addEffect, setTransform, removeItems, etc.',
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
        duration: {
          type: 'number',
          description: 'Render duration in seconds (alternative to outSec)',
        },
        audioOnly: { type: 'boolean' },
        outputPath: {
          type: 'string',
          description: 'Absolute output file path (optional; default is a temp file)',
        },
      },
      required: ['projectId'],
    },
  },
]

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

function idempotencyHeaders() {
  return { 'Idempotency-Key': `mcp-${crypto.randomUUID()}` }
}

async function pixelsFetch(serviceUrl, method, route, body, extraHeaders = {}) {
  const init = {
    method,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  }
  if (body) init.body = JSON.stringify(body)
  const response = await fetch(`${serviceUrl}${route}`, init)
  const data = parseBodyText(await response.text())
  if (response.ok) return data
  const error = httpErrorFrom(data, response.status)
  throw new Error(`Pixels ${route} failed: ${error.code} — ${error.message}`)
}

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
  return textResult(
    await pixelsFetch(serviceUrl, 'POST', '/v1/projects', body, idempotencyHeaders()),
  )
}

async function toolUpdateProject(serviceUrl, args) {
  const updates = pickDefined(args, [
    'name',
    'description',
    'width',
    'height',
    'fps',
    'backgroundColor',
  ])
  const body = {
    updates,
    ...pickDefined(args, ['expectedRevision', 'force']),
  }
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
  const extraHeaders = args.persist ? idempotencyHeaders() : {}
  return textResult(
    await pixelsFetch(
      serviceUrl,
      'POST',
      `/v1/projects/${encodeURIComponent(args.projectId)}/edit`,
      body,
      extraHeaders,
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
  const body = {
    file: filePath,
    ...pickDefined({ id: args.mediaId, project: args.projectId }, ['id', 'project']),
  }
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

const RENDER_MIME_EXT = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp4': 'm4a',
}

function parseWarningsHeader(header) {
  if (!header) return undefined
  try {
    return JSON.parse(header)
  } catch {
    return undefined
  }
}

function extensionFromDisposition(contentDisposition) {
  const match = /filename="([^"]+)"/.exec(contentDisposition)
  return match ? path.extname(match[1]).slice(1) : ''
}

function extensionFromMime(contentType) {
  const mime = contentType.split(';')[0].trim().toLowerCase()
  return RENDER_MIME_EXT[mime] ?? ''
}

async function downloadRenderBinary(serviceUrl, body) {
  const response = await fetch(`${serviceUrl}/v1/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const data = parseBodyText(await response.text())
    const error = httpErrorFrom(data, response.status)
    throw new Error(`Render failed: ${error.code} — ${error.message}`)
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? '',
    contentDisposition: response.headers.get('content-disposition') ?? '',
    warnings: parseWarningsHeader(response.headers.get('x-pixels-warnings')),
  }
}

function renderExtension({ container, contentType, contentDisposition }) {
  return (
    container ||
    extensionFromDisposition(contentDisposition) ||
    extensionFromMime(contentType) ||
    'mp4'
  )
}

function defaultRenderOutPath() {
  const outDir = path.join(os.tmpdir(), 'pixels-mcp-outputs')
  fs.mkdirSync(outDir, { recursive: true })
  return path.join(outDir, `render-${process.pid}-${Date.now()}.out`)
}

async function toolRenderProject(serviceUrl, args) {
  let outPath = args.outputPath
  if (!outPath) outPath = defaultRenderOutPath()
  const body = buildRenderBody(args)
  const { buffer, contentType, contentDisposition, warnings } = await downloadRenderBinary(
    serviceUrl,
    body,
  )
  const ext = renderExtension({
    container: args.container,
    contentType,
    contentDisposition,
  })
  const finalPath = `${outPath}.${ext}`
  fs.writeFileSync(finalPath, buffer)
  return textResult({
    ok: true,
    outputPath: finalPath,
    fileSize: buffer.length,
    ...(warnings ? { warnings } : {}),
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
/* Server factory                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Create a configured MCP server instance bound to a running Pixels HTTP service.
 *
 * @param {object} options
 * @param {string} options.serviceUrl - URL of the running headless/serve.mjs instance
 * @param {import('node:child_process').ChildProcess} options.child - spawned service child process
 * @param {(level: string, ...items: unknown[]) => void} [options.logger] - structured logger
 * @param {(name: string, args: Record<string, unknown>, serviceUrl: string, next: () => Promise<unknown>) => Promise<unknown>} [options.onToolCall] - optional tool call middleware
 */
export function createMcpServer({ serviceUrl, child, logger = () => {}, onToolCall }) {
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
    const projects = await pixelsFetch(serviceUrl, 'GET', '/v1/projects').catch(() => ({
      projects: [],
    }))
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
    logger('INFO', 'tool-call', { name, args: toolArgs })
    try {
      const run = async () => handleTool(serviceUrl, name, toolArgs ?? {})
      const result = onToolCall
        ? await onToolCall(name, toolArgs ?? {}, serviceUrl, run)
        : await run()
      logger('INFO', 'tool-result', { name, ok: true })
      return result
    } catch (error) {
      logger('ERROR', 'tool-error', { name, message: error.message })
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      }
    }
  })

  return { server, child }
}

/* -------------------------------------------------------------------------- */
/* Service launcher                                                           */
/* -------------------------------------------------------------------------- */

async function getFreePort() {
  const { createServer } = await import('node:net')
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

export async function startPixelsService({
  repoRoot,
  workspace,
  build = false,
  head = false,
  env = {},
}) {
  const port = await getFreePort()
  const child = spawn(
    'node',
    [
      path.join(repoRoot, 'headless', 'serve.mjs'),
      '--workspace',
      workspace,
      '--port',
      String(port),
      '--host',
      '127.0.0.1',
      ...(build ? ['--build'] : []),
      ...(head ? ['--head'] : []),
    ],
    {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env, PIXELS_MCP_CHILD: '1' },
    },
  )

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8').trim()
    if (text) logger('WARN', 'pixels-stderr', text)
  })
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8').trim()
    if (text) logger('INFO', 'pixels-stdout', text)
  })
  child.on('error', (error) => {
    logger('ERROR', 'pixels-process-error', error.message)
    throw error
  })

  const serviceUrl = `http://127.0.0.1:${port}`
  await waitForHealth(serviceUrl, { timeoutMs: 120_000 })
  logger('INFO', 'pixels-service-ready', { serviceUrl, workspace })
  return { serviceUrl, child }
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

function writeLog(level, items) {
  const line = JSON.stringify({ level, time: new Date().toISOString(), items })
  if (process.env.PIXELS_MCP_LOG) {
    fs.appendFileSync(process.env.PIXELS_MCP_LOG, `${line}\n`)
  }
}

function logger(level, ...items) {
  writeLog(level, items)
}

export function createMcpLogger() {
  return logger
}
