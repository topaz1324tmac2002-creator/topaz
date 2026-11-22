/**
 * 세팅 확대 미리보기 — 스톤 하나(밴드 없이)의 세팅만 CPU 래스터라이저로 크게 렌더합니다.
 * 프롱·V 프롱·시트 모양을 눈으로 확인하며 수정할 때 씁니다.
 *
 * 실행: npm run dev:stone -- <outdir> [shape] [setting] [size] [prong] [count] [gem]
 *   예) esbuild 로 번들 후 node .verify/stone.mjs /workspace/tmp/sp pear prong4 6 0.9 1 diamond
 */
import * as THREE from 'three'
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { buildStones, type MeshPart } from '../src/core/stones'
import { GEMS, METALS } from '../src/core/catalog'
import { stoneOutlineMm } from '../src/core/shapes'
import type { SettingType, StoneShape } from '../src/core/types'
import { DEFAULT_DESIGN, type StoneParams } from '../src/core/types'

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (buf: Buffer): number => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type: string, data: Buffer): Buffer => {
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
  ihdr[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1)
  }
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 6 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

interface Tri {
  v: THREE.Vector3[]
  /** 정점 법선(있으면 부드러운 셰이딩), 없으면 면 법선 */
  vn: THREE.Vector3[] | null
  n: THREE.Vector3
  color: THREE.Color
  metal: boolean
}

function collect(parts: MeshPart[], color: THREE.Color, metal: boolean, out: Tri[]): void {
  for (const part of parts) {
    const pos = part.geometry.getAttribute('position') as THREE.BufferAttribute
    const nor = part.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
    const idx = part.geometry.getIndex()
    const count = idx ? idx.count : pos.count
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
    const nm = new THREE.Matrix3().getNormalMatrix(part.matrix)
    for (let t = 0; t < count; t += 3) {
      const vn: THREE.Vector3[] = []
      for (let k = 0; k < 3; k++) {
        const i = idx ? idx.getX(t + k) : t + k
        v[k].set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(part.matrix)
        if (nor) vn.push(new THREE.Vector3(nor.getX(i), nor.getY(i), nor.getZ(i)).applyMatrix3(nm).normalize())
      }
      const n = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0])).normalize()
      out.push({ v: [v[0].clone(), v[1].clone(), v[2].clone()], vn: nor ? vn : null, n, color, metal })
    }
  }
}

const W = 1100
const H = 900

function render(
  tris: Tri[],
  eye: THREE.Vector3,
  target: THREE.Vector3,
  fov: number,
  path: string,
  bg = 0x0d1015,
): void {
  const w = W
  const h = H
  const rgb = new Uint8Array(w * h * 3)
  const zbuf = new Float32Array(w * h).fill(Infinity)
  for (let y = 0; y < h; y++) {
    const t = y / h
    const c = new THREE.Color().setHex(bg).lerp(new THREE.Color().setHex(0x04060a), t * t)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      rgb[i] = Math.min(255, Math.round(c.r * 255))
      rgb[i + 1] = Math.min(255, Math.round(c.g * 255))
      rgb[i + 2] = Math.min(255, Math.round(c.b * 255))
    }
  }
  const cam = new THREE.PerspectiveCamera(fov, w / h, 0.1, 5000)
  cam.position.copy(eye)
  cam.lookAt(target)
  cam.updateMatrixWorld()
  cam.updateProjectionMatrix()
  const viewMat = new THREE.Matrix4().copy(cam.matrixWorldInverse)
  const projMat = new THREE.Matrix4().copy(cam.projectionMatrix)
  const lights = [
    { dir: new THREE.Vector3(0.45, 0.75, 0.5).normalize(), color: new THREE.Color(1, 0.98, 0.94), power: 1.1 },
    { dir: new THREE.Vector3(-0.6, 0.2, -0.5).normalize(), color: new THREE.Color(0.75, 0.85, 1), power: 0.45 },
    { dir: new THREE.Vector3(0.1, -0.4, 0.8).normalize(), color: new THREE.Color(1, 0.95, 0.9), power: 0.25 },
  ]
  for (const tri of tris) {
    const p = tri.v.map((v) => ({ e: v.clone().applyMatrix4(viewMat), s: new THREE.Vector3() }))
    if (p.some((q) => q.e.z > -0.05)) continue
    for (const q of p) {
      q.s.copy(q.e).applyMatrix4(projMat)
      q.s.x = (q.s.x * 0.5 + 0.5) * w
      q.s.y = (1 - (q.s.y * 0.5 + 0.5)) * h
    }
    const area = (p[1].s.x - p[0].s.x) * (p[2].s.y - p[0].s.y) - (p[2].s.x - p[0].s.x) * (p[1].s.y - p[0].s.y)
    if (Math.abs(area) < 1e-9) continue
    const shadeOf = (N: THREE.Vector3, v0: THREE.Vector3): THREE.Color => {
      const V = new THREE.Vector3().subVectors(eye, v0).normalize()
      if (N.dot(V) < 0) N.negate()
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
      return new THREE.Color(
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
      const upward = N.y
      const sky = THREE.MathUtils.clamp((upward + 0.25) / 1.25, 0, 1)
      const band = Math.exp(-Math.pow((upward - 0.28) * 4.2, 2))
      const env = 0.1 + sky * 0.75 + band * 0.35
      return new THREE.Color(
        base.r * (0.1 + env * 0.9) + fres * 0.45 + spec,
        base.g * (0.1 + env * 0.9) + fres * 0.47 + spec,
        base.b * (0.1 + env * 0.92) + fres * 0.55 + spec,
      )
    }
    }
    const minX = Math.max(0, Math.floor(Math.min(p[0].s.x, p[1].s.x, p[2].s.x)))
    const maxX = Math.min(w - 1, Math.ceil(Math.max(p[0].s.x, p[1].s.x, p[2].s.x)))
    const minY = Math.max(0, Math.floor(Math.min(p[0].s.y, p[1].s.y, p[2].s.y)))
    const maxY = Math.min(h - 1, Math.ceil(Math.max(p[0].s.y, p[1].s.y, p[2].s.y)))
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5
        const py = y + 0.5
        const w0 = ((p[1].s.x - px) * (p[2].s.y - py) - (p[2].s.x - px) * (p[1].s.y - py)) / area
        const w1 = ((p[2].s.x - px) * (p[0].s.y - py) - (p[0].s.x - px) * (p[2].s.y - py)) / area
        const w2 = 1 - w0 - w1
        if (w0 < 0 || w1 < 0 || w2 < 0) continue
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
        const Np = tri.vn
          ? new THREE.Vector3()
              .addScaledVector(tri.vn[0], w0)
              .addScaledVector(tri.vn[1], w1)
              .addScaledVector(tri.vn[2], w2)
              .normalize()
          : tri.n
        const shade = shadeOf(Np, tri.v[0])
        const map = (cc: number): number => Math.min(255, Math.round(Math.pow(1 - Math.exp(-cc), 1 / 2.2) * 255))
        rgb[k] = map(shade.r)
        rgb[k + 1] = map(shade.g)
        rgb[k + 2] = map(shade.b)
      }
    }
  }
  writePng(path, w, h, rgb)
}

/* ── 실행 ─────────────────────────────────────────────── */
const outDir = process.argv[2] ?? '/workspace/tmp/sp'
const shape = (process.argv[3] ?? 'round') as StoneShape
const setting = (process.argv[4] ?? 'prong4') as SettingType
const size = Number(process.argv[5] ?? 6)
const prong = Number(process.argv[6] ?? 0.9)
const count = Number(process.argv[7] ?? 1)
const gem = process.argv[8] ?? 'blackDiamond'
mkdirSync(outDir, { recursive: true })

const stone: StoneParams = { ...DEFAULT_DESIGN.stone, shape, setting, sizeMm: size, prongMm: prong, count, gem: gem as StoneParams['gem'] }
const layout = buildStones(stone, { outerRadiusMm: 8.3, profileRadial: 1.9 })
const tris: Tri[] = []
collect(layout.gems, new THREE.Color(GEMS[stone.gem].color), false, tris)
collect(layout.metals, new THREE.Color(METALS.gold18k.color), true, tris)

// 센터 스톤 위치(첫 번째 보석)를 중심으로 봅니다.
const center = new THREE.Vector3().setFromMatrixPosition(layout.gems[0].matrix)
const up = center.clone().normalize()
const side = new THREE.Vector3(0, 0, 1)
const around = new THREE.Vector3(up.y, -up.x, 0).normalize()
const at = (a: number, b: number, c: number): THREE.Vector3 =>
  center.clone().add(around.clone().multiplyScalar(size * a)).add(side.clone().multiplyScalar(size * b)).add(up.clone().multiplyScalar(size * c))
// 팁 확대 — 스톤 로컬 +x 끝(페어·마퀴즈)을 접선·측면에서 크게 봅니다.
const outline = stoneOutlineMm(shape, size)
const tipX = Math.max(...outline.map((p) => p[0]))
const world = (lx: number, ly: number, lz: number): THREE.Vector3 =>
  new THREE.Vector3().setFromMatrixPosition(layout.gems[0].matrix).add(around.clone().multiplyScalar(lx)).add(up.clone().multiplyScalar(ly)).add(side.clone().multiplyScalar(lz))
const tip = world(tipX, 0, 0)
const macro: { name: string; eye: THREE.Vector3; fov: number; target: THREE.Vector3 }[] = [
  { name: 'vside', eye: tip.clone().add(new THREE.Vector3(2.5, 2.6, 9)), fov: 22, target: tip.clone().add(new THREE.Vector3(-0.2, 0.1, 0)) },
  { name: 'vtop', eye: tip.clone().add(new THREE.Vector3(0.4, 9, 0.6)), fov: 22, target: tip.clone().add(new THREE.Vector3(-0.2, 0, 0)) },
]
const views: { name: string; eye: THREE.Vector3; fov: number }[] = [
  { name: 'front', eye: at(2.2, 0.15, 0.9), fov: 30 },
  { name: 'side', eye: at(0.05, 2.5, 0.75), fov: 30 },
  { name: 'top', eye: at(0.001, 0.001, 2.6), fov: 30 },
  { name: 'tilt', eye: at(0.35, 0.2, 2.2), fov: 30 },
  { name: 'oblique', eye: at(1.7, 1.35, 1.35), fov: 30 },
]
for (const v of views) {
  render(tris, v.eye, center, v.fov, `${outDir}/${v.name}.png`)
}
if (shape === 'pear' || shape === 'marquise') {
  for (const v of macro) render(tris, v.eye, v.target, v.fov, `${outDir}/${v.name}.png`)
}
console.log('rendered', shape, setting, 'gems', layout.gems.length, 'metals', layout.metals.length, 'tris', tris.length)
console.log('prong info', JSON.stringify(layout.info.prongs ?? {}))
