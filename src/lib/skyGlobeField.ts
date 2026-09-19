import { skyFocalLength } from './skyGlobe'
import { starAppearanceScale, type RenderStar } from './skyStarField'
import type { SkyView } from './skyProjection'

/** Batches faint stars on the GPU; bright stars retain the detailed canvas treatment. */
export class GlobeStarField {
  private canvas: HTMLCanvasElement | null = null
  private gl: WebGLRenderingContext | null = null
  private program: WebGLProgram | null = null
  private buffer: WebGLBuffer | null = null
  private source: readonly RenderStar[] | null = null
  private count = 0
  private unavailable = false

  private initialize(): boolean {
    if (this.unavailable) return false
    if (this.gl) return !this.gl.isContextLost()
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: false,
    })
    if (!gl) {
      this.unavailable = true
      return false
    }
    const shaders: WebGLShader[] = []
    const compile = (kind: number, source: string) => {
      const shader = gl.createShader(kind)
      if (!shader) throw new Error('Shader unavailable')
      shaders.push(shader)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Shader unavailable')
      return shader
    }
    try {
      const program = gl.createProgram()
      if (!program) throw new Error('Program unavailable')
      this.program = program
      gl.attachShader(
        program,
        compile(
          gl.VERTEX_SHADER,
          `
        attribute vec3 position;
        attribute vec3 color;
        attribute vec2 appearance;
        uniform vec4 camera;
        uniform vec4 viewport;
        uniform vec3 scale;
        varying vec4 tint;
        void main() {
          float forward = position.x * camera.y + position.y * camera.x;
          float depth = forward * camera.w + position.z * camera.z;
          float east = position.x * camera.x - position.y * camera.y;
          float north = position.z * camera.w - forward * camera.z;
          gl_Position = depth > 0.000001 ? vec4(east * viewport.z * 2.0 / viewport.x, north * viewport.z * 2.0 / viewport.y, 0.0, depth) : vec4(2.0, 2.0, 2.0, 1.0);
          float size = appearance.x * scale.x * 2.0 * viewport.w;
          gl_PointSize = max(1.0, size);
          tint = vec4(color, min(1.0, max(scale.z, appearance.y * scale.y)) * min(1.0, size * size));
        }
      `,
        ),
      )
      gl.attachShader(
        program,
        compile(
          gl.FRAGMENT_SHADER,
          `
        precision mediump float;
        varying vec4 tint;
        void main() {
          float radius = length(gl_PointCoord - vec2(0.5));
          gl_FragColor = vec4(tint.rgb, tint.a * (1.0 - smoothstep(0.3, 0.5, radius)));
        }
      `,
        ),
      )
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Program unavailable')
      this.buffer = gl.createBuffer()
      if (!this.buffer) throw new Error('Buffer unavailable')
      this.canvas = canvas
      this.gl = gl
      canvas.addEventListener('webglcontextlost', (event) => event.preventDefault())
      canvas.addEventListener('webglcontextrestored', () => {
        this.dispose()
        this.unavailable = false
      })
      return true
    } catch {
      if (this.program) gl.deleteProgram(this.program)
      this.program = null
      this.unavailable = true
      return false
    } finally {
      for (const shader of shaders) gl.deleteShader(shader)
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    stars: readonly RenderStar[],
    view: SkyView,
    pixelRatio: number,
  ): boolean {
    if (!this.initialize()) return false
    const gl = this.gl!,
      program = this.program!,
      canvas = this.canvas!
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    if (this.source !== stars) {
      const faint = stars.filter((entry) => entry.star.mag >= 6)
      const data = new Float32Array(faint.length * 8)
      faint.forEach((entry, i) => {
        const ra = (entry.ra * Math.PI) / 12,
          dec = (entry.dec * Math.PI) / 180
        const color = Number.parseInt(entry.color.slice(1), 16)
        data.set(
          [
            Math.cos(dec) * Math.cos(ra),
            Math.cos(dec) * Math.sin(ra),
            Math.sin(dec),
            ((color >> 16) & 255) / 255,
            ((color >> 8) & 255) / 255,
            (color & 255) / 255,
            entry.baseRadius,
            entry.baseAlpha,
          ],
          i * 8,
        )
      })
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
      this.source = stars
      this.count = faint.length
    }
    const width = Math.round(view.width * pixelRatio),
      height = Math.round(view.height * pixelRatio)
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    for (const [name, size, offset] of [
      ['position', 3, 0],
      ['color', 3, 12],
      ['appearance', 2, 24],
    ] as const) {
      const location = gl.getAttribLocation(program, name)
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 32, offset)
    }
    const ra = (view.ra * Math.PI) / 12,
      dec = (view.dec * Math.PI) / 180
    gl.uniform4f(
      gl.getUniformLocation(program, 'camera'),
      Math.sin(ra),
      Math.cos(ra),
      Math.sin(dec),
      Math.cos(dec),
    )
    gl.uniform4f(
      gl.getUniformLocation(program, 'viewport'),
      view.width,
      view.height,
      skyFocalLength(view),
      pixelRatio,
    )
    const scale = starAppearanceScale(view.zoom)
    gl.uniform3f(
      gl.getUniformLocation(program, 'scale'),
      scale.radius,
      scale.exposure,
      scale.minAlpha,
    )
    gl.drawArrays(gl.POINTS, 0, this.count)
    ctx.drawImage(canvas, 0, 0, view.width, view.height)
    return true
  }

  dispose(): void {
    if (this.gl) {
      this.gl.deleteBuffer(this.buffer)
      this.gl.deleteProgram(this.program)
    }
    this.gl = null
    this.program = null
    this.buffer = null
    this.canvas = null
    this.source = null
  }
}
