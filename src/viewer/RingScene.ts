/**
 * 뷰포트 — three.js 씬(카메라·조명·환경맵·오빗 컨트롤·실시간 금속/보석 렌더링).
 * React에는 이 클래스의 인스턴스만 넘기고, 상태 변경은 메서드로 반영합니다.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { buildProfile, buildRing, type RingBuild, type TwistSpec } from '../core/ring'
import { buildStones, type MeshPart } from '../core/stones'
import { buildEngraving, makeEngravingMaterial } from '../core/engraving'
import { GEMS, METALS } from '../core/catalog'
import { buildBinarySTL, countTriangles, stlFileName, type StlPart } from '../core/stl'
import { measure, type MeasureResult } from '../core/measure'
import type { Design, EnvironmentId, Gem, MetalId } from '../core/types'

export interface SceneMetrics {
  measure: MeasureResult
  triangles: number
  warnings: string[]
}

export interface SceneCallbacks {
  onMetrics?: (m: SceneMetrics) => void
  onError?: (message: string) => void
  /** 첫 20프레임이 느리면 고비용 효과를 자동으로 끕니다(적응형 품질) */
  onAutoQuality?: (avgFrameMs: number) => void
}

/** 카메라 프리셋
 *  · front  : 반지 면을 정면에서
 *  · right  : 밴드 폭·단면이 정면으로 보이는 우측 뷰
 *  · engrave: 각인 면(안쪽이면 위에서, 바깥이면 아래에서)이 정면으로 보이는 뷰
 */
export type ViewPreset = 'front' | 'right' | 'engrave'

type ViewAnim = { from: THREE.Vector3; to: THREE.Vector3; start: number; dur: number } | null

export class RingScene {
  private container: HTMLElement
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private ringGroup: THREE.Group
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
  private twist: TwistSpec | undefined = undefined

  private highQuality = true
  private perfSamples: number[] = []
  private perfChecked = false
  /** 화면에 다시 그려야 하는 상태인지 (렌더 온디맨드) */
  private needsRender = true
  private viewAnim: ViewAnim = null
  private lastMetrics: MeasureResult | null = null
  private disposed = false
  private rafId = 0

  constructor(container: HTMLElement, design: Design, callbacks: SceneCallbacks = {}) {
    this.container = container
    this.design = design
    this.callbacks = callbacks

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
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
    this.camera = new THREE.PerspectiveCamera(32, aspect, 0.6, 5000)
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
      color: GEMS[design.stone.gem].color,
      metalness: 0,
      roughness: GEMS[design.stone.gem].roughness,
      transmission: 0,
      thickness: 2,
      ior: GEMS[design.stone.gem].ior,
      reflectivity: 1,
      specularIntensity: 1,
      envMapIntensity: 2.6,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    })
    this.applyGem(design.stone.gem)

    this.applyEnvironment(design.environment)
    this.setHighQuality(this.highQuality)
    this.rebuild({ refit: true, then: null })

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)

    // 사용자가 직접 돌리거나 확대하면 자동 뷰 전환은 즉시 물러납니다.
    this.renderer.domElement.addEventListener('pointerdown', this.cancelViewAnim)
    this.renderer.domElement.addEventListener('wheel', this.cancelViewAnim, { passive: true })

    this.needsRender = true
    this.animate()
  }

  /* ── 공개 API ─────────────────────────────────────────────── */

  updateDesign(design: Design): void {
    const prev = this.design
    const sizeChanged = design.band.sizeKR !== prev.band.sizeKR
    const widthChanged = design.band.widthMm !== prev.band.widthMm
    const geometryChanged =
      sizeChanged ||
      widthChanged ||
      design.band.thicknessMm !== prev.band.thicknessMm ||
      design.band.profile !== prev.band.profile ||
      design.band.comfort !== prev.band.comfort ||
      stoneKey(design) !== stoneKey(prev) ||
      design.engraving.enabled !== prev.engraving.enabled ||
      design.engraving.text !== prev.engraving.text ||
      design.engraving.position !== prev.engraving.position ||
      design.engraving.heightMm !== prev.engraving.heightMm

    const gemChanged = design.stone.gem !== prev.stone.gem
    const metalChanged = design.metal !== prev.metal
    const envChanged = design.environment !== prev.environment
    this.design = design

    // 각인을 켜거나 안/바깥을 바꾸면 각인 면이 보이는 뷰로 부드럽게 이동합니다.
    const engravingTurnedOn = design.engraving.enabled && !prev.engraving.enabled
    const engravingMoved =
      design.engraving.enabled && design.engraving.position !== prev.engraving.position

    if (geometryChanged) {
      const then: ViewPreset | null = widthChanged
        ? 'right' // 밴드 폭을 조절하면 폭·단면이 바로 보이는 우측 뷰로
        : engravingTurnedOn || engravingMoved
          ? 'engrave'
          : null
      this.rebuild({ refit: sizeChanged, then })
    }
    if (metalChanged) this.applyMetal(design.metal)
    if (gemChanged) this.applyGem(design.stone.gem)
    if (envChanged) this.applyEnvironment(design.environment)
  }

  /** 카메라를 지정한 프리셋으로 옮깁니다. */
  applyView(preset: ViewPreset, animate = true): void {
    this.updateFitSphere()
    const dist = this.fitDistance()
    const c = this.fitSphere.center
    const side = this.design.engraving.position === 'outer' ? -1 : 1
    const to =
      preset === 'right'
        ? new THREE.Vector3(c.x + dist, c.y + dist * 0.24, c.z)
        : preset === 'engrave'
          ? // 각인은 6시(스톤 반대편)에 있으므로 위(안쪽)/아래(바깥)에서 내려다봅니다.
            new THREE.Vector3(c.x + dist * 0.12, c.y + dist * 0.9 * side, c.z + dist * 0.36)
          : new THREE.Vector3(c.x, c.y + dist * 0.16, c.z + dist)
    this.controls.target.copy(c)
    if (!animate) {
      this.camera.position.copy(to)
      this.controls.update()
      this.needsRender = true
      return
    }
    this.viewAnim = { from: this.camera.position.clone(), to, start: performance.now(), dur: 620 }
    this.needsRender = true
  }

  /** 보석 투과광(transmission)은 GPU 비용이 큽니다. 저사양·소프트웨어 렌더러에서는 끕니다. */
  setHighQuality(on: boolean): void {
    this.highQuality = on
    const gem = GEMS[this.design.stone.gem]
    this.gemMaterial.transmission = on ? gem.transmission : 0
    this.gemMaterial.transparent = true
    this.gemMaterial.opacity = on ? 1 : 0.86
    this.gemMaterial.depthWrite = on
    this.gemMaterial.needsUpdate = true
    this.needsRender = true
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

  getMetrics(): MeasureResult | null {
    return this.lastMetrics
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.rafId)
    this.resizeObserver.disconnect()
    this.renderer.domElement.removeEventListener('pointerdown', this.cancelViewAnim)
    this.renderer.domElement.removeEventListener('wheel', this.cancelViewAnim)
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

  /** 밴드 + 스톤·세팅 전체를 담는 구 — 프레이밍·클리핑·줌 범위가 모두 이 구를 기준으로 합니다. */
  private fitSphere = new THREE.Sphere(new THREE.Vector3(), 11)

  private updateFitSphere(): void {
    this.ringGroup.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(this.ringGroup)
    if (box.isEmpty()) {
      this.fitSphere.set(new THREE.Vector3(), Math.max(6, (this.band?.outerRadiusMm ?? 11) * 1.2))
      return
    }
    box.getBoundingSphere(this.fitSphere)
    // 살짝 여유를 둡니다.
    this.fitSphere.radius *= 1.04
  }

  /** 디자인 전체가 화면에 꽉 차는 카메라 거리 */
  private fitDistance(): number {
    const radius = Math.max(6, this.fitSphere.radius)
    const fov = THREE.MathUtils.degToRad(this.camera.fov)
    const aspect = this.currentAspect()
    const hFov = 2 * Math.atan(Math.tan(fov / 2) * aspect)
    return (radius / Math.sin(Math.min(fov, hFov) / 2)) * 1.08
  }

  private rebuild(opts: { refit: boolean; then: ViewPreset | null }): void {
    const first = !this.band
    this.clearModel()

    const band = buildRing(this.design.band)
    this.band = band
    const profile = buildProfile(this.design.band)
    this.twist = profile.twist

    const bandMesh = new THREE.Mesh(band.geometry, this.bandMaterial)
    bandMesh.name = 'band'
    this.bandMesh = bandMesh
    this.ringGroup.add(bandMesh)

    // 스톤 & 세팅
    const stones = buildStones(this.design.stone, {
      outerRadiusMm: band.outerRadiusMm,
      profileRadial: band.profileMaxRadial,
    })
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
      const engrave = buildEngraving(this.design.engraving, {
        profile: profile.points,
        innerRadiusMm: band.innerRadiusMm,
        widthMm: this.design.band.widthMm,
        metalColor: METALS[this.design.metal].color,
        twist: this.twist,
      })
      if (engrave) {
        const mat = makeEngravingMaterial(engrave, METALS[this.design.metal].color)
        const mesh = new THREE.Mesh(engrave.geometry, mat)
        mesh.renderOrder = 1
        this.engravingMesh = mesh
        this.ringGroup.add(mesh)
      }
    }

    this.updateFitSphere()
    if (!first && !opts.refit) {
      this.updateClip()
    }
    if (first || opts.refit) this.fitCamera()
    if (first) this.applyView('front', false)
    if (opts.then) this.applyView(opts.then, true)
    // 어떤 경로로 재구성했든 화면을 다시 그려야 합니다(스톤 개수·모양·세팅 변경은
    // 카메라가 그대로라 렌더 온디맨드가 발화하지 않습니다).
    this.needsRender = true
    this.emitMetrics()
  }

  private clearModel(): void {
    const disposeSet = new Set<THREE.BufferGeometry>()
    for (const m of [this.bandMesh, ...this.gemMeshes, ...this.metalMeshes, this.engravingMesh]) {
      if (!m) continue
      disposeSet.add(m.geometry)
      this.ringGroup.remove(m)
    }
    // 같은 지오메트리를 여러 메쉬가 공유하므로(메레 스톤 등) 참조를 세어 0이 되면 dispose 합니다.
    const refs = new Map<THREE.BufferGeometry, number>()
    for (const part of [...this.gemParts, ...this.metalParts]) {
      refs.set(part.geometry, (refs.get(part.geometry) ?? 0) + 1)
    }
    for (const g of disposeSet) {
      const n = refs.get(g) ?? 0
      if (n <= 1) g.dispose()
    }
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

  private applyMetal(metalId: MetalId): void {
    const metal = METALS[metalId]
    this.bandMaterial.color.setHex(metal.color)
    this.bandMaterial.roughness = metal.roughness
    this.bandMaterial.needsUpdate = true
    this.needsRender = true
    if (this.engravingMesh) {
      const mat = this.engravingMesh.material as THREE.MeshStandardMaterial
      mat.color.setHex(metal.color).multiplyScalar(0.4)
      mat.needsUpdate = true
    }
  }

  private applyGem(gemId: Design['stone']['gem']): void {
    const gem: Gem = GEMS[gemId]
    this.gemMaterial.color.setHex(gem.color)
    this.gemMaterial.ior = gem.ior
    this.gemMaterial.roughness = gem.roughness
    this.gemMaterial.envMapIntensity = gem.envIntensity
    this.gemMaterial.attenuationColor = new THREE.Color(gem.color).lerp(new THREE.Color(0xffffff), 0.35)
    this.gemMaterial.attenuationDistance = 1.4
    this.gemMaterial.transmission = this.highQuality ? gem.transmission : 0
    this.gemMaterial.needsUpdate = true
    this.needsRender = true
  }

  private applyEnvironment(id: EnvironmentId): void {
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

  private updateClip(): void {
    const radius = Math.max(6, this.fitSphere.radius)
    // 깊이 정밀도가 확보되도록 near 를 너무 작게 두지 않습니다(각인 패치 z-파이팅 방지).
    this.camera.near = Math.max(0.8, radius * 0.09)
    this.camera.far = radius * 90
    this.camera.aspect = this.currentAspect()
    this.camera.updateProjectionMatrix()
    this.controls.minDistance = radius * 1.05
    this.controls.maxDistance = radius * 8
  }

  private fitCamera(): void {
    if (!this.band) return
    this.updateFitSphere()
    const dist = this.fitDistance()
    this.updateClip()
    this.controls.target.copy(this.fitSphere.center)
    this.camera.position.set(
      this.fitSphere.center.x,
      this.fitSphere.center.y + dist * 0.16,
      this.fitSphere.center.z + dist,
    )
    this.camera.lookAt(this.fitSphere.center)
    this.controls.update()
    this.needsRender = true
  }

  private cancelViewAnim = (): void => {
    if (this.viewAnim) {
      this.viewAnim = null
      this.needsRender = true
    }
  }

  private stepViewAnim(now: number): void {
    const anim = this.viewAnim
    if (!anim) return
    const t = Math.min(1, (now - anim.start) / anim.dur)
    const e = 1 - Math.pow(1 - t, 3) // ease-out
    this.camera.position.copy(anim.from).lerp(anim.to, e)
    this.camera.lookAt(this.fitSphere.center)
    this.needsRender = true
    if (t >= 1) this.viewAnim = null
  }

  private resize(): void {
    if (this.disposed) return
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / Math.max(1, h)
    this.camera.updateProjectionMatrix()
    this.needsRender = true
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
      triangles: result.totalTriangles,
      warnings: this.stoneWarnings,
    })
  }

  private renderOnce(): void {
    this.renderer.setScissorTest(false)
    const size = this.renderer.getSize(new THREE.Vector2())
    this.renderer.setViewport(0, 0, size.x, size.y)
    this.renderer.render(this.scene, this.camera)
  }

  private animate = (): void => {
    if (this.disposed) return
    this.rafId = requestAnimationFrame(this.animate)

    let moved = false
    if (this.viewAnim) {
      // 자동 뷰 전환 중에는 오빗 컨트롤 관성과 싸우지 않도록 update() 를 건너뜁니다.
      this.stepViewAnim(performance.now())
    } else {
      moved = this.controls.update()
    }

    // 렌더 온디맨드: 카메라(오빗·관성)·씬이 바뀔 때만 그립니다.
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

/** 스톤 기하에 영향을 주는 값만 뽑은 키(보석 색은 재질만 바꿉니다) */
function stoneKey(d: Design): string {
  const s = d.stone
  return [s.shape, s.setting, s.count, s.sizeMm, s.prongMm, s.rotationDeg].join('|')
}
