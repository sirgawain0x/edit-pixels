import type { LiveLooksStyleFilter } from './types'

const FRAGMENT_HEADER = `#version 300 es
precision mediump float;
in vec2 v_texCoord;
out vec4 outColor;
uniform sampler2D u_image;
uniform vec2 u_resolution;
`

const FRAGMENT_BODIES: Record<LiveLooksStyleFilter, string> = {
  none: `
void main() {
  outColor = texture(u_image, v_texCoord);
}`,
  mono: `
void main() {
  vec4 c = texture(u_image, v_texCoord);
  float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  outColor = vec4(vec3(g), c.a);
}`,
  warm: `
void main() {
  vec4 c = texture(u_image, v_texCoord);
  vec3 warm = c.rgb * vec3(1.12, 1.02, 0.88);
  outColor = vec4(clamp(warm, 0.0, 1.0), c.a);
}`,
  cool: `
void main() {
  vec4 c = texture(u_image, v_texCoord);
  vec3 cool = c.rgb * vec3(0.9, 0.98, 1.15);
  outColor = vec4(clamp(cool, 0.0, 1.0), c.a);
}`,
  highContrast: `
void main() {
  vec4 c = texture(u_image, v_texCoord);
  vec3 x = (c.rgb - 0.5) * 1.55 + 0.5;
  outColor = vec4(clamp(x, 0.0, 1.0), c.a);
}`,
  comic: `
void main() {
  vec4 c = texture(u_image, v_texCoord);
  vec3 x = (c.rgb - 0.5) * 1.8 + 0.5;
  x = floor(x * 6.0) / 6.0;
  outColor = vec4(clamp(x, 0.0, 1.0), c.a);
}`,
  vhs: `
void main() {
  vec2 uv = v_texCoord;
  float scan = sin(uv.y * u_resolution.y * 3.14159) * 0.04;
  vec2 offset = vec2(0.002, 0.0);
  float r = texture(u_image, uv + offset).r;
  float g = texture(u_image, uv).g;
  float b = texture(u_image, uv - offset).b;
  vec3 col = vec3(r, g, b);
  col = col * 1.08 + scan;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`,
}

export function getWebGlFragmentShaderSource(filter: LiveLooksStyleFilter): string {
  return FRAGMENT_HEADER + FRAGMENT_BODIES[filter]
}
