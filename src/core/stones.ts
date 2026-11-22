/**
 * 스톤 & 세팅 생성기 — 보석 형상(브릴리언트/스텝/캐보션) + 세팅 금속부(프롱·V프롱·베젤·헤일로·채널).
 *
 * 스톤 로컬 좌표계: +Y 가 "바깥(반지 반경 방향)", 원점은 거들(girdle) 평면 중심.
 *   x = 긴 축(접선 방향), y = 바깥 방향, z = 폭(반지 축 방향)
 * 반지 위 배치: 각도 θ 위치의 바깥면에 로컬 +Y 가 방사방향을 향하도록 놓습니다.
 *
 * 브릴리언트 컷은 실제 커팅 비례를 따릅니다:
 *   · 테이블 지름 = 폭의 56%
 *   · 크라운 높이 = 폭의 15.5% (거들 위)
 *   · 파빌리온 깊이 = 폭의 43.5% (거들 아래)
 *   · 거들 = 폭의 2.5% (얇은 면 거들)
 *   · 8 카이트(비젤) + 8 스타 + 16 어퍼 거들 + 16 로어 거들 + 8 파빌리온 메인 + 큐렛
 *   · 로어 거들 팁과 스타 팁은 파빌리온·크라운 원뿔면 위에 올려 옆모습이 톱니처럼 튀지 않습니다
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { StoneCut, StoneParams, StoneShape } from './types'
import { stoneShape } from './catalog'
import {
  offsetOutline,
  outlineArea,
  outlineAtAngle,
  outlineNormals,
  outlinePerimeter,
  sampleOutline,
  sampleTs,
  scaleOutline,
  stoneOutline,
  stoneOutlineMm,
  type Outline,
} from './shapes'
import { signedVolume, type Vec2 } from './ring'

export interface MeshPart {
  geometry: THREE.BufferGeometry
  matrix: THREE.Matrix4
}

export interface StoneLayout {
  /** 보석(중량 계산·주물 STL에서 제외) — 메레 스톤 포함 */
  gems: MeshPart[]
  /** 세팅 금속부(프롱·V프롱·베젤·시트·헤일로 갤러리·채널 벽) */
  metals: MeshPart[]
  warnings: string[]
  /** 보석 1개(센터)의 겉보기 외접 지름 mm — 세팅 금속부까지 포함한 접선 방향 폭 */
  stoneFootprintMm: number
  stepDeg: number
  /** 세팅별 실측값(검증·보고용) — 채널이면 channel, 헤일로면 halo, 프롱이면 prongs */
  info: SettingInfo
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/* ── 공통 유틸 ─────────────────────────────────────────────── */

type Ring = { pts: Vec2[]; y: number }
type Tri = [number, number, number]

function outward(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (signedVolume(geo) >= 0) return geo
  const idx = geo.getIndex()
  if (!idx) {
    // 비색인: 삼각형 순서를 직접 뒤집습니다.
    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    for (let i = 0; i < arr.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const t = arr[i + 3 + k]
        arr[i + 3 + k] = arr[i + 6 + k]
        arr[i + 6 + k] = t
      }
    }
    pos.needsUpdate = true
    return geo
  }
  const a = idx.array as Uint16Array | Uint32Array
  for (let i = 0; i < a.length; i += 3) {
    const t = a[i + 1]
    a[i + 1] = a[i + 2]
    a[i + 2] = t
  }
  idx.needsUpdate = true
  return geo
}

/**
 * 정점 목록 + 삼각형 목록 → 수밀하고 법선이 바깥을 향하는 비색인(플랫 셰이딩) 지오메트리.
 * 1) 이웃 삼각형이 공유 엣지를 반대 방향으로 지나가도록 감기를 전파시키고
 * 2) 전체 부피가 양수가 되도록 한 번 더 뒤집습니다.
 */
function facetGeometry(verts: number[], tris: Tri[]): THREE.BufferGeometry {
  const out = tris.map((t) => [t[0], t[1], t[2]] as Tri)
  const edgeKey = (a: number, b: number): string => (a < b ? `${a}_${b}` : `${b}_${a}`)
  const edges = new Map<string, { t: number; dir: number }[]>()
  out.forEach((tri, ti) => {
    for (let k = 0; k < 3; k++) {
      const a = tri[k]
      const b = tri[(k + 1) % 3]
      if (a === b) continue
      const key = edgeKey(a, b)
      const list = edges.get(key) ?? []
      list.push({ t: ti, dir: a < b ? 1 : -1 })
      edges.set(key, list)
    }
  })
  const visited = new Array(out.length).fill(false)
  for (let seed = 0; seed < out.length; seed++) {
    if (visited[seed]) continue
    visited[seed] = true
    const queue = [seed]
    while (queue.length) {
      const ti = queue.pop() as number
      const tri = out[ti]
      for (let k = 0; k < 3; k++) {
        const a = tri[k]
        const b = tri[(k + 1) % 3]
        const dir = a < b ? 1 : -1
        const list = edges.get(edgeKey(a, b)) ?? []
        for (const nb of list) {
          if (nb.t === ti || visited[nb.t]) continue
          if (nb.dir === dir) {
            const n = out[nb.t]
            const swap = n[1]
            n[1] = n[2]
            n[2] = swap
            nb.dir = -nb.dir
          }
          visited[nb.t] = true
          queue.push(nb.t)
        }
      }
    }
  }
  // 부피 부호 확인
  let vol = 0
  for (const tri of out) {
    const p0 = tri[0] * 3
    const p1 = tri[1] * 3
    const p2 = tri[2] * 3
    vol +=
      (verts[p0] * (verts[p1 + 1] * verts[p2 + 2] - verts[p1 + 2] * verts[p2 + 1]) +
        verts[p0 + 1] * (verts[p1 + 2] * verts[p2] - verts[p1] * verts[p2 + 2]) +
        verts[p0 + 2] * (verts[p1] * verts[p2 + 1] - verts[p1 + 1] * verts[p2])) /
      6
  }
  const flip = vol < 0
  const positions = new Float32Array(out.length * 9)
  out.forEach((tri, i) => {
    const order = flip ? [tri[0], tri[2], tri[1]] : tri
    for (let k = 0; k < 3; k++) {
      const p = order[k] * 3
      positions[i * 9 + k * 3] = verts[p]
      positions[i * 9 + k * 3 + 1] = verts[p + 1]
      positions[i * 9 + k * 3 + 2] = verts[p + 2]
    }
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

/**
 * 고리(ring) 목록을 잇는 셸을 만듭니다.
 * rings 는 아래에서 위로 정렬되어 있고 같은 점 개수를 가집니다.
 */
function buildShell(rings: Ring[], opts: { capTop: boolean; culetY?: number | null }): THREE.BufferGeometry {
  const n = rings[0].pts.length
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const ringCount = rings.length

  for (let r = 0; r < ringCount; r++) {
    const { pts, y } = rings[r]
    for (let i = 0; i < n; i++) {
      positions.push(pts[i][0], y, pts[i][1])
      uvs.push(i / n, r / Math.max(1, ringCount - 1))
    }
  }
  for (let r = 0; r < ringCount - 1; r++) {
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n
      const a = r * n + i
      const b = r * n + i2
      const c = (r + 1) * n + i2
      const d = (r + 1) * n + i
      indices.push(a, b, d, b, c, d)
    }
  }
  if (opts.capTop) {
    const top = rings[ringCount - 1]
    const center = top.pts.reduce<Vec2>((acc, p) => [acc[0] + p[0] / n, acc[1] + p[1] / n], [0, 0])
    const centerIdx = positions.length / 3
    positions.push(center[0], top.y, center[1])
    uvs.push(0.5, 1)
    const base = (ringCount - 1) * n
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n
      indices.push(base + i, base + i2, centerIdx)
    }
  }
  if (opts.culetY !== undefined && opts.culetY !== null) {
    const first = rings[0]
    const center = first.pts.reduce<Vec2>((acc, p) => [acc[0] + p[0] / n, acc[1] + p[1] / n], [0, 0])
    const centerIdx = positions.length / 3
    positions.push(center[0], opts.culetY, center[1])
    uvs.push(0.5, 0)
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n
      indices.push(centerIdx, i2, i)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  outward(geo)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

/**
 * 닫힌 금속 띠 — 바닥 링 두 개 + 윗면 링 두 개로 둘러싼 고리.
 * 네 링의 윤곽을 따로 줄 수 있어 윗면을 안쪽으로 좁혀 모따기(챔퍼)를 만들 수 있습니다.
 */
function buildBand(
  innerBottom: Outline,
  outerBottom: Outline,
  outerTop: Outline,
  innerTop: Outline,
  yBottom: number,
  yTop: number,
): THREE.BufferGeometry {
  // 안쪽 벽 → 바닥 → 바깥 벽 → 윗면 → 다시 안쪽 벽으로 닫는 고리(토러스) 형상
  const rings: Ring[] = [
    { pts: innerBottom, y: yBottom },
    { pts: outerBottom, y: yBottom },
    { pts: outerTop, y: yTop },
    { pts: innerTop, y: yTop },
  ]
  const n = innerBottom.length
  const positions: number[] = []
  const indices: number[] = []
  for (let r = 0; r < 4; r++) {
    for (let i = 0; i < n; i++) {
      positions.push(rings[r].pts[i][0], rings[r].y, rings[r].pts[i][1])
    }
  }
  for (let r = 0; r < 4; r++) {
    const r2 = (r + 1) % 4
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n
      const a = r * n + i
      const b = r * n + i2
      const c = r2 * n + i2
      const d = r2 * n + i
      indices.push(a, b, d, b, c, d)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  outward(geo)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}


/* ── 보석 형상 ─────────────────────────────────────────────── */

/**
 * 브릴리언트 컷 — 실제 비율의 크라운·거들·파빌리온.
 *
 *  · 테이블 = 폭의 56%, 크라운 높이 = 폭의 15.5%, 파빌리온 깊이 = 폭의 43.5%
 *  · 거들 = 폭의 2.4% (얇은 면 거들)
 *  · 거들 둘레 16점: 짝수 = 카이트(비젤) 8개, 홉수 = 스타·어퍼/로어 거들 방향
 *  · 로어 거들 팁은 파빌리온 원뿔면 위에 놓아, 옆에서 봐도 톱니처럼 튀어나오지 않습니다.
 *  · 링 분배는 sampleTs(곡률 가중) — 페어·마퀴즈 팁이 뭉툭해지지 않습니다.
 */
function brilliant(outline: Outline, sizeMm: number): THREE.BufferGeometry {
  const N = 16
  const M = N / 2
  const size = sizeMm
  const girdle = Math.max(0.04, size * 0.024)
  const crownH = size * 0.155
  const pavH = size * 0.435
  const tableK = 0.56
  const starK = 0.79
  const starH = crownH * 0.52
  // 로어 거들 팁 깊이(파빌리온 깊이 대분) — 원뿔면과 같은 반지름에 놓습니다.
  const lowerFrac = 0.68
  const lowerK = 1 - lowerFrac + 0.02
  const lowerY = -(girdle / 2 + pavH * lowerFrac)

  const verts: number[] = []
  const at = (x: number, y: number, z: number): number => verts.push(x, y, z) / 3 - 1

  const ts = sampleTs(outline, N)
  const girdleTop: number[] = []
  const girdleBot: number[] = []
  const table: number[] = []
  const star: number[] = []
  const lower: number[] = []
  for (let i = 0; i < N; i++) {
    const s = sampleOutline(outline, ts[i])
    girdleBot.push(at(s.x, -girdle / 2, s.z))
    girdleTop.push(at(s.x, girdle / 2, s.z))
  }
  for (let m = 0; m < M; m++) {
    const s = sampleOutline(outline, ts[2 * m])
    table.push(at(s.x * tableK, crownH, s.z * tableK))
  }
  for (let m = 0; m < M; m++) {
    const s = sampleOutline(outline, ts[2 * m + 1])
    star.push(at(s.x * starK, girdle / 2 + starH, s.z * starK))
    lower.push(at(s.x * lowerK, lowerY, s.z * lowerK))
  }
  const culet = at(0, -(girdle / 2 + pavH), 0)

  const tris: Tri[] = []
  const tri = (a: number, b: number, c: number): void => {
    tris.push([a, b, c])
  }
  const quad = (a: number, b: number, c: number, d: number): void => {
    tris.push([a, b, c])
    tris.push([a, c, d])
  }

  // 테이블(팔각형 — 크라운 꼭대기 평면)
  for (let m = 1; m < M - 1; m++) tri(table[0], table[m], table[m + 1])
  // 카이트(비젤) + 스타
  for (let m = 0; m < M; m++) {
    const next = (m + 1) % M
    const prev = (m - 1 + M) % M
    void next
    quad(table[m], star[m], girdleTop[2 * m], star[prev])
    tri(table[m], table[next], star[m])
  }
  // 어퍼 거들(16) — 거들 한 칸 + 스타 아래 삼각
  for (let m = 0; m < M; m++) {
    const i0 = 2 * m
    const i1 = 2 * m + 1
    const i2 = (2 * m + 2) % N
    tri(girdleTop[i0], girdleTop[i1], star[m])
    tri(girdleTop[i1], girdleTop[i2], star[m])
  }
  // 얇은 거들 띠
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N
    quad(girdleTop[i], girdleTop[j], girdleBot[j], girdleBot[i])
  }
  // 파빌리온 메인(8) + 로어 거들(16)
  for (let m = 0; m < M; m++) {
    const prev = (m - 1 + M) % M
    quad(girdleBot[2 * m], lower[m], culet, lower[prev])
    tri(girdleBot[2 * m], girdleBot[2 * m + 1], lower[m])
    tri(girdleBot[2 * m + 1], girdleBot[(2 * m + 2) % N], lower[m])
  }
  return facetGeometry(verts, tris)
}

/** 스텝 컷(에메랄드) — 계단형 사각 패싯 */
function stepCut(outline: Outline, sizeMm: number): THREE.BufferGeometry {
  const girdle = Math.max(0.05, sizeMm * 0.028)
  const crownH = sizeMm * 0.17
  const pavH = sizeMm * 0.43
  const k = (f: number): Vec2[] => outline.map(([x, z]) => [x * f, z * f] as Vec2)
  const rings: Ring[] = [
    { pts: k(0.52), y: -pavH * 0.55 },
    { pts: k(0.74), y: -pavH * 0.26 },
    { pts: k(0.93), y: -pavH * 0.07 },
    { pts: k(1), y: -girdle / 2 },
    { pts: k(1), y: girdle / 2 },
    { pts: k(0.94), y: crownH * 0.34 },
    { pts: k(0.85), y: crownH * 0.68 },
    { pts: k(0.76), y: crownH },
  ]
  const geo = buildShell(rings, { capTop: true, culetY: -pavH })
  const flat = geo.toNonIndexed()
  flat.computeVertexNormals()
  flat.computeBoundingSphere()
  return flat
}

/** 캐보션 — 패싯 없는 매끈한 돔 + 평평한 바닥 */
function cabochon(outline: Outline, sizeMm: number): THREE.BufferGeometry {
  const domeH = sizeMm * 0.42
  const baseH = sizeMm * 0.12
  const scales = [0.985, 0.955, 0.9, 0.82, 0.7, 0.55, 0.36, 0.14]
  const rings: Ring[] = [
    { pts: outline.map(([x, z]) => [x * 0.95, z * 0.95] as Vec2), y: -baseH },
    { pts: outline.map(([x, z]) => [x, z] as Vec2), y: 0 },
  ]
  for (const s of scales) {
    const y = domeH * Math.sqrt(Math.max(0, 1 - s * s))
    rings.push({ pts: outline.map(([x, z]) => [x * s, z * s] as Vec2), y })
  }
  const geo = buildShell(rings, { capTop: true, culetY: -baseH })
  geo.computeVertexNormals() // 매끈한 곡면 — 색인 유지
  geo.computeBoundingSphere()
  return geo
}

export function buildGemGeometry(shape: StoneShape, sizeMm: number): THREE.BufferGeometry {
  const outline = stoneOutlineMm(shape, sizeMm)
  const cut = stoneShape(shape).cut
  if (cut === 'step') return stepCut(outline, sizeMm)
  if (cut === 'cabochon') return cabochon(outline, sizeMm)
  return brilliant(outline, sizeMm)
}

/** 메레(작은 보석) — 항상 라운드 브릴리언트 */
export function buildMeleeGeometry(sizeMm: number): THREE.BufferGeometry {
  return brilliant(stoneOutlineMm('round', sizeMm), sizeMm)
}

/* ── 세팅 금속부 ───────────────────────────────────────────── */

/** 로컬 좌표에 놓인 부품 — 반지 좌표로 옮길 때 각 부품의 접선 오프셋·기울기까지 반영합니다. */
interface Placed {
  geometry: THREE.BufferGeometry
  x: number
  y: number
  z: number
  /** 스톤 로컬 기준 추가 회전(메레 스톤 기울기 등) */
  rot?: THREE.Matrix4
}

/** 뾰족한 끝(팁) 지점 — 윤곽의 ±x 극점. 각이등분 법선과 호길이 t 를 함께 돌려줍니다. */
interface TipSite {
  t: number
  x: number
  z: number
  nx: number
  nz: number
}

/**
 * 팁 후보 — 윤곽의 x 극점 두 곳(긴 축 양 끝).
 * 정점을 그대로 쓰므로 페어·마퀴즈의 뾰족한 꼭짓점에서 정확히 시작합니다.
 * (sampleOutline 은 꼭짓점 대신 변의 법선을 주므로 팁에서는 각이등분 법선이 아닙니다.)
 */
function tipSites(outline: Outline): TipSite[] {
  const normals = outlineNormals(outline)
  const n = outline.length
  const cum: number[] = [0]
  for (let i = 0; i < n; i++) {
    const a = outline[i]
    const b = outline[(i + 1) % n]
    cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  const per = cum[n] || 1
  let hi = 0
  let lo = 0
  for (let i = 1; i < n; i++) {
    if (outline[i][0] > outline[hi][0]) hi = i
    if (outline[i][0] < outline[lo][0]) lo = i
  }
  const at = (i: number): TipSite => ({
    t: cum[i] / per,
    x: outline[i][0],
    z: outline[i][1],
    nx: normals[i][0],
    nz: normals[i][1],
  })
  return [at(hi), at(lo)]
}

/** 모양별 팁 — 페어는 뾰족한 +x 한 곳, 마퀴즈는 양 끝 두 곳 */
function tipSitesFor(shape: StoneShape, outline: Outline): TipSite[] {
  if (shape === 'pear') return [tipSites(outline)[0]]
  if (shape === 'marquise') return tipSites(outline)
  return []
}

/* ── 프롱(발) ─────────────────────────────────────────────── */

/**
 * 크라운 반지름 비율 — 거들면(y=0)에서 테이블로 올라가며 윤곽 반지름이 줄어드는 정도.
 *  · 브릴리언트: 거들 1.0 → 스타(52% 높이) 0.79 → 테이블 0.56
 *  · 스텝: 거들 1.0 → 테이블 0.76
 *  · 캐보션: 돔(높이 42%)
 */
function crownFactor(cut: StoneCut, y: number, sizeMm: number): number {
  if (y <= 0) return 1
  if (cut === 'step') return 1 - 0.24 * Math.min(1, y / (sizeMm * 0.17))
  if (cut === 'cabochon') {
    const t = Math.min(1, y / (sizeMm * 0.42))
    return Math.sqrt(Math.max(0, 1 - t * t))
  }
  const h = sizeMm * 0.155
  const star = h * 0.52
  if (y >= h) return 0.56
  if (y <= star) return 1 - 0.21 * (y / star)
  return 0.79 - 0.23 * ((y - star) / (h - star))
}

/** 스톤 높이별 크라운 높이(mm) */
function crownHeight(cut: StoneCut, sizeMm: number): number {
  return sizeMm * (cut === 'step' ? 0.17 : cut === 'cabochon' ? 0.42 : 0.155)
}

/**
 * 곡선을 따라 굵기가 변하는 관 — 프롱 몸통.
 * 스테이션은 (x=바깥, y=높이) 평면 위 중심선이고, 단면은 그 접선에 수직인 원입니다.
 * 끝은 반구(돔)로 닫아 둥근 클로 발톱이 됩니다.
 */
function tubeAlong(stations: { x: number; y: number; r: number }[], segs: number): THREE.BufferGeometry {
  const n = stations.length
  const pos: number[] = []
  const idx: number[] = []
  const frame = (i: number): { cx: number; cy: number; r: number; nx: number; ny: number } => {
    const a = stations[Math.max(0, i - 1)]
    const b = stations[Math.min(n - 1, i + 1)]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const l = Math.hypot(dx, dy) || 1
    // 단면이 놓이는 면의 두 축: z 축과, 중심선 접선에 수직인 평면 내 축
    return { cx: stations[i].x, cy: stations[i].y, r: stations[i].r, nx: dy / l, ny: -dx / l }
  }
  const pushRing = (cx: number, cy: number, r: number, nx: number, ny: number): void => {
    for (let k = 0; k < segs; k++) {
      const th = (k / segs) * Math.PI * 2
      const c = Math.cos(th) * r
      const s = Math.sin(th) * r
      pos.push(cx + nx * c, cy + ny * c, s)
    }
  }
  for (let i = 0; i < n; i++) {
    const f = frame(i)
    pushRing(f.cx, f.cy, f.r, f.nx, f.ny)
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < segs; k++) {
      const k2 = (k + 1) % segs
      const a = i * segs + k
      const b = i * segs + k2
      const c = (i + 1) * segs + k2
      const d = (i + 1) * segs + k
      idx.push(a, b, d, b, c, d)
    }
  }
  // 밑동 캡(시트 속에 묻히는 면)
  const base = frame(0)
  const b0 = pos.length / 3
  pos.push(base.cx, base.cy, 0)
  for (let k = 0; k < segs; k++) idx.push(b0, (k + 1) % segs, k)
  // 발톱 끝 돔 — 중심선 방향으로 반구를 닫습니다.
  const end = frame(n - 1)
  const dx = end.cx - stations[n - 2].x
  const dy = end.cy - stations[n - 2].y
  const dl = Math.hypot(dx, dy) || 1
  const tx = dx / dl
  const ty = dy / dl
  const last = (n - 1) * segs
  const domeSteps = [0.5, 0.84, 0.975]
  const domeRad = [0.866, 0.54, 0.22]
  let prev = last
  for (let d = 0; d < domeSteps.length; d++) {
    const rr = end.r * domeRad[d]
    const start = pos.length / 3
    pushRing(end.cx + tx * end.r * domeSteps[d], end.cy + ty * end.r * domeSteps[d], rr, end.nx, end.ny)
    for (let k = 0; k < segs; k++) {
      const k2 = (k + 1) % segs
      idx.push(prev + k, prev + k2, start + k, prev + k2, start + k2, start + k)
    }
    prev = start
  }
  const tipIdx = pos.length / 3
  pos.push(end.cx + tx * end.r, end.cy + ty * end.r, 0)
  for (let k = 0; k < segs; k++) idx.push(prev + k, prev + ((k + 1) % segs), tipIdx)

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  outward(geo)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

/**
 * V 프롱 — 뾰족한 팁을 감싸는 단일 V자 쐐기 케이프.
 *
 *  · 팁 양쪽 숄더를 따라가는 **사각 단면 리본 하나**를 닫힌 셸 하나로 만듭니다.
 *    단면은 (안쪽 아래 → 바깥 아래 → 바깥 위 → 안쪽 위) 네 점이고, 스테이션 사이를 이어 붙입니다.
 *    두 봉을 따로 세워 팁 앞에서 X자로 겹치던 예전 방식과 달리 꼭짓점에서 매끈하게 이어집니다.
 *  · 아래는 바스켓 플레이트에 살짝 박히고, 위는 꼭짓점이 가장 높은 V자 윗면입니다.
 *  · 윗면은 크라운이 좁아지는 만큼 조금만 안쪽으로 기울여, 팁 거들을 감싸며 물게 합니다.
 */
function buildVProng(
  outline: Outline,
  tip: TipSite,
  sizeMm: number,
  prongMm: number,
  cut: StoneCut,
  yPlate: number,
): THREE.BufferGeometry {
  const pw = prongMm
  const per = outlinePerimeter(outline)
  const armMm = clamp(sizeMm * 0.16, 0.45, 1.3)
  const step = armMm / per
  const thick = pw * 0.42
  const cH = crownHeight(cut, sizeMm)
  const yApex = Math.max(yPlate + sizeMm * 0.05, cH * 0.3)
  const yBottom = yPlate - sizeMm * 0.025
  const N = 15
  const eps = 1e-4

  // 꼭짓점의 마이터 — 양옆 법선이 이루는 각의 코사인 보정
  const side = sampleOutline(outline, tip.t - eps)
  const miter = Math.min(1.05, 1 / Math.max(0.35, tip.nx * side.nx + tip.nz * side.nz))

  interface St {
    x: number
    z: number
    nx: number
    nz: number
    off: number
    yTop: number
    proj: number
  }
  const st: St[] = []
  for (let j = 0; j < N; j++) {
    const u = -1 + (2 * j) / (N - 1)
    const s = Math.abs(u)
    let x: number
    let z: number
    let nx: number
    let nz: number
    let mi: number
    if (j * 2 === N - 1) {
      x = tip.x
      z = tip.z
      nx = tip.nx
      nz = tip.nz
      mi = miter
    } else {
      const q = sampleOutline(outline, tip.t + u * step)
      x = q.x
      z = q.z
      nx = q.nx
      nz = q.nz
      mi = 1
    }
    // V 윗면 — 꼭짓점이 가장 높고 숄더 끝에서 플레이트 윗면까지 내려옵니다.
    const yTop = yApex + (yPlate - yApex) * Math.pow(s, 1.5)
    const proj = Math.max(0, x * nx + z * nz)
    st.push({ x, z, nx, nz, off: thick * mi, yTop, proj })
  }

  const pos: number[] = []
  const idx: number[] = []
  for (const q of st) {
    // 안쪽 면이 팁 크라운을 따라가도록 높이에 따라 조금씩 안쪽으로
    const leanTop = (1 - crownFactor(cut, q.yTop, sizeMm)) * q.proj * 0.9
    pos.push(q.x, yBottom, q.z)
    pos.push(q.x + q.nx * q.off, yBottom, q.z + q.nz * q.off)
    pos.push(q.x + q.nx * (q.off - leanTop), q.yTop, q.z + q.nz * (q.off - leanTop))
    pos.push(q.x - q.nx * leanTop, q.yTop, q.z - q.nz * leanTop)
  }
  // 단면 4점을 따라가는 사각 관 — 스테이션 사이 4면
  for (let j = 0; j < N - 1; j++) {
    const a = j * 4
    const b = (j + 1) * 4
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4
      idx.push(a + k, a + k2, b + k, a + k2, b + k2, b + k)
    }
  }
  // 양 끝 단면 캡
  const last = (N - 1) * 4
  idx.push(0, 1, 2, 0, 2, 3)
  idx.push(last, last + 1, last + 2, last, last + 2, last + 3)

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  outward(geo)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

/**
 * 프롱(발) — 시트/갤러리에서 매끈한 둥근 기둥이 올라와, 윗부분이 부드럽게 안쪽으로
 * 기울며 둥근 돔(반구) 끝으로 거들 가장자리를 눌러 잡는 **라운드 볼 프롱**.
 * 로컬 프레임: +x = 바깥(스톤 중심 반대), +y = 크라운 높이, +z = 접선. 원점은 거들 윤곽 위.
 *
 *  · 기둥은 굽은 곳 없이 매끈하게 이어지고(중간이 살짝 불룩), 끝은 반구 캡슐로 닫힙니다.
 *  · 볼 중심을 거들 가장자리에서 0.26×프롱지름만큼 바깥에 두어, 볼 안쪽 면이 거들을
 *    0.12×프롱지름 파고들며 물게 합니다 — 볼이 스톤 모서리에 딱 붙어 잡습니다.
 *  · 볼 꼭대기는 크라운 높이의 0.45 이하 — 테이블을 가리지 않습니다.
 */
function prongGeometry(
  sizeMm: number,
  prongMm: number,
  cut: StoneCut,
  yBase: number,
): THREE.BufferGeometry {
  const pw = prongMm
  const cH = crownHeight(cut, sizeMm)
  const rBall = pw * 0.43
  const yBall = cH * 0.05
  const xBall = rBall * 0.66
  const xPost = pw * 0.34
  const xB = xPost - pw * 0.5
  const yPost = -cH * 0.3
  const stations = [
    { x: xB, y: yBase, r: pw * 0.44 },
    { x: xB + (xPost - xB) * 0.5, y: yBase + (yPost - yBase) * 0.32, r: pw * 0.43 },
    { x: xPost, y: yPost, r: pw * 0.4 },
    { x: xPost * 1.04, y: -cH * 0.12, r: pw * 0.33 },
    { x: xBall * 1.03, y: yBall - rBall * 0.78, r: rBall * 0.9 },
    { x: xBall, y: yBall, r: rBall },
  ]
  return tubeAlong(stations, 18)
}

export interface ProngInfo {
  /** 프롱이 놓인 방향(도) — 스톤 로컬 +x(접선) 기준, 90°가 폭 방향 */
  anglesDeg: number[]
  /** 팁 V 프롱 수 */
  vProngs: number
  /** 발톱 끝이 거들 윤곽보다 들어간 깊이(mm) */
  tipInsetMm: number
  /** 발 기둥이 거들 바로 밖으로 나간 거리(mm) */
  baseOffsetMm: number
  /** 발 밑동 높이(mm, 거들면 기준) */
  baseY: number
  /** 이웃 스톤을 향한 발의 최대 접선 반경(mm) */
  extentMm: number
}

/** 프롱 배치 — 뾰족한 모양은 팁에 V 프롱, 나머지는 각도(극좌표)로 배치 */
function buildProngParts(
  params: StoneParams,
  outline: Outline,
  opts: { multi: boolean; yBase: number; cut: StoneCut; yPlate: number },
): { parts: Placed[]; info: ProngInfo } {
  const shape = params.shape
  const n = params.setting === 'prong6' ? 6 : 4
  const pw = params.prongMm
  const size = params.sizeMm
  const parts: Placed[] = []

  // 팁 V 프롱 — 페어 1개, 마퀴즈 2개
  const tips = tipSitesFor(shape, outline)
  for (const tip of tips) {
    parts.push({ geometry: buildVProng(outline, tip, size, pw, opts.cut, opts.yPlate), x: 0, y: 0, z: 0 })
  }

  const anglesDeg: number[] = []
  const shoulderT: number[] = []
  if (opts.multi) {
    // 다석 — 이웃 스톤과 마주보는 접선 축(0°/180°)을 비우고 폭 방향에 발을 세웁니다.
    // (양옆 스톤의 발과 부딪히지 않도록 60°~120° 구간에만 배치)
    anglesDeg.push(...(n === 6 ? [60, 90, 120, 240, 270, 300] : [60, 120, 240, 300]))
  } else if (tips.length > 0) {
    // 페어·마퀴즈 단석 — 팁은 V 프롱이 잡고, 나머지는 숄더에 같은 간격으로.
    // 페어의 가장 넓은 곳은 긴 축에서 28% 지점, 마퀴즈는 25% 지점입니다(호 길이 기준).
    if (shape === 'pear') shoulderT.push(...(n === 6 ? [0.2, 0.8, 0.35, 0.65, 0.5] : [0.28, 0.72, 0.5]))
    else shoulderT.push(...(n === 6 ? [0.16, 0.34, 0.66, 0.84] : [0.25, 0.75]))
  } else {
    // 단석 — 고른 부채꼴 배치 (4발 45°, 6발 30° 위상)
    for (let k = 0; k < n; k++) anglesDeg.push((360 / n) * k + 360 / (2 * n))
  }

  const targets: { x: number; z: number; nx: number; nz: number }[] = []
  for (const a of anglesDeg) targets.push(outlineAtAngle(outline, (a * Math.PI) / 180))
  for (const t of shoulderT) targets.push(sampleOutline(outline, t))

  // 모든 발은 같은 형상입니다(방향만 회전) — 지오메트리 하나를 공유합니다.
  const geo = prongGeometry(size, pw, opts.cut, opts.yBase)
  let extent = 0
  const tipInset = pw * 0.42 * 0.32
  for (const s of targets) {
    const rot = new THREE.Matrix4().makeRotationY(Math.atan2(-s.nz, s.nx))
    const part: Placed = { geometry: geo, x: s.x, y: 0, z: s.z, rot }
    parts.push(part)
    // 발은 거들 윤곽 바로 밖(0.45×프롱 지름)에 서므로, 접선 최대치는 그 위치 + 발 반지름입니다.
    extent = Math.max(extent, Math.abs(s.x) + pw * 0.95)
  }

  return {
    parts,
    info: {
      anglesDeg,
      vProngs: tips.length,
      tipInsetMm: tipInset,
      baseOffsetMm: pw * 0.45,
      baseY: opts.yBase,
      extentMm: extent,
    },
  }
}

/** 스톤 아래 시트(받침) — 밴드와 스톤을 연결하는 닫힌 금속 블록.
 *  topOutline(있으면) 을 윗면으로 삼아 헤일로 레일·베젤 벽 밑면과 맞닿습니다.
 */
function buildSeat(
  outline: Outline,
  sizeMm: number,
  yTop = -sizeMm * 0.05,
  topOutline?: Outline,
  depth = 0.42,
): THREE.BufferGeometry {
  const top = topOutline ?? scaleOutline(outline, 0.86)
  const rings: Ring[] = [
    { pts: scaleOutline(top, 0.5), y: yTop - sizeMm * depth },
    { pts: scaleOutline(top, 0.86), y: yTop - sizeMm * 0.12 },
    { pts: top, y: yTop },
  ]
  return buildShell(rings, { capTop: true, culetY: yTop - sizeMm * depth * 1.15 })
}

/**
 * 프롱 바스켓 — 스톤 윤곽을 살짝 넓혀 따라가는 플레이트(윗면)와, 파빌리온을 감싸며
 * 아래로 좁아지는 짧은 벽. 프롱은 이 플레이트 테두리에서 자라 올라옵니다.
 * 플레이트 테두리를 프롱 바깥면보다 안쪽에 두어, 옆에서 봐도 프롱이 실루엣의 가장 바깥입니다.
 */
function buildBasket(outline: Outline, sizeMm: number, prongMm: number, yTop: number): THREE.BufferGeometry {
  const rings: Ring[] = [
    { pts: scaleOutline(outline, 0.42), y: yTop - sizeMm * 0.4 },
    { pts: offsetOutline(outline, prongMm * 0.06, 1.6), y: yTop - sizeMm * 0.24 },
    { pts: offsetOutline(outline, prongMm * 0.26, 2), y: yTop - sizeMm * 0.1 },
    { pts: offsetOutline(outline, prongMm * 0.18, 2.2), y: yTop - sizeMm * 0.035 },
    { pts: offsetOutline(outline, prongMm * 0.2, 2.2), y: yTop },
  ]
  return buildShell(rings, { capTop: true, culetY: yTop - sizeMm * 0.46 })
}

/** 헤일로 메레 지름 (mm) — 센터 스톤 폭의 20% 안팎, 일반적인 헤일로 메레 비례 */
export function haloMelee(sizeMm: number): number {
  return clamp(sizeMm * 0.2, 0.8, 1.5)
}

/** 헤일로가 센터 스톤 바깥으로 더 차지하는 반지름(mm) */
export function haloExtentMm(sizeMm: number): number {
  return haloMelee(sizeMm) * 0.96 + 0.04
}

export interface HaloInfo {
  meleeMm: number
  meleeCount: number
  /** 메레 중심 고리가 센터 스톤 윤곽에서 나간 거리(mm) */
  meleeOffsetMm: number
  /** 비드 중심이 메레 중심보다 바깥으로 나간 거리(mm) */
  beadOffsetMm: number
  beadRadiusMm: number
  /** 레일 윗면 높이(mm, 거들면 기준) */
  railTopY: number
}

/**
 * 헤일로 — 센터 스톤 윤곽을 그대로 따라가는 섬세한 파베 링.
 *  · 센터 스톤 거들에 맞닿도록 메레 중심 고리(offset = d/2 + 0.04)를 잡고
 *  · 둘레 길이에 맞춰 메레를 서로 맞닿게 배치한 뒤
 *  · 메레 사이마다 공유 비드(프롱) 하나를 **바깥 테두리(outer rim)** 에 세워
 *    두 스톤의 거들 바깥 모서리를 함께 물립니다 — 비드가 안쪽으로 돌지 않습니다.
 */
function buildHalo(params: StoneParams, outline: Outline): { gems: Placed[]; metals: Placed[]; info: HaloInfo } {
  const size = params.sizeMm
  const d = haloMelee(size)
  const inset = d * 0.5 + 0.04
  const path = offsetOutline(outline, inset)
  const per = outlinePerimeter(path)

  // 메레 지름은 하나로 유지하고, 개수를 둘레에 맞춰 정합니다.
  // 뾰족한 팁에서는 같은 지름으로 밀어 넣으면 서로 파고들므로, 이옷 간격이 지름의 82% 보다
  // 좁아지면 한 쌍씩 빼서 팁 약간의 여유만 남깁니다(실제 헤일로도 팁에는 한 칸씩 빕니다).
  const place = (n: number): ReturnType<typeof sampleOutline>[] =>
    Array.from({ length: n }, (_, k) => sampleOutline(path, k / n))
  const minChord = (pts: { x: number; z: number }[]): number => {
    let m = Infinity
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k]
      const b = pts[(k + 1) % pts.length]
      m = Math.min(m, Math.hypot(a.x - b.x, a.z - b.z))
    }
    return m
  }
  let count = clamp(Math.round(per / d), 12, 40)
  if (count % 2 === 1) count += 1
  let at = place(count)
  while (count > 12 && minChord(at) < d * 0.82) {
    count -= 2
    at = place(count)
  }

  const meleeGeo = buildMeleeGeometry(d)
  const meleeY = 0
  const tilt = (5 * Math.PI) / 180
  const gems: Placed[] = []
  for (let k = 0; k < count; k++) {
    const s = at[k]
    // 바깥으로 살짝 기울이기: 접선축 회전(테이블이 센터 스톤 반대쪽을 향하게)
    const axis = new THREE.Vector3(s.nz, 0, -s.nx).normalize()
    const rot = new THREE.Matrix4().makeRotationAxis(axis, tilt)
    gems.push({ geometry: meleeGeo, x: s.x, y: meleeY, z: s.z, rot })
  }

  // 공유 비드(프롱) — 메레 사이마다 하나, 중심이 아니라 **바깥 테두리**에서 두 스톤을 함께 잡습니다.
  // 이웃 두 메레와 같은 거리(√(0.34² + 0.5²)·d)에 두어 거들 바깥 모서리에 살짝 물리고,
  // 아래로는 레일 윗면에 닿아 금속이 이어집니다.
  const beadR = d * 0.16
  const beadOut = d * 0.34
  const beadY = -d * 0.18
  const beadGeo = new THREE.SphereGeometry(beadR, 10, 8)
  const metals: Placed[] = []
  for (let k = 0; k < count; k++) {
    const s = sampleOutline(path, (k + 0.5) / count)
    metals.push({
      geometry: beadGeo,
      x: s.x + s.nx * beadOut,
      y: beadY,
      z: s.z + s.nz * beadOut,
    })
  }

  // 레일 — 메레 파빌리온을 받치는 얇은 금속 띠. 윗면을 거들 아래로 내려 메레를 세워 보이게 하고,
  // 바깥 경계는 메레 바깥면과 거의 맞춥니다(넓적한 접시가 아니라 링).
  const railInner = offsetOutline(outline, -size * 0.02)
  const railOuter = offsetOutline(path, d * 0.46, 1.2)
  const railTop = -d * 0.34
  const railBottom = -d * 0.68
  const gallery = buildBand(
    railInner,
    railOuter,
    offsetOutline(path, d * 0.38, 1.2),
    railInner,
    railBottom,
    railTop,
  )
  const metals2: Placed[] = [
    { geometry: gallery, x: 0, y: 0, z: 0 },
    { geometry: buildSeat(outline, size, railBottom + 0.02, railOuter, 0.36), x: 0, y: 0, z: 0 },
  ]
  return {
    gems,
    metals: [...metals, ...metals2],
    info: {
      meleeMm: d,
      meleeCount: count,
      meleeOffsetMm: inset,
      beadOffsetMm: beadOut,
      beadRadiusMm: beadR,
      railTopY: railTop,
    },
  }
}

export interface ChannelInfo {
  meleeMm: number
  /** 메레 사이 중심 간격(mm) */
  pitchMm: number
  perSide: number
  /** 레일 안쪽 면의 폭 방향 위치(mm) — 메레 거들(0.5d)보다 안쪽이라 거들 가장자리를 물습니다 */
  railInnerZ: number
  railWidthMm: number
  /** 레일 윗면 높이(mm, 거들면 기준) */
  railTopY: number
  railBottomY: number
  /** 첫 메레까지의 거리(mm) */
  firstGapMm: number
}

/**
 * 채널 — 숄더 양쪽으로 두 개의 금속 레일 사이 홈에 메레 스톤 줄을 물립니다.
 *  · 메레 거들면을 레일 윗면과 같은 높이에 두어 스톤이 홈 **안쪽**에 앉고 크라운만 위로 나옵니다.
 *  · 레일 안쪽 면은 거들 가장자리보다 0.08d 안쪽으로 물려(립) 스톤이 빠지지 않게 잡습니다.
 *  · 레일은 밴드 표면까지 내려가 밴드와 이어집니다.
 */
function buildChannel(params: StoneParams, lift: number): { gems: Placed[]; metals: Placed[]; info: ChannelInfo } {
  const size = params.sizeMm
  const melee = clamp(size * 0.2, 0.5, 1.2)
  const pitch = melee * 1.08
  const perSide = 3
  const aspect = stoneShape(params.shape).aspect
  const half = size * aspect * 0.5
  const first = half + melee * 0.5 + 0.22
  const gems: Placed[] = []
  const metals: Placed[] = []
  const meleeGeo = buildMeleeGeometry(melee)

  const railInnerZ = melee * 0.42
  const railW = clamp(melee * 0.45, 0.18, 0.55)
  const railTopY = melee * 0.03
  const railBottomY = -(lift + 0.3)
  const lens = pitch * 1.06

  const height = railTopY - railBottomY
  const unitParts: THREE.BufferGeometry[] = []
  for (const sz of [-1, 1]) {
    const box = new THREE.BoxGeometry(lens, height, railW)
    box.translate(0, (railTopY + railBottomY) / 2, sz * (railInnerZ + railW / 2))
    unitParts.push(box)
  }
  const unitGeo = mergeGeometries(unitParts, false)
  for (const g of unitParts) g.dispose()

  for (const dir of [-1, 1]) {
    for (let k = 0; k < perSide; k++) {
      const x = dir * (first + pitch * k)
      gems.push({ geometry: meleeGeo, x, y: 0, z: 0 })
      if (unitGeo) metals.push({ geometry: unitGeo, x, y: 0, z: 0 })
    }
  }
  return {
    gems,
    metals,
    info: {
      meleeMm: melee,
      pitchMm: pitch,
      perSide,
      railInnerZ,
      railWidthMm: railW,
      railTopY,
      railBottomY,
      firstGapMm: first,
    },
  }
}

/**
 * 베젤 — 스톤 윤곽을 그대로 따라가는 일정 두께의 금속 벽.
 * 마이터 보정 덕분에 페어·마퀴즈 팁에서도 벽 두께가 일정합니다.
 */
function buildBezelParts(params: StoneParams, outline: Outline): Placed[] {
  const size = params.sizeMm
  const wall = Math.max(0.32, size * 0.095)
  const yTop = size * 0.1
  const yBottom = -size * 0.3
  const inner = offsetOutline(outline, -size * 0.012)
  const band = buildBand(
    inner,
    offsetOutline(outline, wall),
    offsetOutline(outline, wall * 0.8),
    inner,
    yBottom,
    yTop,
  )
  return [
    { geometry: band, x: 0, y: 0, z: 0 },
    { geometry: buildSeat(outline, size, -size * 0.04), x: 0, y: 0, z: 0 },
  ]
}

/* ── 배치 ──────────────────────────────────────────────────── */

/** 부품 하나가 스톤 로컬 +x(접선) 방향으로 차지하는 최대 반경(mm) */
function partExtentX(p: Placed): number {
  const geo = p.geometry
  geo.computeBoundingBox()
  const bb = geo.boundingBox
  if (!bb) return Math.abs(p.x)
  const v = new THREE.Vector3()
  let m = 0
  for (const x of [bb.min.x, bb.max.x]) {
    for (const y of [bb.min.y, bb.max.y]) {
      for (const z of [bb.min.z, bb.max.z]) {
        v.set(x, y, z)
        if (p.rot) v.applyMatrix4(p.rot)
        m = Math.max(m, Math.abs(v.x + p.x))
      }
    }
  }
  return m
}

export interface SettingInfo {
  channel?: ChannelInfo
  halo?: HaloInfo
  prongs?: ProngInfo
}

export function buildStones(
  params: StoneParams,
  ring: { outerRadiusMm: number; profileRadial?: number },
): StoneLayout {
  const warnings: string[] = []
  const Rb = ring.outerRadiusMm
  const spec = stoneShape(params.shape)
  const count = Math.max(0, Math.min(9, Math.round(params.count)))
  const aspect = spec.aspect

  if (count === 0) {
    return { gems: [], metals: [], warnings, stoneFootprintMm: params.sizeMm * aspect, stepDeg: 0, info: {} }
  }

  const outline = stoneOutlineMm(params.shape, params.sizeMm)
  const gemGeo = buildGemGeometry(params.shape, params.sizeMm)

  // 스톤 파빌리온(아랫면)이 밴드 안쪽(손가락 면)을 뚫지 않도록 필요한 만큼 띄웁니다.
  const pavH =
    params.sizeMm * (spec.cut === 'step' ? 0.43 : spec.cut === 'cabochon' ? 0.12 : 0.435)
  const radial = ring.profileRadial ?? 1.8
  const lift = Math.max(0.08, params.sizeMm * 0.06, pavH - radial + 0.12)

  // 세팅 하나를 먼저 만들고, 실제로 차지하는 접선 반폭을 재서 스톤 사이 간격을 정합니다.
  let settingGems: Placed[] = []
  let settingMetals: Placed[] = []
  const info: SettingInfo = {}
  switch (params.setting) {
    case 'bezel':
      settingMetals = buildBezelParts(params, outline)
      break
    case 'halo': {
      const h = buildHalo(params, outline)
      settingGems = h.gems
      settingMetals = h.metals
      info.halo = h.info
      break
    }
    case 'channel': {
      const c = buildChannel(params, lift)
      settingGems = c.gems
      settingMetals = [
        ...c.metals,
        {
          geometry: buildSeat(outline, params.sizeMm, -params.sizeMm * 0.12, scaleOutline(outline, 0.78), 0.34),
          x: 0,
          y: 0,
          z: 0,
        },
      ]
      info.channel = c.info
      break
    }
    default: {
      // 바스켓 윗면(플레이트) — 스톤 윤곽을 프롱 지름만큼 넓혀 따라가, 발이 그 위에 서고
      // 페어·마퀴즈 팁에서는 플레이트도 함께 뾰족해집니다(V 프롱의 바깥면과 같은 선).
      const yPlate = -params.sizeMm * 0.055
      const p = buildProngParts(params, outline, {
        multi: count > 1,
        yBase: -params.sizeMm * 0.055 - params.sizeMm * 0.1,
        cut: spec.cut,
        yPlate,
      })
      settingMetals = [
        ...p.parts,
        {
          geometry: buildBasket(outline, params.sizeMm, params.prongMm, yPlate),
          x: 0,
          y: 0,
          z: 0,
        },
      ]
      info.prongs = p.info
      break
    }
  }

  const halfExtent = Math.max(
    params.sizeMm * aspect * 0.5,
    0,
    ...settingGems.map(partExtentX),
    ...settingMetals.map(partExtentX),
  )
  // 이웃 스톤(과 그 세팅)이 접선 방향으로 최소 0.35mm 떨어지도록 각도 간격을 잡습니다.
  const needed = Math.max(2 * halfExtent + 0.3, params.sizeMm * aspect + 0.35)
  let stepRad = needed / Rb
  const maxArc = Math.PI * 0.82
  if ((count - 1) * stepRad > maxArc) {
    stepRad = maxArc / Math.max(1, count - 1)
    warnings.push(
      `스톤 ${count}개가 밴드 상단에 다 들어가지 않습니다. 간격을 자동으로 좁혔습니다 — 개수를 줄이거나 스톤을 작게 해 주세요.`,
    )
  }
  const total = (count - 1) * stepRad
  const offset = (params.rotationDeg * Math.PI) / 180

  const gems: MeshPart[] = []
  const metals: MeshPart[] = []

  /** 로컬 (x,y,z) → 반지 좌표. 접선 오프셋 x 는 각도 차이로 환산합니다. */
  const place = (theta: number, radius: number, x: number, y: number, z: number, rot?: THREE.Matrix4): THREE.Matrix4 => {
    const ang = theta + x / Math.max(1, radius)
    const u = new THREE.Vector3(Math.sin(ang), Math.cos(ang), 0) // 방사방향
    const w = new THREE.Vector3(Math.cos(ang), -Math.sin(ang), 0) // 접선방향
    const zAxis = new THREE.Vector3().crossVectors(w, u)
    const m = new THREE.Matrix4().makeBasis(w, u, zAxis)
    if (rot) m.multiply(rot)
    const pos = u.multiplyScalar(radius + y).add(new THREE.Vector3(0, 0, z))
    m.setPosition(pos)
    return m
  }

  for (let k = 0; k < count; k++) {
    const theta = -total / 2 + k * stepRad + offset
    const radius = Rb + lift
    gems.push({ geometry: gemGeo, matrix: place(theta, radius, 0, 0, 0) })
    for (const g of settingGems) gems.push({ geometry: g.geometry, matrix: place(theta, radius, g.x, g.y, g.z, g.rot) })
    for (const m of settingMetals) metals.push({ geometry: m.geometry, matrix: place(theta, radius, m.x, m.y, m.z, m.rot) })
  }

  return {
    gems,
    metals,
    warnings,
    stoneFootprintMm: 2 * halfExtent,
    stepDeg: (stepRad * 180) / Math.PI,
    info,
  }
}

/** 보석 1개의 근사 캐럿 — 윤곽 면적비를 그대로 반영한 다이아몬드 경험식
 *  round: ct ≈ 0.0037 × d³ (6.5mm ≈ 1ct), d = 폭(mm)
 */
export function estimateCarat(sizeMm: number, shape: StoneShape): number {
  const d = Math.max(0.5, sizeMm)
  const k = outlineArea(stoneOutline(shape)) / Math.PI
  return 0.0037 * d * d * d * k
}
