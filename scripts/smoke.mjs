/**
 * 브라우저 스모크 테스트 — 빌드된 앱을 실제 Chromium(WebGL/SwiftShader)에서 열어
 * 3D 렌더·탭 전환·자유 조형·STL 다운로드까지 한 번에 확인합니다.
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

// 탭 전환 (밴드 → 스톤 → 조형 → 각인)
for (const label of ['스톤', '조형', '각인', '밴드']) {
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

// 조형 탭 → 조형 모드 진입/종료
await page.getByRole('button', { name: '조형', exact: true }).first().click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: /조형 시작/ }).click()
await page.waitForTimeout(300)
check('조형 모드 표시', (await page.locator('.sculpt-pill').count()) === 1)
const box = await page.locator('canvas').first().boundingBox()
if (box) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(box.x + box.width / 2 + i * 4, box.y + box.height / 2 + i * 3)
    await page.waitForTimeout(40)
  }
  await page.mouse.up()
}
await page.waitForTimeout(400)
check('조형 후에도 오류 없음', errors.length === 0, errors.join(' | ').slice(0, 400))
await page.getByRole('button', { name: '조형 종료' }).first().click()
await page.waitForTimeout(300)
check('조형 종료 후 브러시 꺼짐', (await page.locator('.sculpt-pill').count()) === 0)

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
check('하단 시트 6탭', (await mobile.locator('.sheet-tabs .tab').count()) === 6)
await mobile.screenshot({ path: 'smoke-ipad.png' })

check('런타임 오류 없음', errors.length === 0, errors.join(' | ').slice(0, 600))

await browser.close()
console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)
