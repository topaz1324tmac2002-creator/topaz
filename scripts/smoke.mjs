/**
 * 브라우저 스모크 테스트 — 빌드된 앱을 실제 Chromium(WebGL/SwiftShader)에서 열어
 * 3D 렌더·5탭 전환·스톤 모양/보석 색 변경·우측 뷰 전환·STL 다운로드까지 한 번에 확인합니다.
 *
 * 실행: npm run build && node scripts/smoke.mjs (preview 서버가 4173에서 떠 있어야 함)
 */
import { chromium } from 'playwright'
import { statSync } from 'node:fs'

const URL = process.env.SMOKE_URL ?? 'http://127.0.0.1:4173/'
const errors = []
let failed = 0

const check = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
})
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
// 소프트웨어 렌더러(SwiftShader) 환경에서는 rAF 루프가 CPU를 독점해 CDP가 멈춥니다.
// 테스트에서는 프레임을 몇 장만 그리게 제한해 나머지 검증(기하·STL·UI)을 수행합니다.
await page.addInitScript(() => {
  const orig = window.requestAnimationFrame.bind(window)
  let n = 0
  window.requestAnimationFrame = (cb) => (n++ < 4 ? orig(cb) : 0)
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})

await page.goto(URL, { waitUntil: 'load' })
await page.waitForSelector('canvas', { timeout: 90000 })
await page.waitForTimeout(2500)

check('앱 타이틀', (await page.title()).includes('주얼리'), await page.title())
const canvasBox = await page.locator('canvas').first().boundingBox()
check('3D 캔버스 크기', !!canvasBox && canvasBox.width > 300 && canvasBox.height > 300, JSON.stringify(canvasBox))

const pixels = await page.evaluate(() => {
  const c = document.querySelector('canvas')
  if (!c) return null
  const out = document.createElement('canvas')
  out.width = 64
  out.height = 64
  const g = out.getContext('2d')
  g.drawImage(c, 0, 0, 64, 64)
  const d = g.getImageData(0, 0, 64, 64).data
  let min = 255
  let max = 0
  let sum = 0
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] + d[i + 1] + d[i + 2]
    sum += v
    if (v < min) min = v
    if (v > max) max = v
  }
  return { min, max, avg: sum / (64 * 64) }
})
check('캔버스에 실제 렌더링됨', !!pixels && pixels.max > 60 && pixels.max - pixels.min > 40, JSON.stringify(pixels))

// 무게/체적 패널이 계산되어 표시되는지 (체적 > 0)
const footText = await page.locator('.viewport-foot').innerText()
const volume = Number((footText.match(/([\d.]+)\s*cm³/) ?? [])[1] ?? 0)
check('체적 계산 > 0', volume > 0.05, footText.replace(/\n/g, ' '))

await page.screenshot({ path: 'smoke-desktop.png' })

// 탭은 정확히 5개 — 밴드 · 스톤 · 각인 · 재질 · STL (조형 없음)
const tabLabels = await page.locator('.panel-left .tabstrip .tab').allInnerTexts()
check(
  '5탭 구성(조형 제거)',
  tabLabels.length === 5 && !tabLabels.some((t) => t.includes('조형')),
  tabLabels.join(' · '),
)
for (const label of ['스톤', '각인', '재질', 'STL', '밴드']) {
  await page.getByRole('button', { name: label, exact: true }).first().click()
  await page.waitForTimeout(250)
}
check('탭 전환', (await page.locator('.panel-left .section').count()) > 0)

// 슬라이더로 호수 변경 → 체적 변화
const before = volume
await page.evaluate(() => {
  const input = document.querySelector('.panel-left input[type="range"]')
  if (!input) return
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, '20')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
})
await page.waitForTimeout(1200)
const afterText = await page.locator('.viewport-foot').innerText()
const after = Number((afterText.match(/([\d.]+)\s*cm³/) ?? [])[1] ?? 0)
check('파라미터 변경 → 체적 재계산', after > before, `${before} → ${after}`)

// 밴드 폭을 바꾸면 카메라가 우측 뷰로 부드럽게 이동합니다(화면이 실제로 바뀌는지로 확인)
const capture = () =>
  page.evaluate(() => {
    const c = document.querySelector('canvas')
    if (!c) return ''
    const out = document.createElement('canvas')
    out.width = 96
    out.height = 72
    out.getContext('2d').drawImage(c, 0, 0, 96, 72)
    return out.toDataURL('image/png')
  })
{
  await page.getByRole('button', { name: '밴드', exact: true }).first().click()
  await page.waitForTimeout(300)
  const beforeView = capture ? await capture() : ''
  const widthInput = page.locator('.panel-left input[type="range"]').nth(1)
  await widthInput.evaluate((input) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '6')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForTimeout(1500)
  const afterView = await capture()
  check('밴드 폭 조절 → 뷰가 우측 뷰로 전환', !!afterView && afterView !== beforeView, afterView === beforeView ? '화면 변화 없음' : '카메라 이동 확인')
  // 우측/앞 버튼
  await page.getByRole('button', { name: '우측', exact: true }).first().click()
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: '앞', exact: true }).first().click()
  await page.waitForTimeout(900)
  check('앞/우측 뷰 버튼 동작', errors.length === 0, errors.join(' | ').slice(0, 300))
}

// 스톤 모양 6종 · 보석 색 5종 선택이 오류 없이 동작
await page.getByRole('button', { name: '스톤', exact: true }).first().click()
await page.waitForTimeout(300)
for (const label of ['페어', '마퀴즈', '에메랄드컷', '캐보션', '라운드']) {
  await page.getByRole('button', { name: label, exact: true }).first().click()
  await page.waitForTimeout(250)
}
check('스톤 모양 6종 선택', errors.length === 0, errors.join(' | ').slice(0, 300))
for (const label of ['루비', '사파이어', '시트린', '토파즈', '다이아몬드']) {
  await page.getByRole('button', { name: label, exact: true }).first().click()
  await page.waitForTimeout(200)
}
check('보석 색 5종 선택', errors.length === 0, errors.join(' | ').slice(0, 300))
for (const label of ['헤일로', '채널', '베젤', '프롱 4']) {
  await page.getByRole('button', { name: label, exact: true }).first().click()
  await page.waitForTimeout(300)
}
check('세팅 5종 선택(프롱·베젤·헤일로·채널)', errors.length === 0, errors.join(' | ').slice(0, 300))

// 트위스트 단면
await page.getByRole('button', { name: '밴드', exact: true }).first().click()
await page.waitForTimeout(250)
await page.getByRole('button', { name: '트위스트', exact: true }).first().click()
await page.waitForTimeout(900)
check('트위스트 단면 선택', errors.length === 0, errors.join(' | ').slice(0, 300))
await page.getByRole('button', { name: '돔', exact: true }).first().click()
await page.waitForTimeout(600)

// 범위 정리 확인 — 9:16 턴테이블/영상·PNG 캡처 UI는 없어야 합니다.
check('턴테이블/영상 버튼 없음', (await page.getByRole('button', { name: /턴테이블|영상 저장|PNG/ }).count()) === 0)

// STL 다운로드
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.getByRole('button', { name: /STL 다운로드/ }).click(),
])
const path = await download.path()
const size = path ? statSync(path).size : 0
check('STL 다운로드', size > 1000 && download.suggestedFilename().endsWith('.stl'), `${download.suggestedFilename()} · ${size} bytes`)

// 모바일(iPad 세로) 레이아웃
const mobile = await ctx.newPage()
mobile.on('pageerror', (e) => errors.push(`mobile pageerror: ${e.message}`))
await mobile.setViewportSize({ width: 834, height: 1112 })
await mobile.goto(URL, { waitUntil: 'load' })
await mobile.waitForSelector('canvas', { timeout: 20000 })
await mobile.waitForTimeout(2000)
check('아이패드 세로 레이아웃(하단 시트)', (await mobile.locator('.sheet').count()) === 1)
check('하단 시트 5탭', (await mobile.locator('.sheet-tabs .tab').count()) === 5)
await mobile.screenshot({ path: 'smoke-ipad.png' })

check('런타임 오류 없음', errors.length === 0, errors.join(' | ').slice(0, 600))

await browser.close()
console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)
