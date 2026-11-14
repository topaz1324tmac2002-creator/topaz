/**
 * 각인(텍스트) — 실제 밴드 곡면을 따라 붙는 텍스트 데칼.
 *
 * 방식: 글리프를 캔버스에 그려 알파맵 + 노말맵을 만들고, 밴드 단면 프로파일에서 뽑은
 * 실제 표면 반경을 따라 휘어진 패치 메쉬에 입힙니다. (원통 투영 + 음각 셰이딩)
 *
 * 참고: 1차 프로토타입은 "형상 차집합(boolean)" 대신 노말맵 음각으로 표현합니다.
 * 실물 주물용 각인 형상은 V1.1에서 manifold-3d 차집합으로 교체할 예정입니다(README 참고).
 */
import * as THREE from 'three'
import type { Vec2 } from './ring'
import type { EngravingParams } from './types'

export interface EngravingBuild {
  geometry: THREE.BufferGeometry
  alphaMap: THREE.CanvasTexture
  normalMap: THREE.CanvasTexture
  /** 각인 텍스트가 차지한 원주 방향 길이 mm */
  arcLengthMm: number
  /** 텍스트가 밴드를 한 바퀴 넘어 잘렸는지 */
  clipped: boolean
  textures: THREE.Texture[]
}

const FONT_STACK =
  '"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** 단면 프로파일에서 특정 축방향 위치(z)의 안쪽/바깥쪽 표면 반경을 찾습니다. */
export function surfaceRadius(profile: Vec2[], axial: number, side: 'inner' | 'outer'): number {
  let best = profile[0]
  let bestD = Infinity
  for (const p of profile) {
    const d = Math.abs(p[1] - axial)
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  if (side === 'outer') {
    // 같은 축방향 근처의 최대 반경을 사용 (돔 프로파일에서 정확히 표면을 따라가도록)
    let maxR = best[0]
    for (const p of profile) {
      if (Math.abs(p[1] - axial) <= 0.35) maxR = Math.max(maxR, p[0])
    }
    return maxR
  }
  let minR = best[0]
  for (const p of profile) {
    if (Math.abs(p[1] - axial) <= 0.35) minR = Math.min(minR, p[0])
  }
  return minR
}

/** 간단한 박스 블러(캔버스 filter 미지원 브라우저 대응) */
function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const r = Math.max(1, Math.round(radius))
  for (let y = 0; y < h; y++) {
    let acc = 0
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / (r * 2 + 1)
      const addX = Math.min(w - 1, x + r + 1)
      const subX = Math.max(0, x - r)
      acc += src[y * w + addX] - src[y * w + subX]
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (r * 2 + 1)
      const addY = Math.min(h - 1, y + r + 1)
      const subY = Math.max(0, y - r)
      acc += tmp[addY * w + x] - tmp[subY * w + x]
    }
  }
  return out
}

export interface EngravingContext {
  profile: Vec2[]
  innerRadiusMm: number
  widthMm: number
  metalColor: number
}

export function buildEngraving(params: EngravingParams, ctx: EngravingContext): EngravingBuild | null {
  const text = params.text.trim()
  if (!params.enabled || text.length === 0) return null

  const hMm = Math.max(0.6, Math.min(3, params.heightMm))
  const axialExtentMm = Math.min(ctx.widthMm * 0.72, hMm * 2.2)
  const side = params.position === 'outer' ? 'outer' : 'inner'

  // 1) 텍스트 폭 측정 (mm)
  const probe = makeCanvas(8, 8).getContext('2d')
  if (!probe) return null
  const probePx = 200
  probe.font = `600 ${probePx}px ${FONT_STACK}`
  const textWidthMm = (probe.measureText(text).width / probePx) * hMm
  const arcMm = textWidthMm + hMm * 1.4

  const nominalRadius = ctx.innerRadiusMm + (side === 'outer' ? ctx.widthMm / 2 : 0)
  let thetaLen = arcMm / Math.max(1, nominalRadius)
  let clipped = false
  if (thetaLen > Math.PI * 1.86) {
    thetaLen = Math.PI * 1.86
    clipped = true
  }

  // 2) 캔버스 크기를 패치 종횡비에 맞춰 글자 왜곡을 없앤다
  const canvasH = 256
  const canvasW = Math.max(256, Math.min(4096, Math.round((canvasH * thetaLen * nominalRadius) / axialExtentMm)))
  const canvas = makeCanvas(canvasW, canvasH)
  const ctx2d = canvas.getContext('2d')
  if (!ctx2d) return null
  ctx2d.clearRect(0, 0, canvasW, canvasH)
  ctx2d.fillStyle = '#ffffff'
  ctx2d.textAlign = 'center'
  ctx2d.textBaseline = 'middle'
  const fontPx = (hMm / axialExtentMm) * canvasH / 0.72
  ctx2d.font = `600 ${fontPx}px ${FONT_STACK}`

  // 자간 살짝 (각인은 조밀한 편이 자연스러움)
  const letterSpacing = -fontPx * 0.01
  let totalW = 0
  const glyphs = [...text]
  for (const g of glyphs) totalW += ctx2d.measureText(g).width + letterSpacing
  let x = (canvasW - totalW) / 2
  for (const g of glyphs) {
    const gw = ctx2d.measureText(g).width
    ctx2d.fillText(g, x + gw / 2, canvasH / 2)
    x += gw + letterSpacing
  }

  // 3) 알파맵 + 노말맵
  const src = ctx2d.getImageData(0, 0, canvasW, canvasH)
  const mask = new Float32Array(canvasW * canvasH)
  for (let i = 0; i < mask.length; i++) mask[i] = src.data[i * 4 + 3] / 255

  const height = boxBlur(mask, canvasW, canvasH, Math.max(1, Math.round(canvasH * 0.02)))
  const normalCanvas = makeCanvas(canvasW, canvasH)
  const nctx = normalCanvas.getContext('2d')
  if (!nctx) return null
  const nimg = nctx.createImageData(canvasW, canvasH)
  const strength = 6
  for (let y = 0; y < canvasH; y++) {
    for (let x2 = 0; x2 < canvasW; x2++) {
      const i = y * canvasW + x2
      const xl = x2 > 0 ? height[i - 1] : height[i]
      const xr = x2 < canvasW - 1 ? height[i + 1] : height[i]
      const yu = y > 0 ? height[i - canvasW] : height[i]
      const yd = y < canvasH - 1 ? height[i + canvasW] : height[i]
      // 음각: 글자 안쪽이 들어가 있으므로 높이의 음의 기울기를 사용
      let nx = (xl - xr) * strength
      let ny = (yu - yd) * strength
      const nz = 1
      const l = Math.hypot(nx, ny, nz) || 1
      nx /= l
      ny /= l
      const o = i * 4
      nimg.data[o] = Math.round((nx * 0.5 + 0.5) * 255)
      nimg.data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      nimg.data[o + 2] = Math.round((nz / l * 0.5 + 0.5) * 255)
      nimg.data[o + 3] = 255
    }
  }
  nctx.putImageData(nimg, 0, 0)

  const alphaTex = new THREE.CanvasTexture(canvas)
  alphaTex.anisotropy = 4
  alphaTex.colorSpace = THREE.NoColorSpace
  const normalTex = new THREE.CanvasTexture(normalCanvas)
  normalTex.anisotropy = 4
  normalTex.colorSpace = THREE.NoColorSpace

  // 4) 밴드 곡면을 따라가는 패치 메쉬
  const segT = 72
  const segA = 8
  const theta0 = Math.PI // 스톤(12시) 반대편
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const offset = side === 'outer' ? 0.04 : -0.04

  for (let i = 0; i <= segT; i++) {
    const t = i / segT
    const theta = theta0 + (t - 0.5) * thetaLen
    const sin = Math.sin(theta)
    const cos = Math.cos(theta)
    for (let j = 0; j <= segA; j++) {
      const v = j / segA
      const axial = (v - 0.5) * axialExtentMm
      const rSurf = surfaceRadius(ctx.profile, axial, side)
      const r = ctx.innerRadiusMm + rSurf + offset
      positions.push(r * sin, r * cos, axial)
      uvs.push(t, v)
    }
  }
  for (let i = 0; i < segT; i++) {
    for (let j = 0; j < segA; j++) {
      const a = i * (segA + 1) + j
      const b = a + segA + 1
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()

  return {
    geometry,
    alphaMap: alphaTex,
    normalMap: normalTex,
    arcLengthMm: thetaLen * nominalRadius,
    clipped,
    textures: [alphaTex, normalTex],
  }
}

/** 각인용 금속 재질(음각 그림자 표현) */
export function makeEngravingMaterial(
  build: EngravingBuild,
  metalColor: number,
  metalness = 1,
): THREE.MeshStandardMaterial {
  const color = new THREE.Color(metalColor).multiplyScalar(0.55)
  return new THREE.MeshStandardMaterial({
    color,
    metalness,
    roughness: 0.42,
    alphaMap: build.alphaMap,
    normalMap: build.normalMap,
    normalScale: new THREE.Vector2(1.1, 1.1),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
}
