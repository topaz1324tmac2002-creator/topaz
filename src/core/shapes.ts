/**
 * 스톤 윤곽(outline) — 보석 모양별 2D 실루엣과 그 위의 점·법선 계산.
 *
 * 석재 로컬 좌표계: +Y 가 바깥(반지 반경 방향), 거들(girdle) 평면은 XZ.
 *  · x = 긴 축(접선 방향), z = 폭(반지 축 방향)
 *
 * 정규화 규칙 — 모든 윤곽은 "폭(짧은 축)의 반 = 1" 로 맞추고,
 * x 방향 반길이를 aspect(길이 ÷ 폭)로 둡니다. 실제 mm 는 stoneOutlineMm 에서
 * sizeMm / 2 를 x·z 에 똑같이 한 번만 곱합니다(sizeMm = 폭).
 *  · 페어  aspect = 4/3  → 폭:길이 = 3:4
 *  · 마퀴즈 aspect = 2    → 폭:길이 = 1:2
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

/** 2차 베지어 위의 점 */
function quadBezier(p0: Vec2, c: Vec2, p1: Vec2, t: number): Vec2 {
  const w0 = (1 - t) * (1 - t)
  const w1 = 2 * (1 - t) * t
  const w2 = t * t
  return [w0 * p0[0] + w1 * c[0] + w2 * p1[0], w0 * p0[1] + w1 * c[1] + w2 * p1[1]]
}

/**
 * 페어(물방울) — 둥근 몸통 + 뾰족한 팁.
 * 몸통은 반지름 R 인 원호, 팁으로 가는 양쪽 변은 살짝 볼록한 2차 베지어입니다.
 * 폭 반 = 1, 뒤쪽 끝 x = -aspect, 팁 x = +aspect (폭:길이 = 3:4 → aspect = 4/3).
 */
function pear(n: number): Vec2[] {
  const L = stoneShape('pear').aspect
  const R = 1 // 몸통 반지름(= 폭 반)
  const cx = R - L // 몸통 중심: 뒤쪽 끝이 정확히 -L
  const tipX = L
  const d = tipX - cx
  const alpha = Math.acos(R / d) // 중심→팁 방향에서 접점까지의 각
  const arcN = Math.max(14, Math.round(n * 0.55))
  const sideN = Math.max(4, Math.round(n * 0.18))
  const tip: Vec2 = [tipX, 0]
  const aUp: Vec2 = [cx + R * Math.cos(alpha), R * Math.sin(alpha)]
  const aDn: Vec2 = [cx + R * Math.cos(-alpha), R * Math.sin(-alpha)]

  // 팁 쪽 변을 살짝 볼록하게(베지어 제어점을 바깥으로 밀기)
  const bulge = 0.055 * L
  const side = (from: Vec2, to: Vec2, sign: number): Vec2 => {
    const mx = (from[0] + to[0]) / 2
    const mz = (from[1] + to[1]) / 2
    const dx = to[0] - from[0]
    const dz = to[1] - from[1]
    const l = Math.hypot(dx, dz) || 1
    return [mx + (dz / l) * bulge * sign, mz - (dx / l) * bulge * sign]
  }
  const cUp = side(tip, aUp, 1)
  const cDn = side(aDn, tip, 1)

  const pts: Vec2[] = [tip]
  for (let i = 1; i <= sideN; i++) pts.push(quadBezier(tip, cUp, aUp, i / sideN))
  for (let i = 1; i <= arcN; i++) {
    const t = alpha + ((TAU - 2 * alpha) * i) / arcN
    pts.push([cx + R * Math.cos(t), R * Math.sin(t)])
  }
  for (let i = 1; i < sideN; i++) pts.push(quadBezier(aDn, cDn, tip, i / sideN))
  return ensureCCW(pts)
}

/**
 * 마퀴즈 — 양 끝이 뾰족하고 옆면이 볼록한 보트형(두 원호의 교집합).
 * 폭 반 = 1, 팁 x = ±aspect (폭:길이 = 1:2 → aspect = 2).
 */
function marquise(n: number): Vec2[] {
  const a = stoneShape('marquise').aspect
  const b = 1
  const R = (a * a + b * b) / (2 * b)
  const cz = b - R // 원 중심(아래쪽)
  const half = Math.max(12, Math.round(n / 2))
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

/** 에메랄드컷 — 모서리를 깎은 직사각형(스텝 컷). 각 변은 평면을 유지합니다. */
function emerald(n: number): Vec2[] {
  const hx = stoneShape('emerald').aspect
  const hz = 1
  const c = 0.26 // 모서리 깎기(폭 기준)
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
  // 각 변을 균등 분할해 스텝 컷 패싯이 정렬되도록 점을 채웁니다.
  const per = Math.max(3, Math.round(n / 8))
  const out: Vec2[] = []
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

/** 모양별 정규화 윤곽(캐시) — 폭 반 = 1, 긴 축 반길이 = aspect */
export function stoneOutline(shape: StoneShape): Outline {
  const hit = cache.get(shape)
  if (hit) return hit
  const spec = stoneShape(shape)
  let pts: Vec2[]
  switch (shape) {
    case 'round':
      pts = ellipse(1, 1, 64)
      break
    case 'oval':
      pts = ellipse(spec.aspect, 1, 72)
      break
    case 'cabochon':
      pts = ellipse(spec.aspect, 1, 64)
      break
    case 'pear':
      pts = pear(56)
      break
    case 'marquise':
      pts = marquise(64)
      break
    case 'emerald':
      pts = emerald(48)
      break
    default:
      pts = ellipse(1, 1, 64)
  }
  cache.set(shape, pts)
  return pts
}

/**
 * 실제 크기(mm) 윤곽 — sizeMm 는 "폭(짧은 축)" 입니다.
 * 긴 축 = sizeMm × aspect (페어 3:4 → 1.333배, 마퀴즈 1:2 → 2배).
 */
export function stoneOutlineMm(shape: StoneShape, sizeMm: number): Vec2[] {
  const k = sizeMm / 2
  return stoneOutline(shape).map(([x, z]) => [x * k, z * k] as Vec2)
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

/**
 * 윤곽을 바깥 법선 방향으로 d mm 만큼 확장합니다.
 * 뾰족한 팁(페어·마퀴즈)에서도 벽 두께가 일정하도록 마이터(miter) 보정을 넣었습니다:
 * 이웃 두 변이 이루는 절반각 β 에 대해 d / cos β 만큼 밀어냅니다.
 */
export function offsetOutline(points: Outline, d: number, maxMiter = 4): Vec2[] {
  const normals = outlineNormals(points)
  return points.map(([x, z], i) => {
    const n = normals[i]
    // 이 정점에서의 실제 벽 두께(코사인 보정) → 마이터 길이
    const prev = normals[(i - 1 + points.length) % points.length]
    const cosHalf = Math.max(0.25, Math.min(1, n[0] * prev[0] + n[1] * prev[1]))
    const miter = Math.min(maxMiter, 1 / cosHalf)
    return [x + n[0] * d * miter, z + n[1] * d * miter] as Vec2
  })
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

/** 윤곽 면적(부호 없음) */
export function outlineArea(points: Outline): number {
  return Math.abs(signedArea(points))
}

/**
 * 패싯 링용 t 배분 — 호 길이에 곡률 가중을 더합니다.
 * 균등 호 길이로 나누면 페어·마퀴즈의 뾰족한 팁 옆이 긴 현(chord)으로 잘려
 * 팁이 뭉툭해 보이므로, 곡률이 큰 구간(팁·모서리)에 점을 촘촘히 둡니다.
 * 원·타원처럼 곡률이 일정한 윤곽에서는 균등 배분과 같습니다.
 */
export function sampleTs(points: Outline, count: number, bias = 0.6): number[] {
  const n = points.length
  const seg: number[] = []
  let total = 0
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    seg.push(l)
    total += l
  }
  if (total < 1e-9) return Array.from({ length: count }, (_, k) => k / count)
  // 꼭짓점별 회전각(rad)
  const turn: number[] = []
  for (let i = 0; i < n; i++) {
    const p = points[(i - 1 + n) % n]
    const a = points[i]
    const b = points[(i + 1) % n]
    const ax = a[0] - p[0]
    const az = a[1] - p[1]
    const bx = b[0] - a[0]
    const bz = b[1] - a[1]
    const la = Math.hypot(ax, az) || 1
    const lb = Math.hypot(bx, bz) || 1
    const c = Math.max(-1, Math.min(1, (ax * bx + az * bz) / (la * lb)))
    turn.push(Math.acos(c))
  }
  // 구간 가중치 = 길이 × (1 + bias × 그 구간이 감싸는 회전각 / 기준 회전각)
  const ref = Math.PI / 16
  const w: number[] = []
  let wsum = 0
  for (let i = 0; i < n; i++) {
    const t = (turn[i] + turn[(i + 1) % n]) / 2
    const wi = seg[i] * (1 + (bias * Math.min(t, Math.PI / 2)) / ref)
    w.push(wi)
    wsum += wi
  }
  const ts: number[] = []
  for (let k = 0; k < count; k++) {
    const target = (wsum * k) / count
    let acc = 0
    let t = 0
    for (let i = 0; i < n; i++) {
      if (acc + w[i] >= target || i === n - 1) {
        const f = w[i] < 1e-12 ? 0 : (target - acc) / w[i]
        // 가중 위치 → 같은 구간 안의 호 길이 위치
        let arc = 0
        for (let j = 0; j < i; j++) arc += seg[j]
        t = (arc + seg[i] * f) / total
        break
      }
      acc += w[i]
    }
    ts.push(t)
  }
  return ts
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

/**
 * 원점에서 각도 θ 방향으로 윤곽까지의 거리(반지름).
 * 모든 스톤 윤곽은 원점에 대해 별 모양(star-shaped)이므로 교차점이 하나입니다.
 */
export function outlineRadiusAt(points: Outline, theta: number): number {
  const dx = Math.cos(theta)
  const dz = Math.sin(theta)
  let best = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const ex = b[0] - a[0]
    const ez = b[1] - a[1]
    const den = dx * ez - dz * ex
    if (Math.abs(den) < 1e-12) continue
    const t = (a[0] * ez - a[1] * ex) / den // 광선 매개변수
    const u = (a[0] * dz - a[1] * dx) / den // 선분 매개변수
    if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9 && t > best) best = t
  }
  return best
}

/** 윤곽의 x/z 반지름(바운딩 박스) */
export function outlineExtents(points: Outline): { hx: number; hz: number } {
  let hx = 0
  let hz = 0
  for (const [x, z] of points) {
    hx = Math.max(hx, Math.abs(x))
    hz = Math.max(hz, Math.abs(z))
  }
  return { hx, hz }
}
