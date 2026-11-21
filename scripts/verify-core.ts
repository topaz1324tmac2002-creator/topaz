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
import { stoneOutlineMm, outlinePerimeter, sampleOutline } from '../src/core/shapes'
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
