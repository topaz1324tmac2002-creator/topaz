/**
 * 형상 미리보기 — 코어 지오메트리(밴드 + 스톤 + 세팅)를 CPU 소프트웨어 래스터라이저로 렌더해 PNG 로 저장합니다.
 * (브라우저/GPU 없이 패싯 모양·비율·세팅 형태를 눈으로 확인하기 위한 개발 도구)
 *
 * 실행: npm run preview:geo -- <출력폴더>   (기본 /workspace/tmp/preview)
 *   GPU 없이 패싯 모양·비율·세팅 형태를 눈으로 확인하는 개발용 도구입니다.
 */
import * as THREE from 'three'
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { buildRing } from '../src/core/ring'
import { buildStones, type MeshPart } from '../src/core/stones'
import { GEMS, METALS } from '../src/core/catalog'
import type { Design, StoneParams } from '../src/core/types'
import { DEFAULT_DESIGN } from '../src/core/types'

/* ── PNG 인코딩 ─────────────────────────────────────────── */

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function writePng(path: string, w: number, h: number, rgb: Uint8Array): void {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2 // RGB
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1)
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
  writeFileSync(path, png)
}

/* ── 래스터라이저 ───────────────────────────────────────── */

interface Tri {
  v: THREE.Vector3[]
  n: THREE.Vector3
  color: THREE.Color
  metal: boolean
}

const OUT_W = 900
const OUT_H = 760

interface View {
  eye: THREE.Vector3
  target: THREE.Vector3
  fov: number
}

function collect(parts: MeshPart[], color: THREE.Color, metal: boolean, out: Tri[]): void {
  for (const part of parts) {
    const pos = part.geometry.getAttribute('position') as THREE.BufferAttribute
    const idx = part.geometry.getIndex()
    const count = idx ? idx.count : pos.count
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
    for (let t = 0; t < count; t += 3) {
      for (let k = 0; k < 3; k++) {
        const i = idx ? idx.getX(t + k) : t + k
        v[k].set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(part.matrix)
      }
      const n = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0])).normalize()
      out.push({ v: [v[0].clone(), v[1].clone(), v[2].clone()], n, color, metal })
    }
  }
}

function render(tris: Tri[], view: View, bgTop: number, bgBottom: number, path: string, opts: { exposure?: number } = {}): void {
  const w = OUT_W
  const h = OUT_H
  const rgb = new Uint8Array(w * h * 3)
  const zbuf = new Float32Array(w * h).fill(Infinity)
  for (let y = 0; y < h; y++) {
    const t = y / h
    const c = new THREE.Color().setHex(bgTop).lerp(new THREE.Color().setHex(bgBottom), t * t)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      rgb[i] = Math.min(255, Math.round(c.r * 255))
      rgb[i + 1] = Math.min(255, Math.round(c.g * 255))
      rgb[i + 2] = Math.min(255, Math.round(c.b * 255))
    }
  }

  const cam = new THREE.PerspectiveCamera(view.fov, w / h, 0.1, 5000)
  cam.position.copy(view.eye)
  cam.lookAt(view.target)
  cam.updateMatrixWorld()
  cam.updateProjectionMatrix()
  const viewMat = new THREE.Matrix4().copy(cam.matrixWorldInverse)
  const projMat = new THREE.Matrix4().copy(cam.projectionMatrix)

  const lights = [
    { dir: new THREE.Vector3(0.45, 0.75, 0.5).normalize(), color: new THREE.Color(1, 0.98, 0.94), power: 1.1 },
    { dir: new THREE.Vector3(-0.6, 0.2, -0.5).normalize(), color: new THREE.Color(0.75, 0.85, 1), power: 0.45 },
    { dir: new THREE.Vector3(0.1, -0.4, 0.8).normalize(), color: new THREE.Color(1, 0.95, 0.9), power: 0.25 },
  ]
  const exposure = opts.exposure ?? 1
  const eye = view.eye

  for (const tri of tris) {
    const p = tri.v.map((v) => {
      const e = v.clone().applyMatrix4(viewMat)
      return { e, s: new THREE.Vector3() }
    })
    // 카메라 뒤 제거
    if (p.some((q) => q.e.z > -0.05)) continue
    for (const q of p) {
      q.s.copy(q.e).applyMatrix4(projMat)
      q.s.x = (q.s.x * 0.5 + 0.5) * w
      q.s.y = (1 - (q.s.y * 0.5 + 0.5)) * h
    }
    const area = (p[1].s.x - p[0].s.x) * (p[2].s.y - p[0].s.y) - (p[2].s.x - p[0].s.x) * (p[1].s.y - p[0].s.y)
    if (Math.abs(area) < 1e-9) continue

    // 셰이딩 (플랫 패싯)
    const N = tri.n
    const V = new THREE.Vector3().subVectors(eye, tri.v[0]).normalize()
    if (N.dot(V) < 0) N.negate()
    let shade: THREE.Color
    if (tri.metal) {
      const base = tri.color
      let diff = 0
      let spec = 0
      for (const L of lights) {
        diff += Math.max(0, N.dot(L.dir)) * L.power
        const Hh = new THREE.Vector3().addVectors(L.dir, V).normalize()
        spec += Math.pow(Math.max(0, N.dot(Hh)), 90) * L.power * 3.2
      }
      const env = 0.5 + 0.5 * N.y
      shade = new THREE.Color(
        base.r * (0.12 + diff * 0.75) + spec + base.r * env * 0.25,
        base.g * (0.12 + diff * 0.75) + spec + base.g * env * 0.25,
        base.b * (0.12 + diff * 0.75) + spec + base.b * env * 0.25,
      )
    } else {
      const base = tri.color
      const fres = Math.pow(1 - Math.max(0, N.dot(V)), 2.2)
      let spec = 0
      for (const L of lights) {
        const Hh = new THREE.Vector3().addVectors(L.dir, V).normalize()
        spec += Math.pow(Math.max(0, N.dot(Hh)), 420) * L.power * 9
        spec += Math.pow(Math.max(0, N.dot(Hh)), 40) * L.power * 0.5
      }
      // 하늘(위쪽) 과 바닥(아래쪽) 반사를 단순화한 환경 항 — 패싯마다 밝기가 갈립니다.
      const upward = N.y
      const sky = THREE.MathUtils.clamp((upward + 0.25) / 1.25, 0, 1)
      const band = Math.exp(-Math.pow((upward - 0.28) * 4.2, 2)) // 거들 근처 밝은 띠
      const env = 0.1 + sky * 0.75 + band * 0.35
      const r = base.r * (0.1 + env * 0.9) + fres * 0.45 + spec
      const g = base.g * (0.1 + env * 0.9) + fres * 0.47 + spec
      const b = base.b * (0.1 + env * 0.92) + fres * 0.55 + spec
      shade = new THREE.Color(r, g, b)
    }

    const minX = Math.max(0, Math.floor(Math.min(p[0].s.x, p[1].s.x, p[2].s.x)))
    const maxX = Math.min(w - 1, Math.ceil(Math.max(p[0].s.x, p[1].s.x, p[2].s.x)))
    const minY = Math.max(0, Math.floor(Math.min(p[0].s.y, p[1].s.y, p[2].s.y)))
    const maxY = Math.min(h - 1, Math.ceil(Math.max(p[0].s.y, p[1].s.y, p[2].s.y)))
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5
        const py = y + 0.5
        let w0 = ((p[1].s.x - px) * (p[2].s.y - py) - (p[2].s.x - px) * (p[1].s.y - py)) / area
        let w1 = ((p[2].s.x - px) * (p[0].s.y - py) - (p[0].s.x - px) * (p[2].s.y - py)) / area
        let w2 = 1 - w0 - w1
        if (w0 < 0 || w1 < 0 || w2 < 0) continue
        // 원근 보정
        const inv = [
          1 / Math.max(1e-6, -p[0].e.z),
          1 / Math.max(1e-6, -p[1].e.z),
          1 / Math.max(1e-6, -p[2].e.z),
        ]
        const denom = w0 * inv[0] + w1 * inv[1] + w2 * inv[2]
        const depth = 1 / denom
        const idx = y * w + x
        if (depth >= zbuf[idx]) continue
        zbuf[idx] = depth
        const k = idx * 3
        const map = (cc: number): number => {
          const t = 1 - Math.exp((-cc * exposure) / 1.0)
          return Math.min(255, Math.round(Math.pow(t, 1 / 2.2) * 255))
        }
        rgb[k] = map(shade.r)
        rgb[k + 1] = map(shade.g)
        rgb[k + 2] = map(shade.b)
      }
    }
  }
  writePng(path, w, h, rgb)
}

/* ── 씬 구성 ───────────────────────────────────────────── */

const outDir = process.argv[2] ?? '/workspace/tmp/preview'
mkdirSync(outDir, { recursive: true })

function scene(design: Design, stone: Partial<StoneParams>) {
  const d: Design = { ...design, stone: { ...design.stone, ...stone } }
  const band = buildRing(d.band)
  const stones = buildStones(d.stone, { outerRadiusMm: band.outerRadiusMm, profileRadial: band.profileMaxRadial })
  const tris: Tri[] = []
  collect([{ geometry: band.geometry, matrix: new THREE.Matrix4() }], new THREE.Color(METALS[d.metal].color), true, tris)
  collect(stones.gems, new THREE.Color(GEMS[d.stone.gem].color), false, tris)
  collect(stones.metals, new THREE.Color(METALS[d.metal].color), true, tris)
  return tris
}

const design: Design = { ...DEFAULT_DESIGN, metal: 'gold18k' }
const front: View = { eye: new THREE.Vector3(0, 6, 78), target: new THREE.Vector3(0, 0, 0), fov: 30 }
const topUp: View = { eye: new THREE.Vector3(9, 42, 40), target: new THREE.Vector3(0, 4, 0), fov: 26 }
const closeFront: View = { eye: new THREE.Vector3(1.5, 15.5, 26), target: new THREE.Vector3(0, 9.5, 0), fov: 26 }
const closeTop: View = { eye: new THREE.Vector3(4, 30, 20), target: new THREE.Vector3(0, 10, 0), fov: 24 }

const cases: { name: string; stone: Partial<StoneParams> }[] = [
  { name: 'round-prong4', stone: { shape: 'round', setting: 'prong4', sizeMm: 6 } },
  { name: 'oval-prong6', stone: { shape: 'oval', setting: 'prong6', sizeMm: 6 } },
  { name: 'pear-prong4', stone: { shape: 'pear', setting: 'prong4', sizeMm: 6 } },
  { name: 'marquise-prong4', stone: { shape: 'marquise', setting: 'prong4', sizeMm: 5 } },
  { name: 'pear-halo', stone: { shape: 'pear', setting: 'halo', sizeMm: 6 } },
  { name: 'marquise-halo', stone: { shape: 'marquise', setting: 'halo', sizeMm: 5 } },
  { name: 'round-halo', stone: { shape: 'round', setting: 'halo', sizeMm: 6 } },
  { name: 'pear-bezel', stone: { shape: 'pear', setting: 'bezel', sizeMm: 6 } },
  { name: 'emerald-prong4', stone: { shape: 'emerald', setting: 'prong4', sizeMm: 6 } },
  { name: 'cabochon-halo', stone: { shape: 'cabochon', setting: 'halo', sizeMm: 6, gem: 'topaz' } },
]

for (const c of cases) {
  const tris = scene(design, c.stone)
  render(tris, front, 0x101318, 0x05070a, `${outDir}/${c.name}.png`)
  render(tris, closeFront, 0x101318, 0x05070a, `${outDir}/${c.name}-close.png`)
  render(tris, topUp, 0x101318, 0x05070a, `${outDir}/${c.name}-top.png`)
  render(tris, closeTop, 0x101318, 0x05070a, `${outDir}/${c.name}-closetop.png`)
  console.log('rendered', c.name, 'triangles', tris.length)
}
