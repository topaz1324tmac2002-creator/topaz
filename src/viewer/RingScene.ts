/**
 * 뷰포트 — three.js 씬(카메라·조명·환경맵·오빗 컨트롤·조형 브러시·턴테이블).
 * React에는 이 클래스의 인스턴스만 넘기고, 상태 변경은 메서드로 반영합니다.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { buildProfile, buildRing, type RingBuild } from '../core/ring'
import { buildStones, type MeshPart } from '../core/stones'
import { buildEngraving, makeEngravingMaterial } from '../core/engraving'
import { applyBrush, buildSculptMesh, resetSculpt, type SculptMesh } from '../core/sculpt'
import { METALS } from '../core/catalog'
import { buildBinarySTL, countTriangles, stlFileName, type StlPart } from '../core/stl'
import { measure, type MeasureResult } from '../core/measure'
import type { Design, SculptMode } from '../core/types'

export interface SceneMetrics {
  measure: MeasureResult
  sculpted: boolean
  triangles: number
  warnings: string[]
}

export interface SceneCallbacks {
  onMetrics?: (m: SceneMetrics) => void
  onError?: (message: string) => void
  /** 첫 20프레임이 느리면 고비용 효과를 자동으로 끕니다(적응형 품질) */
  onAutoQuality?: (avgFrameMs: number) => void
}

export class RingScene {
  private container: HTMLElement
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private ringGroup: THREE.Group
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private resizeObserver: ResizeObserver
  private callbacks: SceneCallbacks
  private pmrem: THREE.PMREMGenerator
  private envMap: THREE.Texture

  private design: Design
  private band: RingBuild | null = null
  private bandMesh: THREE.Mesh | null = null
  private bandMaterial: THREE.MeshPhysicalMaterial
  private gemMaterial: THREE.MeshPhysicalMaterial
  private gemMeshes: THREE.Mesh[] = []
  private metalMeshes: THREE.Mesh[] = []
  private engravingMesh: THREE.Mesh | null = null
  private metalParts: MeshPart[] = []
  private gemParts: MeshPart[] = []
  private stoneWarnings: string[] = []

  private sculpt: SculptMesh | null = null
  private sculptMode: SculptMode = 'off'
  private brushRadiusMm = 2
  private brushStrength = 0.45
  private sculptUndo: Float32Array[] = []

  private highQuality = true
  private perfSamples: number[] = []
  private perfChecked = false
  private turntable = false
  private ttAngle = 0
  /** 화면에 다시 그려야 하는 상태인지 (렌더 온디맨드) */
  private needsRender = true
  private dragging = false
  private lastMetrics: MeasureResult | null = null
  private disposed = false
  private rafId = 0
  private clock = new THREE.Clock()
  private recording = false

  constructor(container: HTMLElement, design: Design, callbacks: SceneCallbacks = {}) {
    this.container = container
    this.design = design
    this.callbacks = callbacks

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(container.clientWidth || 800, container.clientHeight || 600, false)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.renderer.domElement.style.touchAction = 'none'
    container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()

    const aspect = (container.clientWidth || 800) / (container.clientHeight || 600)
    this.camera = new THREE.PerspectiveCamera(32, aspect, 1, 5000)
    this.camera.position.set(0, 9, 62)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.09
    this.controls.enablePan = false
    this.controls.rotateSpeed = 0.75
    this.controls.zoomSpeed = 0.8
    this.controls.minPolarAngle = 0.12
    this.controls.maxPolarAngle = Math.PI - 0.12
    this.controls.target.set(0, 0, 0)
    this.controls.addEventListener('change', this.markDirty)

    // 환경맵(금속 반사를 만드는 핵심) — RoomEnvironment 를 PMREM 으로 구워 사용
    this.pmrem = new THREE.PMREMGenerator(this.renderer)
    this.pmrem.compileEquirectangularShader()
    const room = new RoomEnvironment()
    this.envMap = this.pmrem.fromScene(room, 0.04).texture
    this.scene.environment = this.envMap

    const key = new THREE.DirectionalLight(0xffffff, 2.4)
    key.position.set(24, 34, 40)
    this.scene.add(key)
    const rim = new THREE.DirectionalLight(0xbfd4ff, 1.1)
    rim.position.set(-30, -12, -26)
    this.scene.add(rim)
    const fill = new THREE.HemisphereLight(0xffffff, 0x14161a, 0.55)
    this.scene.add(fill)

    this.ringGroup = new THREE.Group()
    this.scene.add(this.ringGroup)

    this.bandMaterial = new THREE.MeshPhysicalMaterial({
      color: METALS[design.metal].color,
      metalness: 1,
      roughness: METALS[design.metal].roughness,
      envMapIntensity: 1.15,
      clearcoat: 0.35,
      clearcoatRoughness: 0.18,
    })
    this.gemMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xf7fbff,
      metalness: 0,
      roughness: 0.04,
      transmission: 0,
      thickness: 2,
      ior: 2.417,
      specularIntensity: 1,
      envMapIntensity: 2.4,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      flatShading: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    })

    this.applyEnvironment(design.environment)
    this.setHighQuality(this.highQuality)
    this.rebuild()

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown)
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove)
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp)
    this.renderer.domElement.addEventListener('pointercancel', this.onPointerUp)

    this.needsRender = true
    this.animate()
  }

  /* ── 공개 API ─────────────────────────────────────────────── */

  updateDesign(design: Design): void {
    const geometryChanged =
      design.band.sizeKR !== this.design.band.sizeKR ||
      design.band.widthMm !== this.design.band.widthMm ||
      design.band.thicknessMm !== this.design.band.thicknessMm ||
      design.band.profile !== this.design.band.profile ||
      design.band.comfort !== this.design.band.comfort ||
      JSON.stringify(design.stone) !== JSON.stringify(this.design.stone) ||
      design.engraving.enabled !== this.design.engraving.enabled ||
      design.engraving.text !== this.design.engraving.text ||
      design.engraving.position !== this.design.engraving.position ||
      design.engraving.heightMm !== this.design.engraving.heightMm

    const metalChanged = design.metal !== this.design.metal
    const envChanged = design.environment !== this.design.environment
    this.design = design

    if (geometryChanged) this.rebuild()
    if (metalChanged) this.applyMetal(design.metal)
    if (envChanged) this.applyEnvironment(design.environment)
  }

  /** 보석 투과광(transmission)은 GPU 비용이 큽니다. 저사양·소프트웨어 렌더러에서는 끕니다. */
  setHighQuality(on: boolean): void {
    this.highQuality = on
    this.gemMaterial.transmission = on ? 0.9 : 0
    this.gemMaterial.transparent = !on
    this.gemMaterial.opacity = on ? 1 : 0.82
    this.gemMaterial.depthWrite = on
    this.gemMaterial.needsUpdate = true
    this.needsRender = true
  }

  setSculptMode(mode: SculptMode): void {
    if (this.sculptMode === mode) return
    this.sculptMode = mode
    if (mode !== 'off') {
      if (!this.sculpt && this.bandMesh) {
        this.sculpt = buildSculptMesh(this.bandMesh.geometry)
      }
      this.controls.enabled = false
    } else {
      this.controls.enabled = true
      if (this.sculpt) {
        this.pushSculptUndo()
        this.emitMetrics()
      }
    }
  }

  setBrush(radiusMm: number, strength: number): void {
    this.brushRadiusMm = radiusMm
    this.brushStrength = strength
  }

  undoSculpt(): boolean {
    const prev = this.sculptUndo.pop()
    if (!prev || !this.sculpt) return false
    const attr = this.sculpt.geometry.getAttribute('position') as THREE.BufferAttribute
    ;(attr.array as Float32Array).set(prev)
    attr.needsUpdate = true
    this.sculpt.geometry.computeVertexNormals()
    this.sculpt.geometry.getAttribute('normal')!.needsUpdate = true
    this.sculpt.geometry.computeBoundingSphere()
    this.needsRender = true
    this.emitMetrics()
    return true
  }

  resetSculpted(): void {
    if (!this.sculpt) return
    this.pushSculptUndo()
    resetSculpt(this.sculpt)
    this.needsRender = true
    this.emitMetrics()
  }

  isSculpted(): boolean {
    return !!this.sculpt && this.sculpt.strokes > 0
  }

  setTurntable(on: boolean): void {
    this.turntable = on
    this.controls.enabled = !on && this.sculptMode === 'off'
    this.ringGroup.rotation.set(0, 0, 0)
    this.ttAngle = 0
    this.fitCamera()
  }

  exportSTL(includeGems: boolean): { blob: Blob; name: string; triangles: number } {
    const bandGeo = this.bandMesh?.geometry
    if (!bandGeo) throw new Error('메쉬가 아직 준비되지 않았습니다.')
    const parts: StlPart[] = [{ geometry: bandGeo, matrix: new THREE.Matrix4() }]
    for (const p of this.metalParts) parts.push({ geometry: p.geometry, matrix: p.matrix })
    if (includeGems) for (const p of this.gemParts) parts.push({ geometry: p.geometry, matrix: p.matrix })

    const name = stlFileName({
      sizeKR: this.design.band.sizeKR,
      profile: this.design.band.profile,
      widthMm: this.design.band.widthMm,
      thicknessMm: this.design.band.thicknessMm,
    })
    const blob = buildBinarySTL(parts, { header: `jewelry-studio ${name}` })
    return { blob, name, triangles: countTriangles(parts) }
  }

  /** 현재 뷰를 PNG로 캡처(턴테이블 모드면 9:16 프레임만 잘라 1080×1920) */
  capturePNG(): string {
    this.renderOnce()
    const src = this.renderer.domElement
    if (!this.turntable) return src.toDataURL('image/png')
    const rect = this.turntableRect() // CSS px
    const dpr = this.renderer.getPixelRatio()
    const out = document.createElement('canvas')
    out.width = 1080
    out.height = 1920
    const ctx = out.getContext('2d')
    if (!ctx) return src.toDataURL('image/png')
    ctx.drawImage(
      src,
      rect.x * dpr,
      rect.y * dpr,
      rect.w * dpr,
      rect.h * dpr,
      0,
      0,
      1080,
      1920,
    )
    return out.toDataURL('image/png')
  }

  /** 9:16 프레임을 초 단위로 녹화해 Blob 반환 (MediaRecorder, WebM/MP4) */
  async recordTurntable(seconds = 6): Promise<{ blob: Blob; ext: string }> {
    if (this.recording) throw new Error('이미 녹화 중입니다.')
    if (!this.turntable) throw new Error('턴테이블 모드에서만 녹화할 수 있습니다.')
    if (typeof MediaRecorder === 'undefined') throw new Error('이 브라우저는 영상 녹화(MediaRecorder)를 지원하지 않습니다.')

    const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(
      (m) => MediaRecorder.isTypeSupported(m),
    )
    if (!mime) throw new Error('지원되는 영상 코덱이 없습니다.')

    const rect = this.turntableRect()
    const dpr = this.renderer.getPixelRatio()
    const canvas = document.createElement('canvas')
    canvas.width = 720
    canvas.height = 1280
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('캔버스를 만들 수 없습니다.')
    const src = this.renderer.domElement

    const stream = canvas.captureStream(30)
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 })
    const chunks: BlobPart[] = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    const done = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mime }))
      recorder.onerror = () => reject(new Error('녹화 중 오류가 발생했습니다.'))
    })

    this.recording = true
    this.ttAngle = 0
    recorder.start()
    const start = performance.now()
    const tick = (): void => {
      ctx.drawImage(src, rect.x * dpr, rect.y * dpr, rect.w * dpr, rect.h * dpr, 0, 0, canvas.width, canvas.height)
      if (performance.now() - start < seconds * 1000) {
        requestAnimationFrame(tick)
      } else {
        recorder.stop()
        this.recording = false
      }
    }
    requestAnimationFrame(tick)

    const blob = await done
    this.recording = false
    return { blob, ext: mime.includes('mp4') ? 'mp4' : 'webm' }
  }

  getMetrics(): MeasureResult | null {
    return this.lastMetrics
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.rafId)
    this.resizeObserver.disconnect()
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown)
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove)
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp)
    this.renderer.domElement.removeEventListener('pointercancel', this.onPointerUp)
    this.controls.dispose()
    this.clearModel()
    this.pmrem.dispose()
    this.bandMaterial.dispose()
    this.gemMaterial.dispose()
    this.renderer.dispose()
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
  }

  /* ── 내부 구현 ────────────────────────────────────────────── */

  private currentAspect(): number {
    const size = this.renderer.getSize(new THREE.Vector2())
    return size.x / Math.max(1, size.y)
  }

  private rebuild(): void {
    this.clearModel()
    this.sculpt = null
    this.sculptUndo = []

    const band = buildRing(this.design.band)
    this.band = band

    const bandGeo = band.geometry
    const bandMesh = new THREE.Mesh(bandGeo, this.bandMaterial)
    bandMesh.name = 'band'
    this.bandMesh = bandMesh
    this.ringGroup.add(bandMesh)

    // 스톤 & 세팅
    const stones = buildStones(this.design.stone, { outerRadiusMm: band.outerRadiusMm })
    this.gemParts = stones.gems
    this.metalParts = stones.metals
    this.stoneWarnings = stones.warnings

    const gemGeo = stones.gems[0]?.geometry
    if (gemGeo) this.gemMaterial.thickness = Math.max(1, this.design.stone.sizeMm * 0.7)

    for (const part of stones.gems) {
      const mesh = new THREE.Mesh(part.geometry, this.gemMaterial)
      mesh.applyMatrix4(part.matrix)
      mesh.renderOrder = 2
      this.gemMeshes.push(mesh)
      this.ringGroup.add(mesh)
    }
    for (const part of stones.metals) {
      const mesh = new THREE.Mesh(part.geometry, this.bandMaterial)
      mesh.applyMatrix4(part.matrix)
      this.metalMeshes.push(mesh)
      this.ringGroup.add(mesh)
    }

    // 각인
    if (this.design.engraving.enabled) {
      const profile = buildProfile(this.design.band).points
      const engrave = buildEngraving(this.design.engraving, {
        profile,
        innerRadiusMm: band.innerRadiusMm,
        widthMm: this.design.band.widthMm,
        metalColor: METALS[this.design.metal].color,
      })
      if (engrave) {
        const mat = makeEngravingMaterial(engrave, METALS[this.design.metal].color)
        const mesh = new THREE.Mesh(engrave.geometry, mat)
        mesh.renderOrder = 1
        this.engravingMesh = mesh
        this.ringGroup.add(mesh)
      }
    }

    this.fitCamera()
    this.emitMetrics()
  }

  private clearModel(): void {
    const disposeSet = new Set<THREE.BufferGeometry>()
    for (const m of [this.bandMesh, ...this.gemMeshes, ...this.metalMeshes, this.engravingMesh]) {
      if (!m) continue
      disposeSet.add(m.geometry)
      this.ringGroup.remove(m)
    }
    for (const g of disposeSet) g.dispose()
    if (this.engravingMesh) {
      const mat = this.engravingMesh.material as THREE.MeshStandardMaterial
      mat.alphaMap?.dispose()
      mat.normalMap?.dispose()
      mat.dispose()
    }
    this.bandMesh = null
    this.gemMeshes = []
    this.metalMeshes = []
    this.engravingMesh = null
    this.metalParts = []
    this.gemParts = []
    this.stoneWarnings = []
  }

  private applyMetal(metalId: Design['metal']): void {
    const metal = METALS[metalId]
    this.bandMaterial.color.setHex(metal.color)
    this.bandMaterial.roughness = metal.roughness
    this.bandMaterial.needsUpdate = true
    this.needsRender = true
    if (this.engravingMesh) {
      const mat = this.engravingMesh.material as THREE.MeshStandardMaterial
      mat.color.setHex(metal.color).multiplyScalar(0.55)
      mat.needsUpdate = true
    }
  }

  private applyEnvironment(id: Design['environment']): void {
    const preset = {
      studio: { intensity: 1.15, exposure: 1.05 },
      softbox: { intensity: 1.55, exposure: 1.15 },
      dark: { intensity: 0.72, exposure: 0.95 },
    }[id]
    this.bandMaterial.envMapIntensity = preset.intensity
    this.gemMaterial.envMapIntensity = preset.intensity * 1.8
    this.renderer.toneMappingExposure = preset.exposure
    this.scene.environment = this.envMap
    this.needsRender = true
  }

  private fitCamera(): void {
    if (!this.band) return
    const radius = Math.max(6, this.band.outerRadiusMm * 1.12)
    const fov = THREE.MathUtils.degToRad(this.camera.fov)
    const aspect = this.turntable ? 9 / 16 : this.currentAspect()
    const hFov = 2 * Math.atan(Math.tan(fov / 2) * aspect)
    const dist = (radius / Math.sin(Math.min(fov, hFov) / 2)) * 1.08
    this.camera.position.set(0, dist * 0.16, dist)
    this.camera.near = Math.max(0.5, dist * 0.02)
    this.camera.far = dist * 12
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
    this.controls.target.set(0, 0, 0)
    this.controls.minDistance = radius * 1.2
    this.controls.maxDistance = radius * 12
    this.controls.update()
    this.needsRender = true
  }

  private frameCamera(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  private resize(): void {
    if (this.disposed) return
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.needsRender = true
    if (!this.turntable) {
      this.frameCamera(w / Math.max(1, h))
    }
  }

  /** 캔버스 안의 9:16 프레임 위치(위에서부터의 CSS px) */
  private turntableRect(): { x: number; y: number; w: number; h: number; topY: number } {
    const size = this.renderer.getSize(new THREE.Vector2())
    const cw = size.x
    const ch = size.y
    let h = Math.min(ch * 0.94, cw * 0.94 * (16 / 9))
    let w = h * (9 / 16)
    if (w > cw * 0.94) {
      w = cw * 0.94
      h = w * (16 / 9)
    }
    const x = (cw - w) / 2
    const topY = (ch - h) / 2
    return { x, y: ch - topY - h, w, h, topY }
  }

  private emitMetrics(): void {
    if (!this.bandMesh) return
    const result = measure({
      bandGeometry: this.bandMesh.geometry,
      metalParts: this.metalParts,
      gemCount: this.gemParts.length,
    })
    this.lastMetrics = result
    this.callbacks.onMetrics?.({
      measure: result,
      sculpted: this.isSculpted(),
      triangles: result.totalTriangles,
      warnings: this.stoneWarnings,
    })
  }

  private pushSculptUndo(): void {
    if (!this.sculpt) return
    if (this.sculpt.strokes === 0) return
    const attr = this.sculpt.geometry.getAttribute('position') as THREE.BufferAttribute
    this.sculptUndo.push(new Float32Array(attr.array as Float32Array))
    if (this.sculptUndo.length > 20) this.sculptUndo.shift()
  }

  private onPointerDown = (ev: PointerEvent): void => {
    if (this.sculptMode === 'off' || !this.bandMesh) return
    const hit = this.pick(ev)
    if (!hit) return
    ev.preventDefault()
    this.renderer.domElement.setPointerCapture(ev.pointerId)
    this.dragging = true
    this.pushSculptUndo()
    this.strokeAt(hit.point)
  }

  private onPointerMove = (ev: PointerEvent): void => {
    if (!this.dragging || this.sculptMode === 'off') return
    const hit = this.pick(ev)
    if (!hit) return
    ev.preventDefault()
    this.strokeAt(hit.point)
  }

  private onPointerUp = (ev: PointerEvent): void => {
    if (!this.dragging) return
    this.dragging = false
    try {
      this.renderer.domElement.releasePointerCapture(ev.pointerId)
    } catch {
      /* noop */
    }
    this.emitMetrics()
  }

  private strokeAt(worldPoint: THREE.Vector3): void {
    if (!this.sculpt || !this.bandMesh) return
    const local = this.bandMesh.worldToLocal(worldPoint.clone())
    applyBrush(this.sculpt, {
      point: local,
      radiusMm: this.brushRadiusMm,
      strength: this.brushStrength,
      mode: this.sculptMode === 'smooth' ? 'smooth' : this.sculptMode === 'pull' ? 'pull' : 'push',
    })
    this.needsRender = true
  }

  private pick(ev: PointerEvent): { point: THREE.Vector3 } | null {
    if (!this.bandMesh) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObject(this.bandMesh, false)
    if (hits.length === 0) return null
    return { point: hits[0].point.clone() }
  }

  private renderOnce(): void {
    const size = this.renderer.getSize(new THREE.Vector2())
    this.renderer.setScissorTest(false)
    this.renderer.setViewport(0, 0, size.x, size.y)
    if (this.turntable) {
      // 9:16 프레임 밖은 투명하게 지우고, 프레임 안쪽만 렌더링(스시저)
      this.renderer.clear()
      const r = this.turntableRect()
      this.renderer.setScissorTest(true)
      this.renderer.setViewport(r.x, r.y, r.w, r.h)
      this.renderer.setScissor(r.x, r.y, r.w, r.h)
      this.frameCamera(r.w / r.h)
    }
    this.renderer.render(this.scene, this.camera)
  }

  private animate = (): void => {
    if (this.disposed) {
      return
    }
    this.rafId = requestAnimationFrame(this.animate)
    const dt = Math.min(0.05, this.clock.getDelta())

    if (this.turntable) {
      // 1회전 12초
      this.ttAngle += (dt * (Math.PI * 2)) / 12
      this.ringGroup.rotation.y = this.ttAngle
      const t0 = performance.now()
      this.renderOnce()
      this.sampleFrame(performance.now() - t0)
      return
    }

    // 렌더 온디맨드: 카메라(오빗·관성)나 씬이 바뀔 때만 그립니다.
    const moved = this.controls.update()
    if (moved || this.needsRender) {
      this.needsRender = false
      const t0 = performance.now()
      this.renderOnce()
      this.sampleFrame(performance.now() - t0)
    }
  }

  /** 첫 20프레임을 재서 평균이 120ms를 넘으면 보석 투과광을 자동으로 끕니다. */
  private sampleFrame(ms: number): void {
    if (this.perfChecked) return
    this.perfSamples.push(ms)
    if (this.perfSamples.length < 20) return
    this.perfChecked = true
    const avg = this.perfSamples.reduce((a, b) => a + b, 0) / this.perfSamples.length
    if (avg > 120 && this.highQuality) {
      this.setHighQuality(false)
      this.needsRender = true
      this.callbacks.onAutoQuality?.(Math.round(avg))
    }
  }

  private markDirty = (): void => {
    this.needsRender = true
  }
}
