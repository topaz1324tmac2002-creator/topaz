/**
 * 바이너리 STL 내보내기 — 부품(밴드 + 세팅 금속부)을 하나의 STL로 합칩니다.
 * 정점 변환은 각 부품의 월드 행렬로 직접 처리하므로 별도 병합 라이브러리가 필요 없습니다.
 */
import * as THREE from 'three'

export interface StlPart {
  geometry: THREE.BufferGeometry
  matrix: THREE.Matrix4
}

export interface StlOptions {
  header?: string
  /** mm 단위 그대로 저장. 슬라이서 관행(Z-up)을 위해 회전할 수 있습니다. */
  zUp?: boolean
}

function triangleCount(geometry: THREE.BufferGeometry): number {
  const idx = geometry.getIndex()
  if (idx) return idx.count / 3
  return geometry.getAttribute('position').count / 3
}

export function countTriangles(parts: StlPart[]): number {
  return parts.reduce((s, p) => s + triangleCount(p.geometry), 0)
}

export function buildBinarySTL(parts: StlPart[], opts: StlOptions = {}): Blob {
  const total = countTriangles(parts)
  const buffer = new ArrayBuffer(84 + total * 50)
  const view = new DataView(buffer)
  const header = (opts.header ?? 'jewelry-studio').slice(0, 79)
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i))
  view.setUint32(80, total, true)

  const v0 = new THREE.Vector3()
  const v1 = new THREE.Vector3()
  const v2 = new THREE.Vector3()
  const n = new THREE.Vector3()
  const e1 = new THREE.Vector3()
  const e2 = new THREE.Vector3()
  const rot = opts.zUp === false ? null : new THREE.Matrix4().makeRotationX(-Math.PI / 2)
  let offset = 84

  for (const part of parts) {
    const geo = part.geometry
    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    const idx = geo.getIndex()
    const tris = triangleCount(geo)
    const m = part.matrix
    for (let t = 0; t < tris; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2
      v0.fromBufferAttribute(pos, i0).applyMatrix4(m)
      v1.fromBufferAttribute(pos, i1).applyMatrix4(m)
      v2.fromBufferAttribute(pos, i2).applyMatrix4(m)
      if (rot) {
        v0.applyMatrix4(rot)
        v1.applyMatrix4(rot)
        v2.applyMatrix4(rot)
      }
      e1.subVectors(v1, v0)
      e2.subVectors(v2, v0)
      n.crossVectors(e1, e2)
      if (n.lengthSq() > 1e-16) n.normalize()
      else n.set(0, 0, 0)

      view.setFloat32(offset, n.x, true); offset += 4
      view.setFloat32(offset, n.y, true); offset += 4
      view.setFloat32(offset, n.z, true); offset += 4
      for (const v of [v0, v1, v2]) {
        view.setFloat32(offset, v.x, true); offset += 4
        view.setFloat32(offset, v.y, true); offset += 4
        view.setFloat32(offset, v.z, true); offset += 4
      }
      view.setUint16(offset, 0, true); offset += 2
    }
  }

  return new Blob([buffer], { type: 'model/stl' })
}

export function stlFileName(args: { sizeKR: number; profile: string; widthMm: number; thicknessMm: number }): string {
  const w = args.widthMm.toFixed(1)
  const t = args.thicknessMm.toFixed(1)
  return `ring_KS${args.sizeKR}_${args.profile}_w${w}_t${t}_v1.stl`
}
