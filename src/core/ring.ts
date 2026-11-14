/**
 * 파라메트릭 반지 생성기 — 단면 프로파일 → 회전체(revolve) 메쉬.
 *
 * 좌표계
 *  - 반지 고리는 XY 평면에 놓이고, 손가락(반지 축)은 Z축입니다.
 *  - 각도 θ = 0 은 +Y(12시 방향). x = r·sinθ, y = r·cosθ, z = 축방향.
 *  - 단면 프로파일은 [반경방향 오프셋, 축방향 오프셋] 2D 점 목록입니다.
 *
 * 메쉬는 정점을 이어붙인(welded) 인덱스 지오메트리라서 모든 엣지가 정확히 두 면과 만납니다.
 * → STL 내보내기·수밀(watertight) 검사·체적 계산이 실제 값으로 동작합니다.
 */
import * as THREE from 'three'
import type { BandParams, ComfortFit } from './types'
import { COMFORT, ksToInnerDiameter } from './catalog'

export type Vec2 = [number, number]

const EPS = 1e-6

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]]
const mul = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k]
const len = (a: Vec2): number => Math.hypot(a[0], a[1])
const norm = (a: Vec2): Vec2 => {
  const l = len(a)
  return l < EPS ? [0, 0] : [a[0] / l, a[1] / l]
}

/** 2D 폴리곤 모서리를 2차 베지어로 깎아 라운딩합니다. radii[i] 는 i번 정점의 필렛 반경. */
function roundPolygon(points: Vec2[], radii: number[], steps = 4): Vec2[] {
  const n = points.length
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const p = points[i]
    const r = radii[i] ?? 0
    if (r < 0.004) {
      out.push(p)
      continue
    }
    const prev = points[(i - 1 + n) % n]
    const next = points[(i + 1) % n]
    const v1 = sub(prev, p)
    const v2 = sub(next, p)
    const l1 = len(v1)
    const l2 = len(v2)
    if (l1 < EPS || l2 < EPS) {
      out.push(p)
      continue
    }
    const d = Math.min(r, l1 * 0.45, l2 * 0.45)
    const a = add(p, mul(norm(v1), d))
    const b = add(p, mul(norm(v2), d))
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const w0 = (1 - t) * (1 - t)
      const w1 = 2 * (1 - t) * t
      const w2 = t * t
      out.push([w0 * a[0] + w1 * p[0] + w2 * b[0], w0 * a[1] + w1 * p[1] + w2 * b[1]])
    }
  }
  return dedupeLoop(out)
}

function dedupeLoop(points: Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (const p of points) {
    const q = out[out.length - 1]
    if (q && Math.abs(q[0] - p[0]) < 1e-4 && Math.abs(q[1] - p[1]) < 1e-4) continue
    out.push(p)
  }
  const first = out[0]
  const last = out[out.length - 1]
  if (out.length > 2 && Math.abs(first[0] - last[0]) < 1e-4 && Math.abs(first[1] - last[1]) < 1e-4) {
    out.pop()
  }
  return out
}

export function comfortRadius(comfort: ComfortFit, widthMm: number, thicknessMm: number): number {
  const k = COMFORT.find((c) => c.id === comfort)?.k ?? 0
  if (k === 0) return 0
  return k * Math.min(0.45, thicknessMm * 0.35, (widthMm / 2) * 0.3)
}

export interface ProfileResult {
  /** 닫힌 루프(중복점 없음) [반경방향, 축방향] mm */
  points: Vec2[]
  /** 바깥면 최대 반경 오프셋 mm */
  maxRadial: number
  /** 단면적 mm² */
  area: number
}

/** 밴드 파라미터 → 단면 프로파일 2D 루프 */
export function buildProfile(band: BandParams): ProfileResult {
  const hw = band.widthMm / 2
  const t = band.thicknessMm
  const cf = comfortRadius(band.comfort, band.widthMm, band.thicknessMm)

  let points: Vec2[] = []
  let radii: number[] = []

  if (band.profile === 'flat') {
    const rc = Math.min(0.2, t * 0.22, hw * 0.22)
    points = [
      [0, -hw],
      [t, -hw],
      [t, hw],
      [0, hw],
    ]
    radii = [cf, rc, rc, cf]
  } else if (band.profile === 'bevel') {
    const c = Math.min(hw * 0.55, t * 0.5)
    const rc = Math.min(0.12, t * 0.15, hw * 0.15)
    points = [
      [0, -hw],
      [t - c, -hw],
      [t, -hw + c],
      [t, hw - c],
      [t - c, hw],
      [0, hw],
    ]
    radii = [cf, rc, rc, rc, rc, cf]
  } else {
    // dome: 바깥면이 볼록한 기본형.
    // "두께"는 최대 두께(중앙)로 해석하고, 가장자리로 갈수록 얇아집니다(실무 관행).
    const edge = Math.max(0.35, t * 0.55)
    const domeH = Math.min(t - edge, hw * 0.9)
    const N = 16
    const arc: Vec2[] = []
    for (let k = 0; k <= N; k++) {
      const a = hw - (2 * hw * k) / N
      const r = t - domeH + domeH * Math.cos((Math.PI / 2) * (a / hw))
      arc.push([r, a])
    }
    points = [[0, -hw], [0, hw], ...arc]
    radii = points.map((_, i) => {
      if (i === 0 || i === 1) return cf
      if (i === 2 || i === points.length - 1) return Math.min(0.1, t * 0.1)
      return 0
    })
  }

  const rounded = roundPolygon(points, radii, 4)
  const maxRadial = rounded.reduce((m, p) => Math.max(m, p[0]), 0)
  return { points: rounded, maxRadial, area: polygonArea(rounded) }
}

export function polygonArea(points: Vec2[]): number {
  let s = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    s += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(s) / 2
}

/**
 * 단면 프로파일을 Z축(반지 축) 둘레로 회전시켜 닫힌 튜브 메쉬를 만듭니다.
 * 정점 수 = segments × profile.length, 인덱스는 시임(seam)까지 공유합니다.
 */
export function buildTubeGeometry(profile: Vec2[], innerRadius: number, segments: number): THREE.BufferGeometry {
  const P = profile.length
  const S = Math.max(8, Math.round(segments))
  const count = S * P
  const positions = new Float32Array(count * 3)
  const uvs = new Float32Array(count * 2)

  // 프로파일 누적 길이 → v 좌표
  const cum: number[] = [0]
  for (let j = 1; j < P; j++) {
    cum.push(cum[j - 1] + len(sub(profile[j], profile[j - 1])))
  }
  const total = cum[P - 1] || 1

  for (let i = 0; i < S; i++) {
    const theta = (i / S) * Math.PI * 2
    const sin = Math.sin(theta)
    const cos = Math.cos(theta)
    for (let j = 0; j < P; j++) {
      const r = innerRadius + profile[j][0]
      const a = profile[j][1]
      const k = (i * P + j) * 3
      positions[k] = r * sin
      positions[k + 1] = r * cos
      positions[k + 2] = a
      const u = (i / S) * 2
      uvs[(i * P + j) * 2] = u
      uvs[(i * P + j) * 2 + 1] = cum[j] / total
    }
  }

  const indices = new Uint32Array(S * P * 6)
  let n = 0
  for (let i = 0; i < S; i++) {
    const i2 = (i + 1) % S
    for (let j = 0; j < P; j++) {
      const j2 = (j + 1) % P
      const a = i * P + j
      const b = i * P + j2
      const c = i2 * P + j2
      const d = i2 * P + j
      indices[n++] = a
      indices[n++] = b
      indices[n++] = d
      indices[n++] = b
      indices[n++] = c
      indices[n++] = d
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setIndex(new THREE.BufferAttribute(indices, 1))
  ensureOutwardWinding(geo)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

/** 감긴 방향이 뒤집혀 있으면(체적이 음수) 삼각형 순서를 뒤집어 노멀이 바깥을 향하게 합니다. */
function ensureOutwardWinding(geo: THREE.BufferGeometry): void {
  if (signedVolume(geo) >= 0) return
  const idx = geo.getIndex()
  if (!idx) return
  const arr = idx.array as Uint32Array | Uint16Array
  for (let i = 0; i < arr.length; i += 3) {
    const tmp = arr[i + 1]
    arr[i + 1] = arr[i + 2]
    arr[i + 2] = tmp
  }
  idx.needsUpdate = true
}

/** 닫힌 메쉬의 부호 있는 체적(mm³). 법선이 바깥을 향하면 양수. */
export function signedVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!pos) return 0
  const idx = geo.getIndex()
  const p = pos.array as Float32Array
  let vol = 0
  const ax = [0, 0, 0]
  const bx = [0, 0, 0]
  const cx = [0, 0, 0]
  const triCount = idx ? idx.count / 3 : pos.count / 3
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2
    ax[0] = p[i0 * 3]; ax[1] = p[i0 * 3 + 1]; ax[2] = p[i0 * 3 + 2]
    bx[0] = p[i1 * 3]; bx[1] = p[i1 * 3 + 1]; bx[2] = p[i1 * 3 + 2]
    cx[0] = p[i2 * 3]; cx[1] = p[i2 * 3 + 1]; cx[2] = p[i2 * 3 + 2]
    vol +=
      ax[0] * (bx[1] * cx[2] - bx[2] * cx[1]) -
      ax[1] * (bx[0] * cx[2] - bx[2] * cx[0]) +
      ax[2] * (bx[0] * cx[1] - bx[1] * cx[0])
  }
  return vol / 6
}

export function surfaceArea(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const idx = geo.getIndex()
  const p = pos.array as Float32Array
  const triCount = idx ? idx.count / 3 : pos.count / 3
  const get = (i: number): Vec2_3 => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]
  let area = 0
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2
    const a = get(i0)
    const b = get(i1)
    const c = get(i2)
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    area += Math.hypot(nx, ny, nz) / 2
  }
  return area
}

type Vec2_3 = [number, number, number];

export interface RingBuild {
  geometry: THREE.BufferGeometry
  /** 내경 mm */
  innerDiameterMm: number
  innerRadiusMm: number
  /** 바깥 최대 반경 mm */
  outerRadiusMm: number
  /** 단면 최대 두께(바깥 돌출 포함) mm */
  profileMaxRadial: number
  profileAreaMm2: number
  segments: number
  profilePoints: number
}

export function buildRing(band: BandParams): RingBuild {
  const innerDiameterMm = ksToInnerDiameter(band.sizeKR)
  const innerRadiusMm = innerDiameterMm / 2
  const profile = buildProfile(band)
  // 원주 방향 정밀도: 약 0.32mm 간격 (조형 브러시가 먹을 수 있는 밀도 확보)
  const circumference = 2 * Math.PI * innerRadiusMm
  const segments = Math.min(420, Math.max(96, Math.round(circumference / 0.32)))
  const geometry = buildTubeGeometry(profile.points, innerRadiusMm, segments)
  return {
    geometry,
    innerDiameterMm,
    innerRadiusMm,
    outerRadiusMm: innerRadiusMm + profile.maxRadial,
    profileMaxRadial: profile.maxRadial,
    profileAreaMm2: profile.area,
    segments,
    profilePoints: profile.points.length,
  }
}
