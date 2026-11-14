/**
 * 스톤 & 세팅 생성기 — 보석 형상 + 프롱/베젤 금속부.
 *
 * 스톤 로컬 좌표계: +Y 가 "바깥(반지 반경 방향)", 원점은 거들(girdle) 평면 중심.
 * 반지 위 배치: 각도 θ 위치의 바깥면에 로컬 +Y 가 방사방향을 향하도록 놓습니다.
 */
import * as THREE from 'three'
import type { StoneParams } from './types'
import type { Vec2 } from './ring'
import { buildTubeGeometry } from './ring'

export interface MeshPart {
  geometry: THREE.BufferGeometry
  matrix: THREE.Matrix4
}

export interface StoneLayout {
  /** 보석(중량 계산·주물 STL에서 제외) */
  gems: MeshPart[]
  /** 세팅 금속부(프롱·베젤·시트) */
  metals: MeshPart[]
  warnings: string[]
  /** 보석 1개당 겉보기 외접 지름 mm */
  stoneFootprintMm: number
  stepDeg: number
}

const OVAL_RATIO = 1.4

function latheGem(sizeMm: number, oval: boolean): THREE.BufferGeometry {
  const g = sizeMm / 2
  const crownH = sizeMm * 0.22
  const pavH = sizeMm * 0.45
  const tableR = g * 0.55
  const girdle = sizeMm * 0.055
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.0001, crownH),
    new THREE.Vector2(tableR, crownH),
    new THREE.Vector2(g * 0.9, crownH * 0.5),
    new THREE.Vector2(g, girdle),
    new THREE.Vector2(g, -girdle),
    new THREE.Vector2(g * 0.62, -pavH * 0.5),
    new THREE.Vector2(0.0001, -pavH),
  ]
  const geo = new THREE.LatheGeometry(pts, 12)
  if (oval) geo.scale(OVAL_RATIO, 1, 1)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

/** 프롱 1개: 아래가 굵고 위로 가늘어지는 기둥 + 끝의 작은 구(볼 프롱) */
function buildProngs(params: StoneParams): THREE.BufferGeometry[] {
  const n = params.setting === 'prong6' ? 6 : 4
  const g = params.sizeMm / 2
  const r = params.prongMm / 2
  const crownH = params.sizeMm * 0.22
  const bottom = -params.sizeMm * 0.18
  const top = crownH * 0.72
  const height = top - bottom
  const out: THREE.BufferGeometry[] = []

  const cyl = new THREE.CylinderGeometry(r * 0.82, r, height, 10, 1, false)
  cyl.translate(0, (top + bottom) / 2, 0)
  const ball = new THREE.SphereGeometry(r * 0.95, 10, 7)
  ball.translate(0, top, 0)

  const ovalScale = params.shape === 'oval' ? OVAL_RATIO : 1
  for (let k = 0; k < n; k++) {
    const phi = params.setting === 'prong6' ? (k / n) * Math.PI * 2 : ((k + 0.5) / n) * Math.PI * 2
    const px = Math.cos(phi) * g * 0.94 * ovalScale
    const pz = Math.sin(phi) * g * 0.94
    const c = cyl.clone()
    c.translate(px, 0, pz)
    const b = ball.clone()
    b.translate(px, 0, pz)
    out.push(c, b)
  }
  cyl.dispose()
  ball.dispose()
  return out
}

/** 베젤: 스톤 둘레를 감싸는 닫힌 금속 벽(수밀) */
function buildBezel(params: StoneParams): THREE.BufferGeometry {
  const g = params.sizeMm / 2
  const wall = Math.max(0.35, params.sizeMm * 0.11)
  const hh = params.sizeMm * 0.14
  const profile: Vec2[] = [
    [0, -hh],
    [wall, -hh * 0.9],
    [wall, hh],
    [0, hh],
  ]
  const geo = buildTubeGeometry(profile, g * 1.02, 64)
  geo.rotateX(-Math.PI / 2)
  if (params.shape === 'oval') geo.scale(OVAL_RATIO, 1, 1)
  geo.computeBoundingSphere()
  return geo
}

/** 스톤 아래 시트(받침) — 밴드와 스톤을 시각적으로 연결 */
function buildSeat(params: StoneParams): THREE.BufferGeometry {
  const g = params.sizeMm / 2
  const geo = new THREE.CylinderGeometry(g * 0.78, g * 0.5, params.sizeMm * 0.34, 14, 1, false)
  geo.translate(0, -params.sizeMm * 0.2, 0)
  if (params.shape === 'oval') geo.scale(OVAL_RATIO, 1, 1)
  return geo
}

export function buildStones(params: StoneParams, ring: { outerRadiusMm: number }): StoneLayout {
  const warnings: string[] = []
  const Rb = ring.outerRadiusMm
  const count = Math.max(0, Math.min(9, Math.round(params.count)))
  const ovalScale = params.shape === 'oval' ? OVAL_RATIO : 1
  const footprint = params.sizeMm * ovalScale

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

  const gemGeo = latheGem(params.sizeMm, params.shape === 'oval')
  const metalGeos =
    params.setting === 'bezel'
      ? [buildBezel(params), buildSeat(params)]
      : [...buildProngs(params), buildSeat(params)]

  const gems: MeshPart[] = []
  const metals: MeshPart[] = []
  const lift = Math.max(0.08, params.sizeMm * 0.06)

  for (let k = 0; k < count; k++) {
    const theta = -total / 2 + k * stepRad + offset
    const u = new THREE.Vector3(Math.sin(theta), Math.cos(theta), 0) // 방사방향
    const w = new THREE.Vector3(Math.cos(theta), -Math.sin(theta), 0) // 접선방향
    const zAxis = new THREE.Vector3().crossVectors(w, u)
    const m = new THREE.Matrix4().makeBasis(w, u, zAxis)
    const pos = u.clone().multiplyScalar(Rb + lift)
    m.setPosition(pos)
    gems.push({ geometry: gemGeo, matrix: m.clone() })
    for (const g of metalGeos) metals.push({ geometry: g, matrix: m.clone() })
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
 *  oval: 같은 단축 지름의 라운드 대략 1.25배 (긴 축 1.4배 × 패싯 손실 보정)
 */
export function estimateCarat(sizeMm: number, shape: 'round' | 'oval'): number {
  const d = Math.max(0.5, sizeMm)
  const round = 0.0037 * d * d * d
  return shape === 'round' ? round : round * 1.25
}
