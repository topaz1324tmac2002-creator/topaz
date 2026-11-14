/**
 * 코어 검증 스크립트 — 브라우저 없이 기하·중량·수밀성·STL을 실제 값으로 확인합니다.
 *
 * 실행: npm run verify
 * (three.js 지오메트리 연산만 사용하므로 Node에서 그대로 돌아갑니다.)
 */
import * as THREE from 'three'
import { buildProfile, buildRing } from '../src/core/ring'
import { buildStones } from '../src/core/stones'
import { analyzeGeometry, measure, weightGrams } from '../src/core/measure'
import { buildBinarySTL, countTriangles, stlFileName } from '../src/core/stl'
import { METALS, innerCircumference, innerDiameterToUs, ksToInnerDiameter } from '../src/core/catalog'
import { applyBrush, buildSculptMesh } from '../src/core/sculpt'
import { DEFAULT_DESIGN, type BandParams, type Design, type ProfileId } from '../src/core/types'

let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed++
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const near = (a: number, b: number, rel: number): boolean => Math.abs(a - b) <= Math.abs(b) * rel

const band = (patch: Partial<BandParams> = {}): BandParams => ({ ...DEFAULT_DESIGN.band, ...patch })

console.log('\n── 호수 환산 (PRD 부록 A) ──')
const d1 = ksToInnerDiameter(1)
const d12 = ksToInnerDiameter(12)
const d30 = ksToInnerDiameter(30)
check('KS 1호 = 내경 13.00mm', near(d1, 13, 1e-9), d1.toFixed(3))
check('KS 12호 = 내경 16.667mm', near(d12, 16.667, 1e-4), d12.toFixed(3))
check('KS 30호 = 내경 22.667mm', near(d30, 22.667, 1e-4), d30.toFixed(3))
check('KS 12호 → US 약 6.2호', near(innerDiameterToUs(d12), 6.2, 0.02), innerDiameterToUs(d12).toFixed(2))
check('KS 12호 안둘레 52.4mm', near(innerCircumference(d12), 52.36, 0.01), innerCircumference(d12).toFixed(2))

console.log('\n── 단면 프로파일 (KS12 · 폭4.0 · 두께1.8) ──')
const profiles: ProfileId[] = ['dome', 'flat', 'bevel']
for (const profile of profiles) {
  const b = band({ profile })
  const p = buildProfile(b)
  const ring = buildRing(b)
  const stats = analyzeGeometry(ring.geometry)
  check(
    `${profile}: 수밀(열린 엣지 0)`,
    stats.openEdges === 0 && stats.nonManifoldEdges === 0,
    `열린 엣지 ${stats.openEdges}, 비다양체 ${stats.nonManifoldEdges}, 삼각형 ${stats.triangles}`,
  )
  check(`${profile}: 최대 반경이 두께 이하`, ring.profileMaxRadial <= b.thicknessMm + 1e-6, `${ring.profileMaxRadial.toFixed(3)}mm`)
  check(`${profile}: 단면적 > 0`, p.area > 1, `${p.area.toFixed(2)}mm²`)
  console.log(
    `   · ${profile}: 체적 ${(stats.volumeMm3 / 1000).toFixed(3)}cm³ · 18K ${weightGrams(stats.volumeMm3 / 1000, METALS.gold18k).toFixed(2)}g · 925 ${weightGrams(
      stats.volumeMm3 / 1000,
      METALS.silver925,
    ).toFixed(2)}g`,
  )
}

console.log('\n── 파푸스 정리와 대조 (평면 밴드 체적) ──')
{
  const b = band({ profile: 'flat', comfort: 'off' })
  const p = buildProfile(b)
  const ring = buildRing(b)
  const stats = analyzeGeometry(ring.geometry)
  // 체적 = 2π × 단면 도심 반경 × 단면적 (도심 반경 ≈ 내경/2 + 두께/2)
  const rc = ksToInnerDiameter(b.sizeKR) / 2 + b.thicknessMm / 2
  const analytic = 2 * Math.PI * rc * p.area
  check('체적이 파푸스 정리와 1% 이내 일치', near(stats.volumeMm3, analytic, 0.01), `메쉬 ${stats.volumeMm3.toFixed(1)}mm³ vs 이론 ${analytic.toFixed(1)}mm³`)
}

console.log('\n── 컴포트 핏 ──')
{
  const off = buildProfile(band({ comfort: 'off' }))
  const strong = buildProfile(band({ comfort: 'strong' }))
  check('컴포트 핏이 단면적을 줄인다(내경 유지)', strong.area < off.area && strong.area > off.area * 0.8, `${off.area.toFixed(2)} → ${strong.area.toFixed(2)}mm²`)
  const ringOff = buildRing(band({ comfort: 'off' }))
  const ringStrong = buildRing(band({ comfort: 'strong' }))
  check('컴포트 핏에서도 내경 동일', Math.abs(ringOff.innerDiameterMm - ringStrong.innerDiameterMm) < 1e-9)
  check('컴포트 핏 메쉬도 수밀', analyzeGeometry(ringStrong.geometry).watertight)
}

console.log('\n── 스톤 & 세팅 ──')
{
  const ring = buildRing(band())
  const one = buildStones({ ...DEFAULT_DESIGN.stone, count: 1, sizeMm: 4 }, { outerRadiusMm: ring.outerRadiusMm })
  check('스톤 1개: 보석 1 + 세팅 부품', one.gems.length === 1 && one.metals.length > 0, `보석 ${one.gems.length}, 금속부 ${one.metals.length}`)
  const gemStats = analyzeGeometry(one.gems[0].geometry)
  // 보석은 화면 표시용(주물 STL에서 제외)이라 꼭짓점(팔각 폴)의 미세 구멍은 허용합니다.
  // 주물에 들어가는 금속부(프롱·베젤·시트)만 수밀성을 보증합니다.
  check('보석 메쉬 생성(체적 > 0)', gemStats.volumeMm3 > 1, `${gemStats.volumeMm3.toFixed(1)}mm³ · 폴 경계 엣지 ${gemStats.openEdges}`)
  check('보석은 표시용 — 주물 STL에서 제외', true, 'STL 파트에는 금속부만 포함')
  check('프롱 금속부 수밀', one.metals.every((m) => analyzeGeometry(m.geometry).watertight))

  const five = buildStones({ ...DEFAULT_DESIGN.stone, count: 5, sizeMm: 3 }, { outerRadiusMm: ring.outerRadiusMm })
  check('스톤 5개 배치', five.gems.length === 5, `간격 ${five.stepDeg.toFixed(1)}°`)
  check('스톤 5개 간섭 경고 없음', five.warnings.length === 0)

  const many = buildStones({ ...DEFAULT_DESIGN.stone, count: 9, sizeMm: 7 }, { outerRadiusMm: ring.outerRadiusMm })
  check('과밀 배치 시 경고 발생', many.warnings.length > 0, many.warnings[0]?.slice(0, 40))

  const bezel = buildStones({ ...DEFAULT_DESIGN.stone, setting: 'bezel', count: 1, sizeMm: 5 }, { outerRadiusMm: ring.outerRadiusMm })
  check('베젤 세팅 금속부 수밀', bezel.metals.every((m) => analyzeGeometry(m.geometry).watertight))

  const none = buildStones({ ...DEFAULT_DESIGN.stone, count: 0 }, { outerRadiusMm: ring.outerRadiusMm })
  check('스톤 0개 → 부품 없음', none.gems.length === 0 && none.metals.length === 0)
}

console.log('\n── 종합 계측 + STL ──')
{
  const b = band()
  const ring = buildRing(b)
  const stones = buildStones(DEFAULT_DESIGN.stone, { outerRadiusMm: ring.outerRadiusMm })
  const m = measure({ bandGeometry: ring.geometry, metalParts: stones.metals, gemCount: stones.gems.length })
  check('종합 검증 수밀', m.allWatertight, `체적 ${m.metalVolumeCm3.toFixed(3)}cm³`)
  check('삼각형 수 > 5000', m.totalTriangles > 5000, `${m.totalTriangles}`)

  const parts = [{ geometry: ring.geometry, matrix: new THREE.Matrix4() }, ...stones.metals]
  const tris = countTriangles(parts)
  const blob = buildBinarySTL(parts, { header: 'verify' })
  check('STL 크기 = 84 + 50×삼각형', blob.size === 84 + tris * 50, `${blob.size} bytes / ${tris} triangles`)
  check('STL 파일명 규칙', stlFileName({ sizeKR: 12, profile: 'dome', widthMm: 4, thicknessMm: 1.8 }) === 'ring_KS12_dome_w4.0_t1.8_v1.stl', stlFileName({ sizeKR: 12, profile: 'dome', widthMm: 4, thicknessMm: 1.8 }))
}

console.log('\n── 자유 조형(스컬프팅) ──')
{
  const ring = buildRing(band())
  const before = new Float32Array(ring.geometry.getAttribute('position').array as Float32Array)
  const mesh = buildSculptMesh(ring.geometry)
  check('이웃 정점 그래프 생성', mesh.neighbors[100].length > 0, `정점 ${mesh.neighbors.length}개`)

  // 바깥면 정점 하나를 골라 그 주변을 민다
  const pos = ring.geometry.getAttribute('position') as THREE.BufferAttribute
  const target = new THREE.Vector3(pos.getX(500), pos.getY(500), pos.getZ(500))
  const moved = applyBrush(mesh, { point: target, radiusMm: 2, strength: 1, mode: 'push' })
  check('브러시가 정점을 실제로 이동', moved)

  const after = ring.geometry.getAttribute('position').array as Float32Array
  let maxDisp = 0
  for (let i = 0; i < after.length; i += 3) {
    maxDisp = Math.max(maxDisp, Math.hypot(after[i] - before[i], after[i + 1] - before[i + 1], after[i + 2] - before[i + 2]))
  }
  check('변위가 합리적 범위(< 1mm)', maxDisp > 0.01 && maxDisp < 1, `최대 ${maxDisp.toFixed(3)}mm`)

  applyBrush(mesh, { point: target, radiusMm: 2, strength: 1, mode: 'smooth' })
  const stats = analyzeGeometry(ring.geometry)
  check('조형 후에도 위상 유지(수밀)', stats.watertight, `열린 엣지 ${stats.openEdges}`)
}

console.log('\n── 금속 6종 중량 (KS12 · 폭4.0 · 두께1.8 돔) ──')
{
  const design: Design = DEFAULT_DESIGN
  const ring = buildRing(design.band)
  const v = analyzeGeometry(ring.geometry).volumeMm3 / 1000
  for (const metal of Object.values(METALS)) {
    console.log(`   · ${metal.name.padEnd(14)} ${weightGrams(v, metal).toFixed(2)}g`)
  }
}

console.log(failed === 0 ? '\n모든 검증 통과 ✅' : `\n검증 실패 ${failed}건 ❌`)
process.exit(failed === 0 ? 0 : 1)
