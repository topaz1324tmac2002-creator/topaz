/**
 * 스톤 윤곽(outline) — 보석 모양별 2D 실루엣과 그 위의 점·법선 계산.
 *
 * 석재 로컬 좌표계: +Y 가 바깥(반지 반경 방향), 거들(girdle) 평면은 XZ.
 *  · x = 접선 방향(긴 축), z = 반지 축 방향
 * 윤곽은 x ∈ [-1, 1] 로 정규화하고, z 는 [-1/aspect, 1/aspect] 입니다.
 */
import type { Vec2 } from './ring'
import type { StoneShape } from './types'
import { stoneShape } from './catalog'

/** 폐곡선 윤곽 (x, z) — 반시계(양의 면적) 방향으로 통일 */
export type Outline = Vec2[]

const TAU = Math.PI * 2

function signedArea(pts: Vec2[]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}

function ensureCCW(pts: Vec2[]): Vec2[] {
  return signedArea(pts) < 0 ? [...pts].reverse() : pts
}

/** 원/타원 */
function ellipse(a: number, b: number, n: number): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU
    out.push([Math.cos(t) * a, Math.sin(t) * b])
  }
  return out
}

/**
 * 물방울(페어) — 끝이 뾰족한 (1,0) 과 둥근 몸통.
 * 몸통 원: 중심 (cx,0), 반지름 R. 점 (1,0) 에서 원에 접하는 두 직선으로 이어 붙입니다.
 */
function pear(n: number): Vec2[] {
  const R = 0.62
  const cx = R - 1 // 왼쪽 끝이 정확히 -1 이 되도록
  const tipX = 1
  const d = tipX - cx
  const alpha = Math.acos(R / d) // 중심→점 방향에서 접점까지의 각
  const arcN = Math.max(8, n - 2)
  const pts: Vec2[] = []
  // +alpha 에서 2π-alpha 까지 (π 를 지나며 둥근 몸통)
  for (let i = 0; i <= arcN; i++) {
    const t = alpha + ((TAU - 2 * alpha) * i) / arcN
    pts.push([cx + R * Math.cos(t), R * Math.sin(t)])
  }
  pts.push([tipX, 0])
  const zScale = 1 / (stoneShape('pear').aspect * R)
  return ensureCCW(pts.map(([x, z]) => [x, z * zScale] as Vec2))
}

/** 마퀴즈 — 양 끝이 뾰족한 보트형(두 원호의 교집합) */
function marquise(n: number): Vec2[] {
  const a = 1
  const b = 1 / stoneShape('marquise').aspect
  const R = (a * a + b * b) / (2 * b)
  const cz = b - R // 원 중심(아래쪽)
  const half = Math.max(6, Math.round(n / 2))
  // 왼쪽 끝(-a,0) → 위(0,b) → 오른쪽 끝(+a,0)
  const th0 = Math.atan2(-cz / R, -a / R)
  const th1 = Math.atan2(-cz / R, a / R)
  const upper: Vec2[] = []
  for (let i = 0; i <= half; i++) {
    const t = th0 + ((th1 - th0) * i) / half
    upper.push([Math.cos(t) * R, cz + Math.sin(t) * R])
  }
  const lower: Vec2[] = []
  for (let i = 1; i < half; i++) {
    const t = th1 + ((th0 - th1) * i) / half
    lower.push([Math.cos(t) * R, -cz - Math.sin(t) * R])
  }
  return ensureCCW([...upper, ...lower])
}

/** 에메랄드컷 — 모서리를 깎은 직사각형(스텝 컷). 각 모서리는 평면을 유지합니다. */
function emerald(): Vec2[] {
  const hx = 1
  const hz = 1 / stoneShape('emerald').aspect
  const c = 0.24 // 모서리 깎기
  const corners: Vec2[] = [
    [hx - c, hz],
    [hx, hz - c],
    [hx, -(hz - c)],
    [hx - c, -hz],
    [-(hx - c), -hz],
    [-hx, -(hz - c)],
    [-hx, hz - c],
    [-(hx - c), hz],
  ]
  // 각 변을 6등분해 스텝 컷 패싯이 정렬되도록 점을 채웁니다.
  const out: Vec2[] = []
  const per = 6
  for (let i = 0; i < corners.length; i++) {
    const p = corners[i]
    const q = corners[(i + 1) % corners.length]
    for (let k = 0; k < per; k++) {
      const t = k / per
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
    }
  }
  return ensureCCW(out)
}

const cache = new Map<StoneShape, Outline>()

/** 모양별 정규화 윤곽(캐시) */
export function stoneOutline(shape: StoneShape): Outline {
  const hit = cache.get(shape)
  if (hit) return hit
  const spec = stoneShape(shape)
  let pts: Vec2[]
  switch (shape) {
    case 'round':
      pts = ellipse(1, 1 / spec.aspect, 48)
      break
    case 'oval':
      pts = ellipse(1, 1 / spec.aspect, 56)
      break
    case 'cabochon':
      pts = ellipse(1, 1 / spec.aspect, 48)
      break
    case 'pear':
      pts = pear(44)
      break
    case 'marquise':
      pts = marquise(48)
      break
    case 'emerald':
      pts = emerald()
      break
    default:
      pts = ellipse(1, 1, 48)
  }
  cache.set(shape, pts)
  return pts
}

/** 정규화 윤곽을 (aspect 곱한) 실제 크기로: 긴 축 = sizeMm × aspect */
export function stoneOutlineMm(shape: StoneShape, sizeMm: number): Vec2[] {
  const spec = stoneShape(shape)
  const k = sizeMm / 2
  return stoneOutline(shape).map(([x, z]) => [x * k * spec.aspect, z * k] as Vec2)
}

/** 정규화 윤곽 점을 비율만큼 확대/축소 */
export function scaleOutline(points: Outline, kx: number, kz = kx): Vec2[] {
  return points.map(([x, z]) => [x * kx, z * kz] as Vec2)
}

/** 이웃 변 법선의 평균으로 각 정점의 바깥 법선을 구합니다(반시계 전제). */
export function outlineNormals(points: Outline): Vec2[] {
  const n = points.length
  const edgeNormals: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const len = Math.hypot(dx, dz) || 1
    edgeNormals.push([dz / len, -dx / len])
  }
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const p = edgeNormals[(i - 1 + n) % n]
    const q = edgeNormals[i]
    const x = p[0] + q[0]
    const z = p[1] + q[1]
    const len = Math.hypot(x, z) || 1
    out.push([x / len, z / len])
  }
  return out
}

/** 윤곽을 바깥 법선 방향으로 d mm 만큼 확장합니다. */
export function offsetOutline(points: Outline, d: number): Vec2[] {
  const normals = outlineNormals(points)
  return points.map(([x, z], i) => [x + normals[i][0] * d, z + normals[i][1] * d] as Vec2)
}

export function outlinePerimeter(points: Outline): number {
  let s = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    s += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  return s
}

/** 호 길이 기준 t(0~1) 위치의 윤곽 점과 바깥 법선 */
export function sampleOutline(points: Outline, t: number): { x: number; z: number; nx: number; nz: number } {
  const n = points.length
  const total = outlinePerimeter(points)
  let target = ((t % 1) + 1) % 1
  target *= total
  let acc = 0
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const len = Math.hypot(dx, dz)
    if (acc + len >= target || i === n - 1) {
      const f = len < 1e-9 ? 0 : (target - acc) / len
      const nx = dz / (len || 1)
      const nz = -dx / (len || 1)
      return { x: a[0] + dx * f, z: a[1] + dz * f, nx, nz }
    }
    acc += len
  }
  return { x: points[0][0], z: points[0][1], nx: 1, nz: 0 }
}
