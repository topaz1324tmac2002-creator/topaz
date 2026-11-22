/**
 * 코어 검증 스크립트 — 브라우저 없이 기하·중량·수밀성·STL을 실제 값으로 확인합니다.
 *
 * 실행: npm run verify
 * (three.js 지오메트리 연산만 사용하므로 Node에서 그대로 돌아갑니다.)
 */
import * as THREE from 'three'
import { buildProfile, buildRing } from '../src/core/ring'
import { buildStones, buildGemGeometry, buildMeleeGeometry, estimateCarat } from '../src/core/stones'
import { surfaceRadius, ENGRAVE_STANDOFF_MM } from '../src/core/engraving'
import { stoneOutlineMm, outlineAtAngle, outlinePerimeter, sampleOutline } from '../src/core/shapes'
import { analyzeGeometry, measure, weightGrams } from '../src/core/measure'
import { buildBinarySTL, countTriangles, stlFileName } from '../src/core/stl'
import { GEMS, GEM_ORDER, METALS, SETTINGS, STONE_SHAPES, innerCircumference, innerDiameterToUs, ksToInnerDiameter } from '../src/core/catalog'
import { DEFAULT_DESIGN, type BandParams, type Design, type ProfileId, type SettingType, type StoneShape } from '../src/core/types'

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
const profiles: ProfileId[] = ['dome', 'flat', 'bevel', 'twist']
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
  const limit = b.thicknessMm + (profile === 'twist' ? Math.min(0.45, Math.max(0.18, b.thicknessMm * 0.24)) + 1e-6 : 1e-6)
  check(`${profile}: 최대 반경이 단면 두께 범위 안`, ring.profileMaxRadial <= limit, `${ring.profileMaxRadial.toFixed(3)}mm ≤ ${limit.toFixed(3)}mm`)
  check(`${profile}: 단면적 > 0`, p.area > 1, `${p.area.toFixed(2)}mm²`)
  console.log(
    `   · ${profile}: 체적 ${(stats.volumeMm3 / 1000).toFixed(3)}cm³ · 18K ${weightGrams(stats.volumeMm3 / 1000, METALS.gold18k).toFixed(2)}g · 925 ${weightGrams(
      stats.volumeMm3 / 1000,
      METALS.silver925,
    ).toFixed(2)}g`,
  )
}

console.log('\n── 트위스트(나선 리브) 밴드 ──')
{
  const b = band({ profile: 'twist' })
  const ring = buildRing(b)
  const geo = ring.geometry
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  let minR = Infinity
  let maxR = 0
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i))
    minR = Math.min(minR, r)
    maxR = Math.max(maxR, r)
  }
  check('트위스트: 안쪽 원통면 유지(내경 동일)', near(minR, ring.innerRadiusMm, 1e-6), `최소 반경 ${minR.toFixed(4)}mm / 내경 반경 ${ring.innerRadiusMm.toFixed(4)}mm`)
  check(
    '트위스트: 리브가 바깥으로만 솟는다',
    maxR <= ring.innerRadiusMm + ring.profileMaxRadial + 1e-3,
    `최대 ${maxR.toFixed(3)}mm ≤ ${(ring.innerRadiusMm + ring.profileMaxRadial).toFixed(3)}mm`,
  )
  const stats = analyzeGeometry(geo)
  check('트위스트: 수밀(주물 가능)', stats.watertight, `열린 엣지 ${stats.openEdges}`)
  // 리브가 실제로 반경을 흔드는지(평평한 회전체가 아닌지)
  let varSum = 0
  let n = 0
  const seg = ring.segments
  for (let j = 0; j < pos.count; j += 1) {
    const idx = j
    // 같은 축방향·프로파일 위치에서 이웃 각도끼리 반경 차이를 봅니다.
    if (idx % seg === 0 && idx + seg < pos.count) {
      const r1 = Math.hypot(pos.getX(idx), pos.getY(idx))
      const r2 = Math.hypot(pos.getX(idx + seg), pos.getY(idx + seg))
      varSum += Math.abs(r1 - r2)
      n++
    }
  }
  check('트위스트: 각도에 따라 반경이 변한다', n > 0 && varSum / Math.max(1, n) > 0.01, `평균 인접 편차 ${(varSum / Math.max(1, n)).toFixed(4)}mm`)
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

console.log('\n── 스톤 모양 6종 (브릴리언트 · 스텝 · 캐보션) ──')
{
  const shapes: StoneShape[] = ['round', 'oval', 'pear', 'marquise', 'emerald', 'cabochon']
  for (const shape of shapes) {
    const spec = STONE_SHAPES.find((s) => s.id === shape)!
    const geo = buildGemGeometry(shape, 5)
    const stats = analyzeGeometry(geo)
    const outline = stoneOutlineMm(shape, 5)
    const longAxis = Math.max(...outline.map((p) => Math.abs(p[0]))) * 2
    check(
      `${spec.label}: 보석 메쉬 수밀 · 체적 > 0`,
      stats.watertight && stats.volumeMm3 > 1,
      `${stats.volumeMm3.toFixed(1)}mm³ · 삼각형 ${stats.triangles} · 열린 엣지 ${stats.openEdges}`,
    )
    check(
      `${spec.label}: 긴 축 = ${(5 * spec.aspect).toFixed(1)}mm`,
      near(longAxis, 5 * spec.aspect, 0.02),
      `실제 ${longAxis.toFixed(2)}mm · 외곽 길이 ${outlinePerimeter(outline).toFixed(2)}mm`,
    )
    const carat = estimateCarat(5, shape)
    check(`${spec.label}: 캐럿 추정 > 0`, carat > 0.1, `${carat.toFixed(2)}ct`)
  }
  // 브릴리언트/스텝은 각 면이 납작하게 보이도록 비색인(flat) 지오메트리,
  // 캐보션은 매끈한 곡면이 되도록 색인(smooth) 지오메트리를 유지합니다.
  const faceted = ['round', 'oval', 'pear', 'marquise', 'emerald'] as StoneShape[]
  const flatOk = faceted.every((sh) => buildGemGeometry(sh, 5).getIndex() === null)
  check('브릴리언트·스텝 컷: 납작한 패싯(비색인 + 면 법선)', flatOk)
  check('캐보션: 매끈한 곡면(색인 + 정점 법선)', buildGemGeometry('cabochon', 5).getIndex() !== null)
  const emeraldOutline = stoneOutlineMm('emerald', 5)
  const corners = emeraldOutline.filter((p, i) => {
    const a = emeraldOutline[(i - 1 + emeraldOutline.length) % emeraldOutline.length]
    const b = emeraldOutline[(i + 1) % emeraldOutline.length]
    const v1 = [p[0] - a[0], p[1] - a[1]]
    const v2 = [b[0] - p[0], b[1] - p[1]]
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1)
    return cos < Math.cos((20 * Math.PI) / 180)
  })
  check('에메랄드컷: 깎은 모서리 8개(직사각형 스텝 컷)', corners.length === 8, `모서리 ${corners.length}개`)

  // 스톤마다 밴드 안쪽을 뚫지 않는지(모양 × 세팅)
  const ringForStone = buildRing(band())
  for (const shape of shapes) {
    const laid = buildStones(
      { ...DEFAULT_DESIGN.stone, shape, setting: 'halo', count: 1, sizeMm: 6 },
      { outerRadiusMm: ringForStone.outerRadiusMm, profileRadial: ringForStone.profileMaxRadial },
    )
    let minR = Infinity
    for (const g of laid.gems) {
      const p = g.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < p.count; i++) {
        const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(g.matrix)
        minR = Math.min(minR, Math.hypot(v.x, v.y))
      }
    }
    check(`${shape}: 보석이 손가락 면을 뚫지 않는다`, minR > ringForStone.innerRadiusMm - 0.01, `최소 반경 ${minR.toFixed(2)}mm ≥ ${ringForStone.innerRadiusMm.toFixed(2)}mm`)
  }
  const melee = analyzeGeometry(buildMeleeGeometry(1.2))
  check('메레 스톤(라운드 브릴리언트) 수밀', melee.watertight, `삼각형 ${melee.triangles}`)
}

console.log('\n── 보석 색 6종 ──')
{
  check('보석 프리셋 6종', GEM_ORDER.length === 6, GEM_ORDER.map((id) => GEMS[id].name).join(' · '))
  const iors = GEM_ORDER.map((id) => GEMS[id].ior)
  check('굴절률이 서로 구분된다', new Set(iors.map((v) => v.toFixed(2))).size >= 4, iors.join(' / '))
  check('루비는 붉은 계열', (GEMS.ruby.color >> 16) > 0x80 && (GEMS.ruby.color & 0xff) < 0x60, `#${GEMS.ruby.color.toString(16)}`)
  check('사파이어는 푸른 계열', (GEMS.sapphire.color & 0xff) > 0x80, `#${GEMS.sapphire.color.toString(16)}`)
  check('시트린은 황금색 계열', (GEMS.citrine.color >> 16) > 0xc0 && (GEMS.citrine.color & 0xff) < 0x60, `#${GEMS.citrine.color.toString(16)}`)
  check('토파즈는 하늘색 계열', (GEMS.topaz.color & 0xff) > 0xb0, `#${GEMS.topaz.color.toString(16)}`)

  const blk = GEMS.blackDiamond
  check('블랙 다이아몬드 몸체가 깊은 검정', (blk.color >> 16) <= 0x18 && (blk.color & 0xff) <= 0x18, `#${blk.color.toString(16)}`)
  check('블랙 다이아몬드는 투과하지 않는다', blk.opaque === true && blk.transmission === 0, `opaque ${blk.opaque}, transmission ${blk.transmission}`)
  check(
    '블랙 다이아몬드 표면 반사가 살아 있다',
    blk.roughness <= 0.03 && (blk.clearcoat ?? 0) >= 0.8 && (blk.clearcoatRoughness ?? 1) <= 0.01 && (blk.specularIntensity ?? 1) > 0,
    `거칠기 ${blk.roughness}, 코트 ${blk.clearcoat}/${blk.clearcoatRoughness}, 하이라이트 ${blk.specularIntensity}`,
  )
  check(
    '블랙 다이아몬드는 환경 반사를 낮춘다',
    blk.envIntensity <= GEMS.diamond.envIntensity * 0.2,
    `환경 반사 ${blk.envIntensity} (다이아몬드 ${GEMS.diamond.envIntensity} 대비 ${Math.round((blk.envIntensity / GEMS.diamond.envIntensity) * 100)}%)`,
  )
  check('블랙 다이아몬드 굴절률은 다이아몬드와 같다', Math.abs(blk.ior - GEMS.diamond.ior) < 1e-6, `IOR ${blk.ior}`)
}

console.log('\n── 스톤 & 세팅 (모양 × 세팅 조합) ──')
{
  const ring = buildRing(band())
  const one = buildStones({ ...DEFAULT_DESIGN.stone, count: 1, sizeMm: 4 }, { outerRadiusMm: ring.outerRadiusMm })
  check('스톤 1개: 보석 1 + 세팅 부품', one.gems.length === 1 && one.metals.length > 0, `보석 ${one.gems.length}, 금속부 ${one.metals.length}`)
  check('프롱 금속부 수밀', one.metals.every((m) => analyzeGeometry(m.geometry).watertight))

  const five = buildStones({ ...DEFAULT_DESIGN.stone, count: 5, sizeMm: 3 }, { outerRadiusMm: ring.outerRadiusMm })
  check('스톤 5개 배치', five.gems.length === 5, `간격 ${five.stepDeg.toFixed(1)}°`)
  check('스톤 5개 간섭 경고 없음', five.warnings.length === 0)

  const many = buildStones({ ...DEFAULT_DESIGN.stone, count: 9, sizeMm: 7 }, { outerRadiusMm: ring.outerRadiusMm })
  check('과밀 배치 시 경고 발생', many.warnings.length > 0, many.warnings[0]?.slice(0, 40))

  const settings: SettingType[] = ['prong4', 'prong6', 'bezel', 'halo', 'channel']
  const shapes: StoneShape[] = ['round', 'oval', 'pear', 'marquise', 'emerald', 'cabochon']
  for (const setting of settings) {
    const label = SETTINGS.find((s) => s.id === setting)!.label
    let allOk = true
    let gemTotal = 0
    let metalTotal = 0
    const bad: string[] = []
    for (const shape of shapes) {
      const layout = buildStones({ ...DEFAULT_DESIGN.stone, shape, setting, count: 1, sizeMm: 5 }, { outerRadiusMm: ring.outerRadiusMm })
      gemTotal += layout.gems.length
      metalTotal += layout.metals.length
      const metalOk = layout.metals.length > 0 && layout.metals.every((m) => analyzeGeometry(m.geometry).watertight)
      // 보석 검증은 "퇴화하지 않았는가"(수밀 + 0보다 확실히 큰 체적).
      // 헤일로 팁처럼 곡률이 큰 자리의 메레는 실제로도 작으므로 0.2mm³ 같은 크기 하한은 두지 않습니다.
      const gemOk = layout.gems.every((g) => {
        const st = analyzeGeometry(g.geometry)
        return st.watertight && st.volumeMm3 > 0.02
      })
      if (!metalOk || !gemOk) {
        allOk = false
        bad.push(shape)
      }
    }
    check(`${label}: 6가지 모양 모두 금속부 수밀`, allOk, `${metalTotal}개 금속부 · 보석 ${gemTotal}개${bad.length ? ` · 실패 ${bad.join(',')}` : ''}`)
  }

  const halo = buildStones({ ...DEFAULT_DESIGN.stone, setting: 'halo', count: 1, sizeMm: 5, shape: 'oval' }, { outerRadiusMm: ring.outerRadiusMm })
  check('헤일로: 센터 + 메레 링(8개 이상)', halo.gems.length >= 9, `보석 ${halo.gems.length}개`)
  const haloPear = buildStones({ ...DEFAULT_DESIGN.stone, setting: 'halo', count: 1, sizeMm: 5, shape: 'pear' }, { outerRadiusMm: ring.outerRadiusMm })
  check('헤일로: 페어 윤곽을 따라 배치', haloPear.gems.length >= 9, `보석 ${haloPear.gems.length}개`)

  const channel = buildStones({ ...DEFAULT_DESIGN.stone, setting: 'channel', count: 1, sizeMm: 5 }, { outerRadiusMm: ring.outerRadiusMm })
  check('채널: 센터 + 양쪽 메레 줄(6개)', channel.gems.length === 7, `보석 ${channel.gems.length}개`)
  check('채널: 두 개의 금속 벽 + 바닥(수밀)', channel.metals.length >= 2 && channel.metals.every((m) => analyzeGeometry(m.geometry).watertight), `${channel.metals.length}개 금속부`)

  const none = buildStones({ ...DEFAULT_DESIGN.stone, count: 0 }, { outerRadiusMm: ring.outerRadiusMm })
  check('스톤 0개 → 부품 없음', none.gems.length === 0 && none.metals.length === 0)

}

console.log('\n── 각인 위치 계산 (확대·축소 가시성의 근본 원인) ──')
{
  const b = band()
  const ring = buildRing(b)
  const prof = buildProfile(b).points
  const innerR = ring.innerRadiusMm
  const outerAtCenter = surfaceRadius(prof, 0, 'outer')
  const innerAtCenter = surfaceRadius(prof, 0, 'inner')
  check('바깥면 표면 반경(중앙) = 단면 두께', near(outerAtCenter, b.thicknessMm, 0.02), `${outerAtCenter.toFixed(3)}mm`)
  check('안쪽면 표면 반경(중앙) = 0 (원통면)', Math.abs(innerAtCenter) < 1e-6, `${innerAtCenter.toFixed(4)}mm`)
  const innerPatch = innerR + innerAtCenter - ENGRAVE_STANDOFF_MM
  check(
    '안쪽 각인 패치가 손가락 구멍 쪽에 놓인다(금속 속이 아님)',
    innerPatch < innerR && innerPatch > innerR - 0.5,
    `패치 반경 ${innerPatch.toFixed(3)}mm < 내경 ${innerR.toFixed(3)}mm`,
  )
  const outerPatch = innerR + outerAtCenter + ENGRAVE_STANDOFF_MM
  check('바깥 각인 패치가 금속 바깥에 놓인다', outerPatch > innerR + outerAtCenter, `${outerPatch.toFixed(3)}mm`)

  // 폭 전체에 걸쳐 안쪽/바깥쪽 표면 반경이 단면을 벗어나지 않는지
  let ok = true
  const width = b.widthMm
  for (let k = 0; k <= 32; k++) {
    const a = -width / 2 + (width * k) / 32
    const rIn = surfaceRadius(prof, a, 'inner')
    const rOut = surfaceRadius(prof, a, 'outer')
    // 컴포트 핏 필렛 때문에 안쪽 반경은 0~0.3mm 사이에서 변합니다(그게 정상).
    if (rIn < -0.001 || rIn > 0.4 || rOut < rIn - 0.001 || rOut > b.thicknessMm + 0.001) ok = false
  }
  check('폭 전 구간에서 0 ≤ 안쪽 ≤ 바깥 ≤ 두께', ok)

  // 평면/베벨/트위스트 단면도 같은 규칙
  for (const profile of ['flat', 'bevel', 'twist'] as ProfileId[]) {
    const p2 = buildProfile(band({ profile })).points
    const rIn = surfaceRadius(p2, 0, 'inner')
    check(`${profile}: 안쪽 표면 반경(중앙) ≈ 0`, Math.abs(rIn) < 0.02, `${rIn.toFixed(4)}mm`)
  }
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

console.log('\n── 새 옵션 STL (트위스트 · 새 모양 · 헤일로 · 채널) ──')
{
  const cases: { label: string; design: Design }[] = [
    { label: '트위스트 단면', design: { ...DEFAULT_DESIGN, band: { ...DEFAULT_DESIGN.band, profile: 'twist' } } },
    { label: '페어 + 헤일로', design: { ...DEFAULT_DESIGN, stone: { ...DEFAULT_DESIGN.stone, shape: 'pear', setting: 'halo' } } },
    { label: '마퀴즈 + 베젤', design: { ...DEFAULT_DESIGN, stone: { ...DEFAULT_DESIGN.stone, shape: 'marquise', setting: 'bezel' } } },
    { label: '에메랄드 + 채널', design: { ...DEFAULT_DESIGN, stone: { ...DEFAULT_DESIGN.stone, shape: 'emerald', setting: 'channel' } } },
    { label: '캐보션 + 프롱6', design: { ...DEFAULT_DESIGN, stone: { ...DEFAULT_DESIGN.stone, shape: 'cabochon', setting: 'prong6' } } },
    { label: '루비 오벌', design: { ...DEFAULT_DESIGN, stone: { ...DEFAULT_DESIGN.stone, shape: 'oval', gem: 'ruby', setting: 'halo' } } },
  ]
  for (const c of cases) {
    const ring = buildRing(c.design.band)
    const stones = buildStones(c.design.stone, { outerRadiusMm: ring.outerRadiusMm })
    const m = measure({ bandGeometry: ring.geometry, metalParts: stones.metals, gemCount: stones.gems.length })
    const parts = [{ geometry: ring.geometry, matrix: new THREE.Matrix4() }, ...stones.metals]
    const blob = buildBinarySTL(parts, { header: c.label })
    const tris = countTriangles(parts)
    check(
      `${c.label}: STL 수밀 · 정상 크기`,
      m.allWatertight && blob.size === 84 + tris * 50,
      `삼각형 ${tris} · 금속 ${m.metalVolumeCm3.toFixed(3)}cm³ · 보석 ${stones.gems.length}개`,
    )
  }
}

console.log('\n── 세팅 지오메트리 정합성 (v7: 채널·헤일로·프롱) ──')
{
  const ring = buildRing(band())
  const geoRing = { outerRadiusMm: ring.outerRadiusMm, profileRadial: ring.profileMaxRadial }
  const shapeOf = (id: StoneShape) => STONE_SHAPES.find((s) => s.id === id)!

  // 채널 — 메레가 레일 홈 "안쪽"에 앉고, 거들 가장자리가 레일 립에 물려야 합니다.
  for (const sizeMm of [3, 5, 7]) {
    const ch = buildStones({ ...DEFAULT_DESIGN.stone, setting: 'channel', count: 1, sizeMm }, geoRing)
    const c = ch.info.channel!
    check(
      `채널 ${sizeMm}mm: 레일이 메레 거들 가장자리를 문다`,
      c.railInnerZ < c.meleeMm * 0.5,
      `레일 안쪽 면 z ${c.railInnerZ.toFixed(3)}mm < 거들 반경 ${(c.meleeMm * 0.5).toFixed(3)}mm`,
    )
    check(
      `채널 ${sizeMm}mm: 메레 거들이 레일 윗면 아래(홈 안쪽)에 있다`,
      c.railTopY >= 0 && c.railTopY <= c.meleeMm * 0.1,
      `레일 윗면 y ${c.railTopY.toFixed(3)}mm (거들면 0 기준)`,
    )
    check(
      `채널 ${sizeMm}mm: 메레를 촘촘한 채널 피치로 물린다`,
      c.pitchMm <= c.meleeMm * 1.15,
      `피치 ${c.pitchMm.toFixed(3)}mm / 메레 1개 ${c.meleeMm.toFixed(2)}mm (${(c.pitchMm / c.meleeMm).toFixed(2)}d)`,
    )
    check(
      `채널 ${sizeMm}mm: 첫 메레가 센터 스톤 거들과 겹치지 않는다`,
      c.firstGapMm >= sizeMm * shapeOf('round').aspect * 0.5 + c.meleeMm * 0.5,
      `첫 메레 중심 ${c.firstGapMm.toFixed(2)}mm ≥ 센터 반지름+메레 반지름 ${(sizeMm * 0.5 + c.meleeMm * 0.5).toFixed(2)}mm`,
    )
    // 실제 메쉬: 레일 윗면(최대 반경)이 메레 거들면보다 바깥에 있어야 스톤이 홈 안쪽에 들어간 것입니다.
    const unitGeo = ch.metals[0].geometry
    unitGeo.computeBoundingBox()
    const railTopWorld = Math.max(
      ...ch.metals
        .filter((m) => m.geometry === unitGeo)
        .map((m) => new THREE.Vector3(0, unitGeo.boundingBox!.max.y, 0).applyMatrix4(m.matrix).length()),
    )
    const girdleRadius = new THREE.Vector3().setFromMatrixPosition(ch.gems[1].matrix).length()
    check(
      `채널 ${sizeMm}mm: 메레 거들이 레일 안쪽으로 들어갔다(월드 좌표)`,
      railTopWorld > girdleRadius,
      `레일 윗면 반경 ${railTopWorld.toFixed(3)}mm > 메레 거들 반경 ${girdleRadius.toFixed(3)}mm`,
    )
  }

  // 헤일로 — 공유 비드가 메레 중심보다 바깥(외곽)에 있어야 합니다.
  for (const shape of ['round', 'oval', 'pear'] as StoneShape[]) {
    const hl = buildStones({ ...DEFAULT_DESIGN.stone, setting: 'halo', count: 1, shape, sizeMm: 6 }, geoRing)
    const h = hl.info.halo!
    check(
      `헤일로(${shape}): 비드가 메레 중심보다 바깥 테두리에 있다`,
      h.beadOffsetMm > 0,
      `바깥 오프셋 +${h.beadOffsetMm.toFixed(3)}mm (메레 중심 고리 기준, 메레 ${h.meleeMm.toFixed(2)}mm)`,
    )
    check(
      `헤일로(${shape}): 비드가 아래 레일에 닿아 금속이 이어진다`,
      h.beadOffsetMm > 0 && Math.abs(-0.18 * h.meleeMm - h.beadRadiusMm - h.railTopY) <= h.meleeMm * 0.06,
      `비드 바닥 ${(-0.18 * h.meleeMm - h.beadRadiusMm).toFixed(3)}mm ≈ 레일 윗면 ${h.railTopY.toFixed(3)}mm`,
    )
    check(
      `헤일로(${shape}): 메레 거들이 레일 윗면 위로 떠 보인다`,
      -h.railTopY >= h.meleeMm * 0.3,
      `거들 0 대비 레일 윗면 ${h.railTopY.toFixed(3)}mm`,
    )
  }

  // 프롱 — 발톱이 크라운 안쪽으로 들어가고, 다석에서는 이웃을 향해 발을 세우지 않습니다.
  for (const setting of ['prong4', 'prong6'] as SettingType[]) {
    const one = buildStones({ ...DEFAULT_DESIGN.stone, setting, count: 1, sizeMm: 6 }, geoRing)
    const p1 = one.info.prongs!
    check(`프롱(${setting}) 단석: 발톱이 크라운 표면 안쪽을 문다`, p1.tipInsetMm > 0, `${p1.tipInsetMm.toFixed(3)}mm 들어감 · 각도 ${p1.anglesDeg.join('/')}°`)
    check(`프롱(${setting}) 단석: 발 개수 = ${setting === 'prong6' ? 6 : 4}`, p1.anglesDeg.length + p1.vProngs === (setting === 'prong6' ? 6 : 4))

    const five = buildStones({ ...DEFAULT_DESIGN.stone, setting, count: 5, sizeMm: 3 }, geoRing)
    const p5 = five.info.prongs!
    const worstCos = Math.max(...p5.anglesDeg.map((a) => Math.abs(Math.cos((a * Math.PI) / 180))))
    check(
      `프롱(${setting}) 다석: 이웃 스톤 쪽(접선 축)에 발을 세우지 않는다`,
      worstCos <= 0.52,
      `각도 ${p5.anglesDeg.join('/')}° · 접선 성분 최대 ${worstCos.toFixed(2)}`,
    )
    const arcMm = (five.stepDeg * Math.PI) / 180 * ring.outerRadiusMm
    check(
      `프롱(${setting}) 다석: 이웃 발과 접선 방향으로 떨어져 있다`,
      arcMm >= 2 * p5.extentMm + 0.2,
      `스톤 중심 간 ${arcMm.toFixed(2)}mm ≥ 발 반경 합 ${(2 * p5.extentMm).toFixed(2)}mm + 0.2mm`,
    )
  }

  // v8 — 모든 발이 스톤 중심을 향하는지(회전 적용), 볼 끝이 거들 밖에서 물고 있는지,
  // 페어·마퀴즈 팁 V 프롱이 팁을 덮는지, 바스켓이 프롱보다 안쪽인지.
  for (const setting of ['prong4', 'prong6'] as SettingType[]) {
    const nProngTotal = setting === 'prong6' ? 6 : 4
    let worstDot = 1
    let worstShape = ''
    let ballOk = true
    let rimOk = true
    for (const shape of ['round', 'oval', 'pear', 'marquise', 'emerald', 'cabochon'] as StoneShape[]) {
      const lay = buildStones({ ...DEFAULT_DESIGN.stone, shape, setting, count: 1, sizeMm: 6 }, geoRing)
      const info = lay.info.prongs!
      const nShoulder = nProngTotal - info.vProngs
      // V 프롱 다음에 오는 숄더 프롱들 — 스톤 로컬에서 +x 가 스톤 중심 반대(바깥)를 향해야 합니다.
      const gemInv = new THREE.Matrix4().copy(lay.gems[0].matrix).invert()
      const rot3 = new THREE.Matrix3().setFromMatrix4(gemInv)
      const ol = stoneOutlineMm(shape, 6)
      for (let i = info.vProngs; i < info.vProngs + nShoulder; i++) {
        const m = lay.metals[i].matrix
        const axis = new THREE.Vector3().setFromMatrixColumn(m, 0).applyMatrix3(rot3).normalize()
        const pos = new THREE.Vector3().setFromMatrixPosition(m).applyMatrix4(gemInv)
        // 발이 놓인 윤곽점의 법선과 회전축이 일치해야 합니다(모든 발이 스톤 중심 반대를 향함).
        const hit = outlineAtAngle(ol, Math.atan2(pos.z, pos.x))
        const dot = axis.x * hit.nx + axis.z * hit.nz
        if (dot < worstDot) {
          worstDot = dot
          worstShape = `${shape}/${setting}`
        }
      }
      // 볼 발톱의 바깥 끝이 거들 윤곽보다 나가 있어야 스톤을 물고 있습니다.
      const girdleX = Math.max(...stoneOutlineMm(shape, 6).map((p) => Math.abs(p[0])))
      for (let i = info.vProngs; i < info.vProngs + nShoulder; i++) {
        const m = lay.metals[i].matrix
        const g = lay.metals[i].geometry
        g.computeBoundingBox()
        const bb = g.boundingBox!
        // 로컬 x 최대(가장 바깥) 정점의 반지름
        const v = new THREE.Vector3(bb.max.x, 0, 0).applyMatrix4(m)
        const r = Math.hypot(v.x, v.y)
        const stoneR = new THREE.Vector3().setFromMatrixPosition(lay.gems[0].matrix).length()
        if (r < stoneR - 0.02) ballOk = false
      }
      // V 프롱이 있으면 팁 꼭짓점을 덮어야 합니다.
      if (info.vProngs > 0) {
        const g = lay.metals[0].geometry
        g.computeBoundingBox()
        const bb = g.boundingBox!
        const need = girdleX - 0.15
        const covered = (bb.max.x >= need || bb.min.x <= -need) && bb.max.y > 0.1
        if (!covered) ballOk = false
      }
      // 바스켓 테두리가 프롱 바깥면보다 안쪽이어야 프롱이 실루엣의 가장 바깥입니다.
      const basket = lay.metals[lay.metals.length - 1].geometry
      basket.computeBoundingBox()
      const bb = basket.boundingBox!
      if (bb.max.y > 0.02) rimOk = false
    }
    check(
      `프롱(${setting}): 모든 발이 스톤 중심을 향한다(회전 적용)`,
      worstDot > 0.9,
      `가장 나쁜 정렬 cos ${worstDot.toFixed(2)} (${worstShape})`,
    )
    check(`프롱(${setting}): 볼 발톱이 거들 밖에서 스톤을 문다`, ballOk)
    check(`프롱(${setting}): 바스켓이 프롱보다 안쪽·아래에 있다`, rimOk)
  }

  // 페어·마퀴즈 — V 프롱 수와 팁 방향
  {
    const pear = buildStones({ ...DEFAULT_DESIGN.stone, shape: 'pear', setting: 'prong4', count: 1, sizeMm: 6 }, geoRing)
    check('페어: 뾰족한 팁에 V 프롱 1개', pear.info.prongs!.vProngs === 1)
    const mq = buildStones({ ...DEFAULT_DESIGN.stone, shape: 'marquise', setting: 'prong6', count: 1, sizeMm: 6 }, geoRing)
    check(
      '마퀴즈: 양쪽 팁에 V 프롱 2개 + 숄더 4발',
      mq.info.prongs!.vProngs === 2 && mq.metals.length - 1 - 2 === 4,
      `V ${mq.info.prongs!.vProngs}개 · 금속부 ${mq.metals.length}개(바스켓 포함)`,
    )
    check('V 프롱 금속부 수밀', mq.metals.slice(0, 2).every((m) => analyzeGeometry(m.geometry).watertight))
  }
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
