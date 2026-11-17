/**
 * 스톤 & 세팅 생성기 — 보석 형상(브릴리언트/스텝/캐보션) + 세팅 금속부(프롱·베젤·헤일로·채널).
 *
 * 스톤 로컬 좌표계: +Y 가 "바깥(반지 반경 방향)", 원점은 거들(girdle) 평면 중심.
 *   x = 접선 방향, y = 바깥 방향, z = 반지 축 방향
 * 반지 위 배치: 각도 θ 위치의 바깥면에 로컬 +Y 가 방사방향을 향하도록 놓습니다.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { StoneParams, StoneShape } from './types'
import { stoneShape } from './catalog'
import {
  offsetOutline,
  outlinePerimeter,
  sampleOutline,
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
  /** 세팅 금속부(프롱·베젤·시트·헤일로 플레이트·채널 벽) */
  metals: MeshPart[]
  warnings: string[]
  /** 보석 1개(센터)의 겉보기 외접 지름 mm */
  stoneFootprintMm: number
  stepDeg: number
}

/* ── 공통 유틸 ─────────────────────────────────────────────── */

type Ring = { pts: Vec2[]; y: number }

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
 * 고리(ring) 목록을 잇는 셸을 만듭니다.
 * rings 는 아래에서 위로 정렬되어 있고 같은 점 개수를 가집니다.
 * capTop=true 면 마지막 링을 중심 팬으로 막고, culet 이 있으면 첫 링과 점을 이어 바닥을 막습니다.
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
  // 옆면
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
  // 꼭대기 팬
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
  // 바닥 큐렛 팬
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

/** 링 목록을 잇는 닫힌 띠(안쪽 벽·바닥·바깥 벽·윗면) — 베젤·헤일로 플레이트 */
function buildClosedBand(inner: Outline, outer: Outline, yBottom: number, yTop: number): THREE.BufferGeometry {
  const rings: Ring[] = [
    { pts: inner, y: yBottom },
    { pts: outer, y: yBottom },
    { pts: outer, y: yTop },
    { pts: inner, y: yTop },
  ]
  // 마지막 → 처음으로 이어 닫습니다(측면 4개).
  const n = inner.length
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let r = 0; r < 4; r++) {
    for (let i = 0; i < n; i++) {
      positions.push(rings[r].pts[i][0], rings[r].y, rings[r].pts[i][1])
      uvs.push(i / n, r / 4)
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
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  outward(geo)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

/* ── 보석 형상 ─────────────────────────────────────────────── */

/** 브릴리언트 컷 — 플랫 테이블, 크라운(비젤·스타·어퍼 거들), 얇은 거들, 테이퍼 파빌리온과 큐렛 */
function brilliant(outline: Outline, sizeMm: number): THREE.BufferGeometry {
  const n = outline.length
  const girdleH = Math.max(0.03, sizeMm * 0.028)
  const crownH = sizeMm * 0.21
  const pavH = sizeMm * 0.44
  const scaled = (k: number, shift = 0): Vec2[] =>
    outline.map((_, i) => {
      const p = outline[(i + shift) % n]
      return [p[0] * k, p[1] * k] as Vec2
    })
  // 어퍼 거들 링은 살짝 지그재그로 두어 비젤/스타 패싯이 번갈아 보이게 합니다.
  const crownRing: Vec2[] = outline.map(([x, z], i) => {
    const k = 0.845 + (i % 2 === 0 ? 0.035 : -0.035)
    return [x * k, z * k] as Vec2
  })
  const rings: Ring[] = [
    { pts: scaled(0.56), y: -pavH * 0.55 },
    { pts: scaled(0.9), y: -pavH * 0.12 },
    { pts: scaled(1), y: -girdleH },
    { pts: scaled(1), y: girdleH },
    { pts: crownRing, y: crownH * 0.46 },
    // 테이블 링은 어퍼 거들 패싯의 중간에 점이 오도록 반 칸 회전(변 중점)
    {
      pts: outline.map((p, i): Vec2 => {
        const q = outline[(i + 1) % n]
        return [((p[0] + q[0]) / 2) * 0.56, ((p[1] + q[1]) / 2) * 0.56]
      }),
      y: crownH,
    },
  ]
  const geo = buildShell(rings, { capTop: true, culetY: -pavH })
  const flat = geo.toNonIndexed()
  flat.computeVertexNormals()
  flat.computeBoundingSphere()
  return flat
}

/** 스텝 컷(에메랄드) — 계단형 사각 패싯 */
function stepCut(outline: Outline, sizeMm: number): THREE.BufferGeometry {
  const girdleH = Math.max(0.03, sizeMm * 0.03)
  const crownH = sizeMm * 0.18
  const pavH = sizeMm * 0.4
  const k = (f: number): Vec2[] => outline.map(([x, z]) => [x * f, z * f] as Vec2)
  const rings: Ring[] = [
    { pts: k(0.6), y: -pavH * 0.5 },
    { pts: k(0.9), y: -pavH * 0.15 },
    { pts: k(1), y: -girdleH },
    { pts: k(1), y: girdleH },
    { pts: k(0.9), y: crownH * 0.55 },
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
  const rings: Ring[] = [{ pts: outline.map(([x, z]) => [x * 0.95, z * 0.95] as Vec2), y: -baseH },
    { pts: outline.map(([x, z]) => [x, z] as Vec2), y: 0 }]
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

/** 로컬 좌표에 놓인 부품 — 반지 좌표로 옮길 때 각 부품의 접선 오프셋까지 반영합니다. */
interface Placed {
  geometry: THREE.BufferGeometry
  x: number
  y: number
  z: number
}

function prongGeometry(sizeMm: number, prongMm: number): THREE.BufferGeometry {
  const r = prongMm / 2
  const crownH = sizeMm * 0.22
  const bottom = -sizeMm * 0.2
  const top = crownH * 0.72
  const height = top - bottom
  const cyl = new THREE.CylinderGeometry(r * 0.82, r, height, 10, 1, false)
  cyl.translate(0, (top + bottom) / 2, 0)
  const ball = new THREE.SphereGeometry(r * 0.95, 10, 7)
  ball.translate(0, top, 0)
  const merged = mergeGeometries([cyl, ball], false)
  cyl.dispose()
  ball.dispose()
  if (merged) return merged
  const fallback = new THREE.CylinderGeometry(r * 0.82, r, height, 10, 1, false)
  fallback.translate(0, (top + bottom) / 2, 0)
  return fallback
}

function buildProngParts(params: StoneParams, outline: Outline): Placed[] {
  const n = params.setting === 'prong6' ? 6 : 4
  const geo = prongGeometry(params.sizeMm, params.prongMm)
  const offset = params.setting === 'prong6' ? 0 : 0.5 / n
  const out: Placed[] = []
  for (let k = 0; k < n; k++) {
    const t = k / n + offset
    const s = sampleOutline(outline, t)
    // 프롱 중심은 스톤 거들 외곽선 위(살짝 바깥)에 둡니다.
    out.push({ geometry: geo, x: s.x + s.nx * params.prongMm * 0.25, y: 0, z: s.z + s.nz * params.prongMm * 0.25 })
  }
  return out
}

/** 스톤 아래 시트(받침) — 밴드와 스톤을 연결하는 닫힌 금속 블록 */
function buildSeat(outline: Outline, sizeMm: number, yTop = -sizeMm * 0.06): THREE.BufferGeometry {
  const rings: Ring[] = [
    { pts: outline.map(([x, z]) => [x * 0.45, z * 0.45] as Vec2), y: yTop - sizeMm * 0.34 },
    { pts: outline.map(([x, z]) => [x * 0.78, z * 0.78] as Vec2), y: yTop - sizeMm * 0.12 },
    { pts: outline.map(([x, z]) => [x * 0.86, z * 0.86] as Vec2), y: yTop },
  ]
  return buildShell(rings, { capTop: true, culetY: yTop - sizeMm * 0.4 })
}

/** 헤일로 — 센터 스톤 윤곽을 따라 메레 스톤 한 줄 + 플레이트 */
function buildHalo(params: StoneParams, outline: Outline): { gems: Placed[]; metals: Placed[] } {
  const size = params.sizeMm
  const melee = Math.max(0.55, Math.min(1.5, size * 0.19))
  const path = offsetOutline(outline, melee * 0.95 + size * 0.02)
  const per = outlinePerimeter(path)
  const count = Math.max(8, Math.min(24, Math.round(per / (melee * 1.06))))
  const gems: Placed[] = []
  const meleeGeo = buildMeleeGeometry(melee)
  for (let k = 0; k < count; k++) {
    const s = sampleOutline(path, k / count)
    gems.push({ geometry: meleeGeo, x: s.x, y: -melee * 0.12, z: s.z })
  }
  const plateOuter = offsetOutline(outline, melee * 1.95 + size * 0.03)
  const plate = buildClosedBand(offsetOutline(outline, -size * 0.04), plateOuter, -melee * 1.25, -melee * 0.04)
  const metals: Placed[] = [{ geometry: plate, x: 0, y: 0, z: 0 }]
  metals.push({ geometry: buildSeat(outline, size * 1.15, -melee * 1.15), x: 0, y: 0, z: 0 })
  return { gems, metals }
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

  // 스톤 1개분 채널 유닛(벽 2장 + 바닥 1장)을 원점 기준으로 만들어 두고,
  // 각 유닛을 자기 접선 위치에 놓아 밴드 곡률을 따라가게 합니다.
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

/** 베젤 — 스톤 거들 둘레를 감싸는 닫힌 금속 벽 */
function buildBezelParts(params: StoneParams, outline: Outline): Placed[] {
  const size = params.sizeMm
  const wall = Math.max(0.35, size * 0.11)
  const hh = size * 0.14
  const outer = offsetOutline(outline, wall)
  const band = buildClosedBand(offsetOutline(outline, -size * 0.01), outer, -hh * 1.15, hh)
  return [
    { geometry: band, x: 0, y: 0, z: 0 },
    { geometry: buildSeat(outline, size), x: 0, y: 0, z: 0 },
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
  const haloExtra = params.setting === 'halo' ? params.sizeMm * 0.19 * 2 * 1.95 + params.sizeMm * 0.06 : 0
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
      settingMetals = [...c.metals, { geometry: buildSeat(outline, params.sizeMm), x: 0, y: 0, z: 0 }]
      break
    }
    default:
      settingMetals = [...buildProngParts(params, outline), { geometry: buildSeat(outline, params.sizeMm), x: 0, y: 0, z: 0 }]
  }

  const gems: MeshPart[] = []
  const metals: MeshPart[] = []
  // 스톤 파빌리온(아랫면)이 밴드 안쪽(손가락 면)을 뚫지 않도록 필요한 만큼 띄웁니다.
  const pavH = params.sizeMm * (spec.cut === 'step' ? 0.4 : spec.cut === 'cabochon' ? 0.12 : 0.44)
  const radial = ring.profileRadial ?? 1.8
  const lift = Math.max(0.08, params.sizeMm * 0.06, pavH - radial + 0.12)

  /** 로컬 (x,y,z) → 반지 좌표. 접선 오프셋 x 는 각도 차이로 환산합니다. */
  const place = (theta: number, radius: number, x: number, y: number, z: number): THREE.Matrix4 => {
    const ang = theta + x / Math.max(1, radius)
    const u = new THREE.Vector3(Math.sin(ang), Math.cos(ang), 0) // 방사방향
    const w = new THREE.Vector3(Math.cos(ang), -Math.sin(ang), 0) // 접선방향
    const zAxis = new THREE.Vector3().crossVectors(w, u)
    const m = new THREE.Matrix4().makeBasis(w, u, zAxis)
    const pos = u.multiplyScalar(radius + y).add(new THREE.Vector3(0, 0, z))
    m.setPosition(pos)
    return m
  }

  for (let k = 0; k < count; k++) {
    const theta = -total / 2 + k * stepRad + offset
    const radius = Rb + lift
    gems.push({ geometry: gemGeo, matrix: place(theta, radius, 0, 0, 0) })
    for (const g of settingGems) gems.push({ geometry: g.geometry, matrix: place(theta, radius, g.x, g.y, g.z) })
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

/** 보석 1개의 근사 캐럿 (다이아몬드 기준 경험식, 표시용)
 *  round: ct ≈ 0.0037 × d³  (6.5mm ≈ 1ct)
 */
export function estimateCarat(sizeMm: number, shape: StoneShape): number {
  const d = Math.max(0.5, sizeMm)
  const round = 0.0037 * d * d * d
  const k: Record<StoneShape, number> = {
    round: 1,
    oval: 1.25,
    pear: 1.2,
    marquise: 1.15,
    emerald: 1.35,
    cabochon: 1.1,
  }
  return round * (k[shape] ?? 1)
}
