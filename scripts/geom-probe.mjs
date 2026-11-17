/** 씬에 추가된 보석 메쉬의 월드 바운딩 스피어를 확인하는 단위 프로브 (브라우저 없음) */
import { buildStones, buildGemGeometry } from '/workspace/work/jewelry-studio/src/core/stones.ts'
import { buildRing } from '/workspace/work/jewelry-studio/src/core/ring.ts'

import * as THREE from 'three'

const band = { sizeKR: 12, widthMm: 4, thicknessMm: 1.8, profile: 'dome', comfort: 'soft' }
const ring = buildRing(band)
const layout = buildStones(
  { shape: 'cabochon', setting: 'halo', count: 1, sizeMm: 8, prongMm: 0.9, rotationDeg: 0, gem: 'topaz' },
  { outerRadiusMm: ring.outerRadiusMm, profileRadial: ring.profileMaxRadial },
)
console.log('gems:', layout.gems.length, 'metals:', layout.metals.length, 'lift calc')
for (const [i, g] of layout.gems.entries()) {
  g.geometry.computeBoundingSphere()
  const bs = g.geometry.boundingSphere
  const c = bs.center.clone().applyMatrix4(g.matrix)
  const r = bs.radius
  const rr = Math.hypot(c.x, c.y)
  console.log(`gem${i}: center=(${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)}) r=${r.toFixed(2)} radialCenter=${rr.toFixed(2)} minR=${(rr - r).toFixed(2)} maxR=${(rr + r).toFixed(2)} innerR=${ring.innerRadiusMm.toFixed(2)} outerR=${ring.outerRadiusMm.toFixed(2)}`)
}
for (const [i, m] of layout.metals.entries()) {
  m.geometry.computeBoundingSphere()
  const bs = m.geometry.boundingSphere
  const c = bs.center.clone().applyMatrix4(m.matrix)
  console.log(`metal${i}: center=(${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)}) r=${bs.radius.toFixed(2)}`)
}
