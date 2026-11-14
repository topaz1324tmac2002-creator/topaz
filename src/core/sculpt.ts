/**
 * 자유 조형(스컬프팅) — 실제 메쉬 정점 변형.
 *
 * 브러시 3종: 밀기(push) / 당기기(pull) / 스무스(smooth).
 * 밀기·당기기는 정점 법선 방향으로, 스무스는 이웃 정점 평균으로 이동시킵니다.
 * 파라메트릭 메쉬를 "베이크"해서 조형용 사본으로 쓰기 때문에, 조형 중에도 되돌리기가 가능합니다.
 */
import * as THREE from 'three'

export interface SculptMesh {
  geometry: THREE.BufferGeometry
  neighbors: number[][]
  /** 조형 초기화용 원본 좌표 */
  base: Float32Array
  strokes: number
}

export function buildSculptMesh(geometry: THREE.BufferGeometry): SculptMesh {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute
  const base = new Float32Array(pos.array as Float32Array)
  const neighbors: number[][] = Array.from({ length: pos.count }, () => [])
  const seen = new Set<number>()
  const idx = geometry.getIndex()

  const link = (a: number, b: number): void => {
    const k = a < b ? a * 5_000_003 + b : b * 5_000_003 + a
    if (seen.has(k)) return
    seen.add(k)
    neighbors[a].push(b)
    neighbors[b].push(a)
  }

  if (idx) {
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t)
      const b = idx.getX(t + 1)
      const c = idx.getX(t + 2)
      link(a, b)
      link(b, c)
      link(c, a)
    }
  }

  return { geometry, neighbors, base, strokes: 0 }
}

export interface BrushOptions {
  /** 메쉬 로컬 좌표의 브러시 중심 */
  point: THREE.Vector3
  radiusMm: number
  /** 0~1 */
  strength: number
  mode: 'push' | 'pull' | 'smooth'
}

/** 브러시를 한 번 적용합니다. 실제로 움직인 정점이 있으면 true */
export function applyBrush(mesh: SculptMesh, opts: BrushOptions): boolean {
  const geo = mesh.geometry
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute
  const nrmAttr = geo.getAttribute('normal') as THREE.BufferAttribute | undefined
  if (!nrmAttr) return false
  const pos = posAttr.array as Float32Array
  const nrm = nrmAttr.array as Float32Array
  const r = Math.max(0.2, opts.radiusMm)
  const r2 = r * r
  const sign = opts.mode === 'pull' ? -1 : 1
  const maxStep = r * 0.16
  const step = opts.strength * r * 0.06
  const smoothK = Math.min(0.9, opts.strength * 0.65)

  let touched = false
  const px = opts.point.x
  const py = opts.point.y
  const pz = opts.point.z

  // 스무스는 이웃 평균을 동시에 반영해야 하므로 원본 좌표 사본을 사용
  const src = opts.mode === 'smooth' ? new Float32Array(pos) : null

  for (let i = 0; i < posAttr.count; i++) {
    const dx = pos[i * 3] - px
    const dy = pos[i * 3 + 1] - py
    const dz = pos[i * 3 + 2] - pz
    const d2 = dx * dx + dy * dy + dz * dz
    if (d2 > r2) continue
    const falloff = Math.pow(1 - d2 / r2, 2)
    if (falloff <= 0) continue
    touched = true

    if (opts.mode === 'smooth') {
      const nb = mesh.neighbors[i]
      if (!nb || nb.length === 0 || !src) continue
      let ax = 0
      let ay = 0
      let az = 0
      for (const j of nb) {
        ax += src[j * 3]
        ay += src[j * 3 + 1]
        az += src[j * 3 + 2]
      }
      const inv = 1 / nb.length
      const k = smoothK * falloff
      pos[i * 3] += (ax * inv - pos[i * 3]) * k
      pos[i * 3 + 1] += (ay * inv - pos[i * 3 + 1]) * k
      pos[i * 3 + 2] += (az * inv - pos[i * 3 + 2]) * k
    } else {
      const amount = Math.min(maxStep, step * falloff) * sign
      pos[i * 3] += nrm[i * 3] * amount
      pos[i * 3 + 1] += nrm[i * 3 + 1] * amount
      pos[i * 3 + 2] += nrm[i * 3 + 2] * amount
    }
  }

  if (touched) {
    posAttr.needsUpdate = true
    geo.computeVertexNormals()
    geo.getAttribute('normal')!.needsUpdate = true
    geo.computeBoundingSphere()
    geo.computeBoundingBox()
    mesh.strokes++
  }
  return touched
}

/** 브러시 반경 안의 정점이 충분히 있는지 (조형 품질 안내용) */
export function brushVertexCount(mesh: SculptMesh, point: THREE.Vector3, radiusMm: number): number {
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
  const r2 = radiusMm * radiusMm
  let n = 0
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i) - point.x
    const dy = pos.getY(i) - point.y
    const dz = pos.getZ(i) - point.z
    if (dx * dx + dy * dy + dz * dz <= r2) n++
  }
  return n
}

export function resetSculpt(mesh: SculptMesh): void {
  const posAttr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
  const arr = posAttr.array as Float32Array
  arr.set(mesh.base)
  posAttr.needsUpdate = true
  mesh.geometry.computeVertexNormals()
  mesh.geometry.getAttribute('normal')!.needsUpdate = true
  mesh.geometry.computeBoundingSphere()
  mesh.strokes = 0
}
