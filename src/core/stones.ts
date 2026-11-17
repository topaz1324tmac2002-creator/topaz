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
import type { StoneParams, StoneShape } from './types'
import { stoneShape } from './catalog'
import {
  offsetOutline,
  outlineArea,
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
  /** 보석 1개(센터)의 겉보기 외접 지름 mm */
  stoneFootprintMm: number
  stepDeg: number
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

/** 4개(이상) 정점의 평면 다각형을 y0~y1 로 밀어 올린 각기둥. 위면은 topScale 만큼 좁혀 테이퍼. */
function buildPrism(poly: Vec2[], y0: number, y1: number, topScale = 1): THREE.BufferGeometry {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length
  const cz = poly.reduce((s, p) => s + p[1], 0) / poly.length
  const verts: number[] = []
  const bot = poly.map(([x, z]) => verts.push(x, y0, z) / 3 - 1)
  const top = poly.map(([x, z]) => verts.push(cx + (x - cx) * topScale, y1, cz + (z - cz) * topScale) / 3 - 1)
  const tris: Tri[] = []
  for (let i = 1; i < poly.length - 1; i++) {
    tris.push([bot[0], bot[i], bot[i + 1]])
    tris.push([top[0], top[i + 1], top[i]])
  }
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length
    tris.push([bot[i], top[i], top[j]])
    tris.push([bot[i], top[j], bot[j]])
  }
  return facetGeometry(verts, tris)
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

/** 팁(뾰족한 끝) 방향 — 페어는 t=0 한 곳, 마퀴즈는 t=0 과 t=0.5 두 곳 */
function tipParams(shape: StoneShape): number[] {
  if (shape === 'pear') return [0]
  if (shape === 'marquise') return [0, 0.5]
  return []
}

/**
 * V 프롱 — 뾰족한 팁을 감싸는 쐐기형 다리.
 * 팁 양옆 윤곽을 따라 얇은 두 봉을 붙여 V 자를 만들고, 팁 너머까지 살짝 물려 줍니다.
 * 높이는 거들 바로 웃깨까지만 올려(테이블을 가리지 않도록) 스톤을 잡아 줍니다.
 */
function buildVProng(outline: Outline, tipT: number, sizeMm: number, prongMm: number): THREE.BufferGeometry {
  // 봉 길이는 절대 치수로 — 둘레가 긴 모양에서도 판때기처럼 커지지 않게.
  const barLen = clamp(sizeMm * 0.1, 0.4, 0.9)
  const step = barLen / outlinePerimeter(outline)
  const thick = clamp(prongMm * 0.36, 0.18, 0.34)
  const beyond = 0.12
  const lift = 0.03
  const y0 = -sizeMm * 0.2
  const y1 = sizeMm * 0.035
  const geos: THREE.BufferGeometry[] = []
  for (const dir of [-1, 1]) {
    const a = sampleOutline(outline, tipT)
    const b = sampleOutline(outline, tipT + dir * step)
    const mid = sampleOutline(outline, tipT + dir * step * 0.5)
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len = Math.hypot(dx, dz) || 1
    const ux = dx / len
    const uz = dz / len
    // 봉의 바깥 방향이 스톤 바깥을 향하도록 법선 부호를 맞춥니다.
    let nx = uz
    let nz = -ux
    if (nx * mid.nx + nz * mid.nz < 0) {
      nx = -nx
      nz = -nz
    }
    // 스톤 표면에서 lift 만큼 떠서 감싸도록 네 모서리를 잡습니다.
    const p0: Vec2 = [a.x - ux * beyond + nx * lift, a.z - uz * beyond + nz * lift]
    const p1: Vec2 = [b.x - ux * thick * 0.25 + nx * lift, b.z - uz * thick * 0.25 + nz * lift]
    const poly: Vec2[] = [
      [p0[0], p0[1]],
      [p1[0], p1[1]],
      [p1[0] + nx * thick, p1[1] + nz * thick],
      [p0[0] + nx * thick, p0[1] + nz * thick],
    ]
    geos.push(buildPrism(poly, y0, y1, 0.86))
  }
  const merged = mergeGeometries(geos, false)
  for (const g of geos) g.dispose()
  if (merged) return merged
  return buildPrism(
    [
      [0, 0],
      [thick, 0],
      [thick, thick],
      [0, thick],
    ],
    y0,
    y1,
    0.86,
  )
}

function prongGeometry(sizeMm: number, prongMm: number): THREE.BufferGeometry {
  const r = prongMm / 2
  const crownH = sizeMm * 0.22
  const bottom = -sizeMm * 0.22
  const top = crownH * 0.78
  const height = top - bottom
  const cyl = new THREE.CylinderGeometry(r * 0.82, r, height, 12, 1, false)
  cyl.translate(0, (top + bottom) / 2, 0)
  const ball = new THREE.SphereGeometry(r * 0.95, 12, 8)
  ball.translate(0, top, 0)
  const merged = mergeGeometries([cyl, ball], false)
  cyl.dispose()
  ball.dispose()
  if (merged) return merged
  const fallback = new THREE.CylinderGeometry(r * 0.82, r, height, 12, 1, false)
  fallback.translate(0, (top + bottom) / 2, 0)
  return fallback
}

/** 프롱 배치 — 뾰족한 모양은 팁에 V 프롱, 나머지는 균등 배분 */
function buildProngParts(params: StoneParams, outline: Outline): Placed[] {
  const shape = params.shape
  const n = params.setting === 'prong6' ? 6 : 4
  const tips = tipParams(shape)
  const geo = prongGeometry(params.sizeMm, params.prongMm)
  const out: Placed[] = []
  const vProngs = tips.map((t) => buildVProng(outline, t, params.sizeMm, params.prongMm))
  for (const g of vProngs) out.push({ geometry: g, x: 0, y: 0, z: 0 })

  let shoulderT: number[] = []
  if (shape === 'pear') {
    shoulderT = n === 6 ? [0.25, 0.75, 0.42, 0.58, 0.5] : [0.3, 0.7, 0.5]
  } else if (shape === 'marquise') {
    shoulderT = n === 6 ? [0.17, 0.33, 0.67, 0.83] : [0.25, 0.75]
  } else {
    const offset = 0.5 / n
    for (let k = 0; k < n; k++) shoulderT.push(k / n + offset)
  }
  for (const t of shoulderT) {
    const s = sampleOutline(outline, t)
    out.push({
      geometry: geo,
      x: s.x + s.nx * params.prongMm * 0.26,
      y: 0,
      z: s.z + s.nz * params.prongMm * 0.26,
    })
  }
  return out
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

/** 헤일로 메레 지름 (mm) — 센터 스톤 폭의 20% 안팩, 일반적인 헤일로 메레 비례 */
export function haloMelee(sizeMm: number): number {
  return clamp(sizeMm * 0.2, 0.8, 1.5)
}

/** 헤일로가 센터 스톤 바깥으로 더 차지하는 반지름(mm) */
export function haloExtentMm(sizeMm: number): number {
  return haloMelee(sizeMm) * 1.12
}

/**
 * 헤일로 — 센터 스톤 윤곽을 그대로 따라가는 섬세한 파베 링.
 *  · 센터 스톤 거들에 맞닿도록 메레 중심 고리(offset = d/2)를 잡고
 *  · 둘레 길이에 맞춰 메레를 서로 맞닿게(간격 = 지름) 촘촘히 박은 뒤
 *  · 메레 사이마다 작은 공유 비드 하나, 그 아래는 얇은 금속 레일만 남깁니다(넓적한 접시 아님).
 */
function buildHalo(params: StoneParams, outline: Outline): { gems: Placed[]; metals: Placed[] } {
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
  const meleeY = -size * 0.008
  const tilt = (8 * Math.PI) / 180
  const gems: Placed[] = []
  for (let k = 0; k < count; k++) {
    const s = at[k]
    // 바깥으로 살짝 기울이기: 접선축 회전(테이블이 센터 스톤 반대쪽을 향하게)
    const axis = new THREE.Vector3(s.nz, 0, -s.nx).normalize()
    const rot = new THREE.Matrix4().makeRotationAxis(axis, tilt)
    gems.push({ geometry: meleeGeo, x: s.x, y: meleeY, z: s.z, rot })
  }

  // 공유 비드 프롱 — 메레 사이 경계마다 하나 (금속)
  const beadGeo = new THREE.SphereGeometry(d * 0.15, 8, 6)
  const metals: Placed[] = []
  for (let k = 0; k < count; k++) {
    const s = sampleOutline(path, (k + 0.5) / count)
    metals.push({ geometry: beadGeo, x: s.x, y: meleeY + d * 0.06, z: s.z })
  }

  // 레일 — 메레를 받치는 얇은 금속 띠. 바깥면은 메레 바깥면보다 살짝 안으로.
  // (바깥 윤곽은 마이터를 1.1 로 묶어, 뾰족한 팁에서 금속이 밖으로 튀어나오지 않게 합니다)
  const railInner = offsetOutline(outline, -size * 0.02)
  const railOuter = offsetOutline(outline, inset + d * 0.32, 1.1)
  const railTop = meleeY - d * 0.04
  const railBottom = meleeY - d * 0.55
  const gallery = buildBand(
    railInner,
    railOuter,
    offsetOutline(outline, inset + d * 0.26, 1.1),
    railInner,
    railBottom,
    railTop,
  )
  const metals2: Placed[] = [
    { geometry: gallery, x: 0, y: 0, z: 0 },
    { geometry: buildSeat(outline, size, railBottom + 0.02, railOuter, 0.36), x: 0, y: 0, z: 0 },
  ]
  return { gems, metals: [...metals, ...metals2] }
}

/** 채널 — 숄더 양쪽으로 두 개의 금속 벽 사이에 메레 스톤 줄 */
function buildChannel(params: StoneParams): { gems: Placed[]; metals: Placed[] } {
  const size = params.sizeMm
  const melee = Math.max(0.5, Math.min(1.2, size * 0.2))
  const spacing = melee * 2.1
  const perSide = 3
  const half = size * stoneShape(params.shape).aspect * 0.5
  const gems: Placed[] = []
  const metals: Placed[] = []
  const meleeGeo = buildMeleeGeometry(melee)

  const wallH = melee * 1.6
  const wallW = Math.max(0.24, melee * 0.55)
  const gap = half + melee * 1.3

  const unitParts: THREE.BufferGeometry[] = []
  for (const sz of [-1, 1]) {
    const box = new THREE.BoxGeometry(spacing * 1.12, wallH, wallW)
    box.translate(0, wallH * 0.5 - melee * 0.4, sz * (melee * 0.95 + wallW * 0.5))
    unitParts.push(box)
  }
  const base = new THREE.BoxGeometry(spacing * 1.12, melee * 0.6, (melee * 0.95 + wallW) * 2)
  base.translate(0, -melee * 0.9, 0)
  unitParts.push(base)
  const unitGeo = mergeGeometries(unitParts, false)
  for (const g of unitParts) g.dispose()

  for (const dir of [-1, 1]) {
    for (let k = 0; k < perSide; k++) {
      const x = dir * (gap + spacing * k)
      gems.push({ geometry: meleeGeo, x, y: -melee * 0.18, z: 0 })
      if (unitGeo) metals.push({ geometry: unitGeo, x, y: 0, z: 0 })
    }
  }
  return { gems, metals }
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

export function buildStones(
  params: StoneParams,
  ring: { outerRadiusMm: number; profileRadial?: number },
): StoneLayout {
  const warnings: string[] = []
  const Rb = ring.outerRadiusMm
  const spec = stoneShape(params.shape)
  const count = Math.max(0, Math.min(9, Math.round(params.count)))
  const aspect = spec.aspect

  // 세팅별 추가 폭(접선 방향)을 반영한 외접 크기
  const channelExtra = params.setting === 'channel' ? params.sizeMm * 0.2 * 2.1 * 3 * 2 + params.sizeMm * 0.4 : 0
  const haloExtra = params.setting === 'halo' ? haloExtentMm(params.sizeMm) * 2 : 0
  const footprint = params.sizeMm * aspect + channelExtra + haloExtra

  if (count === 0) {
    return { gems: [], metals: [], warnings, stoneFootprintMm: footprint, stepDeg: 0 }
  }

  // 이웃 스톤 사이 금속 최소 0.5mm를 확보하는 각도 간격
  let stepRad = (footprint * 1.02 + 0.55) / Rb
  const maxArc = Math.PI * 0.82
  if ((count - 1) * stepRad > maxArc) {
    stepRad = maxArc / Math.max(1, count - 1)
    warnings.push(
      `스톤 ${count}개가 밴드 상단에 다 들어가지 않습니다. 간격을 자동으로 좁혔습니다 — 개수를 줄이거나 스톤을 작게 해 주세요.`,
    )
  }
  const total = (count - 1) * stepRad
  const offset = (params.rotationDeg * Math.PI) / 180

  const outline = stoneOutlineMm(params.shape, params.sizeMm)
  const gemGeo = buildGemGeometry(params.shape, params.sizeMm)

  // 센터 스톤 + 세팅
  let settingGems: Placed[] = []
  let settingMetals: Placed[] = []
  switch (params.setting) {
    case 'bezel':
      settingMetals = buildBezelParts(params, outline)
      break
    case 'halo': {
      const h = buildHalo(params, outline)
      settingGems = h.gems
      settingMetals = h.metals
      break
    }
    case 'channel': {
      const c = buildChannel(params)
      settingGems = c.gems
      settingMetals = [
        ...c.metals,
        { geometry: buildSeat(outline, params.sizeMm, -params.sizeMm * 0.12, scaleOutline(outline, 0.78), 0.34), x: 0, y: 0, z: 0 },
      ]
      break
    }
    default:
      settingMetals = [
        ...buildProngParts(params, outline),
        { geometry: buildSeat(outline, params.sizeMm, -params.sizeMm * 0.14, scaleOutline(outline, 0.7), 0.34), x: 0, y: 0, z: 0 },
      ]
  }

  const gems: MeshPart[] = []
  const metals: MeshPart[] = []
  // 스톤 파빌리온(아랫면)이 밴드 안쪽(손가락 면)을 뚫지 않도록 필요한 만큼 띄웁니다.
  const pavH =
    params.sizeMm * (spec.cut === 'step' ? 0.43 : spec.cut === 'cabochon' ? 0.12 : 0.435)
  const radial = ring.profileRadial ?? 1.8
  const lift = Math.max(0.08, params.sizeMm * 0.06, pavH - radial + 0.12)

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
    for (const m of settingMetals) metals.push({ geometry: m.geometry, matrix: place(theta, radius, m.x, m.y, m.z) })
  }

  return {
    gems,
    metals,
    warnings,
    stoneFootprintMm: footprint,
    stepDeg: (stepRad * 180) / Math.PI,
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
