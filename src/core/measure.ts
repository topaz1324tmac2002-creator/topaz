/**
 * 계측 — 체적·표면적·수밀성(watertight) 검사, 금속 중량 계산.
 * 검사는 색인(index)이 아니라 정점 좌표를 용접(weld)한 뒤 엣지 차수로 판정합니다.
 * (three.js 기본 도형은 같은 위치의 정점을 중복 생성하기 때문)
 */
import * as THREE from 'three'
import type { MeshPart } from './stones'
import { surfaceArea, signedVolume } from './ring'
import type { Metal } from './types'

export interface GeometryStats {
  volumeMm3: number
  areaMm2: number
  triangles: number
  vertices: number
  /** 열린 엣지(구멍) 수 */
  openEdges: number
  /** 3개 이상 면이 붙은 비다양체 엣지 수 */
  nonManifoldEdges: number
  watertight: boolean
}

const WELD = 1e4 // 0.0001mm 해상도

export function analyzeGeometry(geo: THREE.BufferGeometry): GeometryStats {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const idx = geo.getIndex()
  const triCount = idx ? idx.count / 3 : pos.count / 3

  // 1) 좌표 용접
  const map = new Map<string, number>()
  const remap = new Int32Array(pos.count)
  for (let i = 0; i < pos.count; i++) {
    const x = Math.round(pos.getX(i) * WELD)
    const y = Math.round(pos.getY(i) * WELD)
    const z = Math.round(pos.getZ(i) * WELD)
    const key = `${x},${y},${z}`
    let id = map.get(key)
    if (id === undefined) {
      id = map.size
      map.set(key, id)
    }
    remap[i] = id
  }

  // 2) 엣지 차수
  const edges = new Map<string, number>()
  for (let t = 0; t < triCount; t++) {
    const a = remap[idx ? idx.getX(t * 3) : t * 3]
    const b = remap[idx ? idx.getX(t * 3 + 1) : t * 3 + 1]
    const c = remap[idx ? idx.getX(t * 3 + 2) : t * 3 + 2]
    if (a === b || b === c || c === a) continue // 퇴화 삼각형
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const k = u < v ? `${u}_${v}` : `${v}_${u}`
      edges.set(k, (edges.get(k) ?? 0) + 1)
    }
  }
  let openEdges = 0
  let nonManifoldEdges = 0
  for (const count of edges.values()) {
    if (count === 1) openEdges++
    else if (count > 2) nonManifoldEdges++
  }

  return {
    volumeMm3: Math.abs(signedVolume(geo)),
    areaMm2: surfaceArea(geo),
    triangles: triCount,
    vertices: map.size,
    openEdges,
    nonManifoldEdges,
    watertight: openEdges === 0 && nonManifoldEdges === 0,
  }
}

export interface PartStats {
  label: string
  stats: GeometryStats
  /** 같은 지오메트리를 쓰는 부품 수 */
  instances: number
}

export interface MeasureResult {
  band: GeometryStats | null
  metalParts: PartStats[]
  /** 밴드 + 세팅 금속부 체적 mm³ (부품 사이 겹침분은 중복 계산됨) */
  metalVolumeMm3: number
  metalVolumeCm3: number
  gemCount: number
  allWatertight: boolean
  totalTriangles: number
  openEdges: number
  nonManifoldEdges: number
}

export interface MeasureInput {
  bandGeometry: THREE.BufferGeometry | null
  metalParts: MeshPart[]
  gemCount: number
}

export function measure(input: MeasureInput): MeasureResult {
  const band = input.bandGeometry ? analyzeGeometry(input.bandGeometry) : null

  const unique = new Map<THREE.BufferGeometry, { stats: GeometryStats; count: number }>()
  for (const p of input.metalParts) {
    const prev = unique.get(p.geometry)
    if (prev) prev.count++
    else unique.set(p.geometry, { stats: analyzeGeometry(p.geometry), count: 1 })
  }

  const metalParts: PartStats[] = [...unique.entries()].map(([geo, v], i) => ({
    label: `세팅 금속부 ${i + 1} · ${geo.type}`,
    stats: v.stats,
    instances: v.count,
  }))

  let metalVolumeMm3 = band?.volumeMm3 ?? 0
  let totalTriangles = band?.triangles ?? 0
  let openEdges = band?.openEdges ?? 0
  let nonManifoldEdges = band?.nonManifoldEdges ?? 0
  let allWatertight = band?.watertight ?? true

  for (const { stats, count } of unique.values()) {
    metalVolumeMm3 += stats.volumeMm3 * count
    totalTriangles += stats.triangles * count
    openEdges += stats.openEdges * count
    nonManifoldEdges += stats.nonManifoldEdges * count
    allWatertight = allWatertight && stats.watertight
  }

  return {
    band,
    metalParts,
    metalVolumeMm3,
    metalVolumeCm3: metalVolumeMm3 / 1000,
    gemCount: input.gemCount,
    allWatertight,
    totalTriangles,
    openEdges,
    nonManifoldEdges,
  }
}

/** 중량(g) = 체적(cm³) × 비중(g/cm³) × (1 + 수축률) */
export function weightGrams(volumeCm3: number, metal: Metal): number {
  return volumeCm3 * metal.density * (1 + metal.shrink)
}

export interface DesignCheck {
  level: 'ok' | 'warn' | 'fail'
  title: string
  detail: string
}

/** 파라메트릭 기준 검사(형상 기반 검사와 별개로, 실무 기준값을 문장으로 알려줍니다) */
export function parametricChecks(args: {
  thicknessMm: number
  widthMm: number
  stoneSizeMm: number
  stoneCount: number
  engravingOn: boolean
  engravingHeightMm: number
  sculpted: boolean
  measure: MeasureResult | null
}): DesignCheck[] {
  const out: DesignCheck[] = []
  const m = args.measure

  if (m) {
    if (m.allWatertight) {
      out.push({
        level: 'ok',
        title: '수밀(Watertight) 통과',
        detail: '열린 구멍·비다양체 엣지가 없습니다. 프린터 슬라이서에서 단일 솔리드로 인식됩니다.',
      })
    } else {
      out.push({
        level: 'fail',
        title: '메쉬에 구멍이 있습니다',
        detail: `열린 엣지 ${m.openEdges}개 · 비다양체 엣지 ${m.nonManifoldEdges}개. 조형을 되돌리거나 자동 수선이 필요합니다.`,
      })
    }
  }

  if (args.thicknessMm < 0.8) {
    out.push({
      level: 'warn',
      title: '밴드 두께가 얇습니다',
      detail: `현재 ${args.thicknessMm.toFixed(1)}mm. 주물 기준 권장 최소 0.8mm(수업 기본 1.0mm 이상)입니다.`,
    })
  } else {
    out.push({
      level: 'ok',
      title: '최소 벽 두께 확보',
      detail: `밴드 두께 ${args.thicknessMm.toFixed(1)}mm ≥ 기준 0.8mm`,
    })
  }

  if (args.stoneCount > 0 && args.stoneSizeMm > args.widthMm * 1.05) {
    out.push({
      level: 'warn',
      title: '스톤이 밴드 폭보다 큽니다',
      detail: `스톤 ${args.stoneSizeMm.toFixed(1)}mm > 밴드 폭 ${args.widthMm.toFixed(1)}mm. 세팅부가 밴드 밖으로 돌출됩니다(실제 주물에서는 폭 확장 또는 스톤 축소 필요).`,
    })
  }

  if (args.engravingOn && args.engravingHeightMm > args.widthMm * 0.7) {
    out.push({
      level: 'warn',
      title: '각인 글자가 밴드 폭을 넘습니다',
      detail: `문자 높이 ${args.engravingHeightMm.toFixed(1)}mm 는 폭 ${args.widthMm.toFixed(1)}mm 밴드에 비해 큽니다. 0.8~2.5mm 범위에서 줄여 주세요.`,
    })
  }

  if (args.sculpted) {
    out.push({
      level: 'warn',
      title: '자유 조형이 적용된 메쉬입니다',
      detail: '조형 중에는 파라메트릭 검증이 아니라 실제 메쉬 기준으로 검사합니다. 파라미터를 바꾸면 조형이 초기화됩니다.',
    })
  }

  return out
}
