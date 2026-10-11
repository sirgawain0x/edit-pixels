import type { LiveLooksStyleFilter } from './types'

const FILTER_INDEX: Record<LiveLooksStyleFilter, number> = {
  none: 0,
  mono: 1,
  warm: 2,
  cool: 3,
  highContrast: 4,
  comic: 5,
  vhs: 6,
}

const WGSL = `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var pos = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0)
  );
  var uv = array<vec2f, 3>(
    vec2f(0.0, 1.0),
    vec2f(2.0, 1.0),
    vec2f(0.0, -1.0)
  );
  var out: VertexOutput;
  out.position = vec4f(pos[vertexIndex], 0.0, 1.0);
  out.uv = uv[vertexIndex];
  return out;
}

struct Uniforms {
  filterMode: u32,
  width: f32,
  height: f32,
}
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> u: Uniforms;

fn luma(c: vec3f) -> f32 {
  return dot(c, vec3f(0.299, 0.587, 0.114));
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  var c = textureSample(tex, samp, uv);
  switch u.filterMode {
    case 1u: {
      let g = luma(c.rgb);
      return vec4f(g, g, g, c.a);
    }
    case 2u: {
      return vec4f(clamp(c.rgb * vec3f(1.12, 1.02, 0.88), vec3f(0.0), vec3f(1.0)), c.a);
    }
    case 3u: {
      return vec4f(clamp(c.rgb * vec3f(0.9, 0.98, 1.15), vec3f(0.0), vec3f(1.0)), c.a);
    }
    case 4u: {
      let x = (c.rgb - 0.5) * 1.55 + 0.5;
      return vec4f(clamp(x, vec3f(0.0), vec3f(1.0)), c.a);
    }
    case 5u: {
      var x = (c.rgb - 0.5) * 1.8 + 0.5;
      x = floor(x * 6.0) / 6.0;
      return vec4f(clamp(x, vec3f(0.0), vec3f(1.0)), c.a);
    }
    case 6u: {
      let scan = sin(uv.y * u.height * 3.14159) * 0.04;
      let offset = 0.002;
      let r = textureSample(tex, samp, uv + vec2f(offset, 0.0)).r;
      let g = textureSample(tex, samp, uv).g;
      let b = textureSample(tex, samp, uv - vec2f(offset, 0.0)).b;
      var col = vec3f(r, g, b) * 1.08 + scan;
      return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
    }
    default: {
      return c;
    }
  }
}
`

export interface WebGpuStyleFilterRenderer {
  resize(width: number, height: number): void
  apply(source: CanvasImageSource, filter: LiveLooksStyleFilter): HTMLCanvasElement
  dispose(): void
}

interface WebGpuStyleFilterState {
  device: GPUDevice
  context: GPUCanvasContext
  canvas: HTMLCanvasElement
  pipeline: GPURenderPipeline
  sampler: GPUSampler
  uniformBuffer: GPUBuffer
  bindGroupLayout: GPUBindGroupLayout
  sourceTexture: GPUTexture | null
  bindGroup: GPUBindGroup | null
  width: number
  height: number
}

function createGpuResources(device: GPUDevice, format: GPUTextureFormat) {
  const shaderModule = device.createShaderModule({ code: WGSL })
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
    ],
  })
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: { module: shaderModule, entryPoint: 'vs_main', buffers: [] },
    fragment: { module: shaderModule, entryPoint: 'fs_main', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  })
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const uniformBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  return { pipeline, sampler, uniformBuffer, bindGroupLayout }
}

function toGpuUploadSource(
  source: CanvasImageSource,
  width: number,
  height: number,
): HTMLCanvasElement | OffscreenCanvas | ImageBitmap {
  if (
    source instanceof HTMLCanvasElement ||
    source instanceof OffscreenCanvas ||
    source instanceof ImageBitmap
  ) {
    return source
  }
  const scratch = document.createElement('canvas')
  scratch.width = width
  scratch.height = height
  const ctx = scratch.getContext('2d')
  if (!ctx) throw new Error('Failed to prepare WebGPU upload surface')
  ctx.drawImage(source, 0, 0, width, height)
  return scratch
}

function resizeWebGpuStyleFilter(state: WebGpuStyleFilterState, width: number, height: number) {
  state.width = width
  state.height = height
  state.canvas.width = width
  state.canvas.height = height
  state.context.configure({
    device: state.device,
    format: navigator.gpu.getPreferredCanvasFormat(),
    alphaMode: 'opaque',
  })
  state.sourceTexture?.destroy()
  state.sourceTexture = state.device.createTexture({
    size: [width, height],
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  })
  state.bindGroup = state.device.createBindGroup({
    layout: state.bindGroupLayout,
    entries: [
      { binding: 0, resource: state.sampler },
      { binding: 1, resource: state.sourceTexture.createView() },
      { binding: 2, resource: { buffer: state.uniformBuffer } },
    ],
  })
}

function applyWebGpuStyleFilter(
  state: WebGpuStyleFilterState,
  source: CanvasImageSource,
  filter: LiveLooksStyleFilter,
): HTMLCanvasElement {
  if (!state.sourceTexture || !state.bindGroup) {
    resizeWebGpuStyleFilter(state, state.width || 1, state.height || 1)
  }
  const texture = state.sourceTexture!
  const bindGroup = state.bindGroup!
  const uploadSource = toGpuUploadSource(source, state.width, state.height)
  state.device.queue.copyExternalImageToTexture(
    { source: uploadSource },
    { texture },
    [state.width, state.height],
  )
  const uniformData = new ArrayBuffer(16)
  const view = new DataView(uniformData)
  view.setUint32(0, FILTER_INDEX[filter], true)
  view.setFloat32(4, state.width, true)
  view.setFloat32(8, state.height, true)
  state.device.queue.writeBuffer(state.uniformBuffer, 0, uniformData)
  const encoder = state.device.createCommandEncoder()
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: state.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  })
  pass.setPipeline(state.pipeline)
  pass.setBindGroup(0, bindGroup)
  pass.draw(3)
  pass.end()
  state.device.queue.submit([encoder.finish()])
  return state.canvas
}

function disposeWebGpuStyleFilter(state: WebGpuStyleFilterState): void {
  state.sourceTexture?.destroy()
  state.sourceTexture = null
  state.bindGroup = null
  state.uniformBuffer.destroy()
  state.device.destroy()
}

export async function createWebGpuStyleFilterRenderer(
  width: number,
  height: number,
): Promise<WebGpuStyleFilterRenderer | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.gpu) return null
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) return null
    const device = await adapter.requestDevice()
    if (!device) return null
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('webgpu')
    if (!context) return null
    const format = navigator.gpu.getPreferredCanvasFormat()
    context.configure({ device, format, alphaMode: 'opaque' })
    const gpu = createGpuResources(device, format)
    const state: WebGpuStyleFilterState = {
      device,
      context,
      canvas,
      pipeline: gpu.pipeline,
      sampler: gpu.sampler,
      uniformBuffer: gpu.uniformBuffer,
      bindGroupLayout: gpu.bindGroupLayout,
      sourceTexture: null,
      bindGroup: null,
      width: 0,
      height: 0,
    }
    resizeWebGpuStyleFilter(state, width, height)
    return {
      resize: (w, h) => resizeWebGpuStyleFilter(state, w, h),
      apply: (source, filter) => applyWebGpuStyleFilter(state, source, filter),
      dispose: () => disposeWebGpuStyleFilter(state),
    }
  } catch {
    return null
  }
}
