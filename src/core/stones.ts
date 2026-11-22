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

/* ── 프롱(발) ─────────────────────────────────────────────── */

/**
 * 크라운 반지름 비율 — 거들면(y=0)에서 테이블로 올라가며 윤곽 반지름이 줄어드는 정도.
 * 프롱 발톱이 "거들 옆 허공"이 아니라 크라운 표면에 실제로 닿는 높이·깊이를 잡는 데 씁니다.
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

/** 두 점을 잇는 원뿔대(둥근 발) — (바깥방향 x, 크라운 높이 y) 평면 위의 축. */
function frustum(p0: Vec2, p1: Vec2, r0: number, r1: number): THREE.BufferGeometry {
  const dx = p1[0] - p0[0]
  const dy = p1[1] - p0[1]
  const len = Math.hypot(dx, dy) || 1e-3
  const cyl = new THREE.CylinderGeometry(r1, r0, len, 10, 1, false)
  cyl.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.atan2(-dx / len, dy / len)))
  cyl.translate((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, 0)
  const flat = cyl.toNonIndexed()
  cyl.dispose()
  flat.deleteAttribute('uv')
  return flat
}

/**
 * 프롱(발) — 거들 옆에서 둥근 기둥으로 곧게 올라온 뒤, 윗부분이 안쪽으로 꺾여
 * 크라운을 무는 발톱형 프롱. 로컬 프레임: +x = 바깥(스톤 중심 반대), +y = 크라운 높이, +z = 접선.
 * 원점은 거들 윤곽 위.
 *  · 기둥 축은 거들 바로 밖(0.34×지름)에 서서 거들 가장자리를 0.14×지름 물고,
 *  · 발톱 끝(반지름 0.30×지름)은 크라운이 좁아지는 만큼 안으로 들어가 표면을 0.10×지름 문 것입니다.
 *  · 발톱 끝은 크라운 높이의 1/3 지점 — 테이블을 가리지 않고 거들 바로 위를 잡습니다.
 */
function prongGeometry(
  sizeMm: number,
  prongMm: number,
  rGirdle: number,
  cut: StoneCut,
  yBase: number,
): THREE.BufferGeometry {
  const pw = prongMm
  const cH = crownHeight(cut, sizeMm)
  const yTip = Math.min(cH * 0.36, cH - 0.02)
  const yBend = Math.max(yBase + pw * 0.05, yTip - cH * 0.16)
  const xPost = pw * 0.34
  const k = crownFactor(cut, yTip, sizeMm)
  const xTip = (k - 1) * rGirdle + pw * 0.2
  const geos = [
    frustum([xPost, yBase], [xPost, yBend], pw * 0.48, pw * 0.44),
    frustum([xPost, yBend], [xTip, yTip], pw * 0.42, pw * 0.3),
  ]
  const tipGeo = new THREE.SphereGeometry(pw * 0.3, 10, 8).toNonIndexed()
  tipGeo.deleteAttribute('uv')
  tipGeo.translate(xTip, yTip, 0)
  geos.push(tipGeo)
  const merged = mergeGeometries(geos, false)
  for (const g of geos) g.dispose()
  if (merged) return merged
  return frustum([xPost, yBase], [xPost, yBend], pw * 0.48, pw * 0.44)
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
  opts: { multi: boolean; yBase: number; cut: StoneCut },
): { parts: Placed[]; info: ProngInfo } {
  const shape = params.shape
  const n = params.setting === 'prong6' ? 6 : 4
  const pw = params.prongMm
  const size = params.sizeMm
  const parts: Placed[] = []

  // 팁 V 프롱 — 페어 1개, 마퀴즈 2개
  const tips = tipParams(shape)
  for (const t of tips) {
    parts.push({ geometry: buildVProng(outline, t, size, pw), x: 0, y: 0, z: 0 })
  }

  const anglesDeg: number[] = []
  const shoulderT: number[] = []
  if (opts.multi) {
    // 다석 — 이웃 스톤과 마주보는 접선 축(0°/180°)을 비우고 폭 방향에 발을 세웁니다.
    // (양옆 스톤의 발과 부딪히지 않도록 60°~120° 구간에만 배치)
    anglesDeg.push(...(n === 6 ? [60, 90, 120, 240, 270, 300] : [60, 120, 240, 300]))
  } else if (tips.length > 0) {
    // 페어·마퀴즈 단석 — 팁은 V 프롱이 잡고 어깨에 나머지를 고르게
    if (shape === 'pear') shoulderT.push(...(n === 6 ? [0.25, 0.75, 0.42, 0.58, 0.5] : [0.3, 0.7, 0.5]))
    else shoulderT.push(...(n === 6 ? [0.17, 0.33, 0.67, 0.83] : [0.25, 0.75]))
  } else {
    // 단석 — 고른 부채꼴 배치 (4발 45°, 6발 30° 위상)
    for (let k = 0; k < n; k++) anglesDeg.push((360 / n) * k + 360 / (2 * n))
  }

  const targets: { x: number; z: number; nx: number; nz: number }[] = []
  for (const a of anglesDeg) targets.push(outlineAtAngle(outline, (a * Math.PI) / 180))
  for (const t of shoulderT) targets.push(sampleOutline(outline, t))

  // 같은 반지름의 발은 지오메트리를 공유합니다(스톤 1개당 2~4종).
  const cache = new Map<string, THREE.BufferGeometry>()
  let tipInset = 0
  let extent = 0
  for (const s of targets) {
    const r = Math.hypot(s.x, s.z) || 1
    const key = r.toFixed(3)
    let geo = cache.get(key)
    if (!geo) {
      geo = prongGeometry(size, pw, r, opts.cut, opts.yBase)
      cache.set(key, geo)
    }
    const k = crownFactor(opts.cut, crownHeight(opts.cut, size) * 0.36, size)
    tipInset = Math.max(tipInset, (1 - k) * r - pw * 0.2)
    const rot = new THREE.Matrix4().makeRotationY(Math.atan2(-s.nz, s.nx))
    const part: Placed = { geometry: geo, x: s.x, y: 0, z: s.z, rot }
    parts.push(part)
    // 발은 거들 윤곽에서 0.34×지름 바깥에 서므로, 접선 최대치는 그 위치 + 발 반지름입니다.
    extent = Math.max(extent, Math.abs(s.x) + pw * 0.82)
  }

  return {
    parts,
    info: {
      anglesDeg,
      vProngs: tips.length,
      tipInsetMm: tipInset,
      baseOffsetMm: pw * 0.34,
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
      const p = buildProngParts(params, outline, {
        multi: count > 1,
        yBase: -Math.max(lift + 0.3, params.sizeMm * 0.22),
        cut: spec.cut,
      })
      settingMetals = [
        ...p.parts,
        // 발 밑동이 시트 테두리에 물리도록, 시트 윗면을 거들 바로 아래·거들보다 살짝 넓게 잡습니다.
        {
          geometry: buildSeat(
            outline,
            params.sizeMm,
            -params.sizeMm * 0.06,
            scaleOutline(outline, 0.96),
            0.42,
          ),
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
    for (const m of settingMetals) metals.push({ geometry: m.geometry, matrix: place(theta, radius, m.x, m.y, m.z) })
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
