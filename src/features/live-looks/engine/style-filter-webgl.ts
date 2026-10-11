import type { LiveLooksStyleFilter } from './types'
import { getWebGlFragmentShaderSource } from './style-filter-webgl-shaders'

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Failed to create shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown'
    gl.deleteShader(shader)
    throw new Error(`Shader compile failed: ${log}`)
  }
  return shader
}

export class WebGlStyleFilterRenderer {
  private readonly gl: WebGL2RenderingContext
  private readonly canvas: HTMLCanvasElement
  private readonly programs = new Map<LiveLooksStyleFilter, WebGLProgram>()
  private readonly vao: WebGLVertexArrayObject
  private readonly texture: WebGLTexture
  private width = 0
  private height = 0

  private constructor(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) {
    this.gl = gl
    this.canvas = canvas

    const buffer = gl.createBuffer()
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    const quad = new Float32Array([-1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0, 1, 1, 1, 0])
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW)
    const locPos = 0
    const locUv = 1
    gl.enableVertexAttribArray(locPos)
    gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(locUv)
    gl.vertexAttribPointer(locUv, 2, gl.FLOAT, false, 16, 8)

    this.texture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  }

  static tryCreate(width: number, height: number): WebGlStyleFilterRenderer | null {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false })
    if (!gl) return null
    try {
      const renderer = new WebGlStyleFilterRenderer(gl, canvas)
      renderer.resize(width, height)
      return renderer
    } catch {
      return null
    }
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
    this.canvas.width = width
    this.canvas.height = height
    this.gl.viewport(0, 0, width, height)
  }

  private programFor(filter: LiveLooksStyleFilter): WebGLProgram {
    const cached = this.programs.get(filter)
    if (cached) return cached
    const vs = compileShader(this.gl, this.gl.VERTEX_SHADER, VERTEX_SHADER)
    const fs = compileShader(
      this.gl,
      this.gl.FRAGMENT_SHADER,
      getWebGlFragmentShaderSource(filter),
    )
    const program = this.gl.createProgram()!
    this.gl.attachShader(program, vs)
    this.gl.attachShader(program, fs)
    this.gl.linkProgram(program)
    this.gl.deleteShader(vs)
    this.gl.deleteShader(fs)
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      throw new Error('Program link failed')
    }
    this.programs.set(filter, program)
    return program
  }

  apply(source: CanvasImageSource, filter: LiveLooksStyleFilter): HTMLCanvasElement {
    const gl = this.gl
    const program = this.programFor(filter)
    gl.useProgram(program)
    gl.bindVertexArray(this.vao)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source as TexImageSource,
    )

    const resLoc = gl.getUniformLocation(program, 'u_resolution')
    if (resLoc) gl.uniform2f(resLoc, this.width, this.height)
    gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0)

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return this.canvas
  }

  dispose(): void {
    for (const program of this.programs.values()) {
      this.gl.deleteProgram(program)
    }
    this.programs.clear()
    this.gl.deleteTexture(this.texture)
    this.gl.deleteVertexArray(this.vao)
  }
}
