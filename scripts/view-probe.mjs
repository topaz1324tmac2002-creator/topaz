import * as THREE from 'three'
const fov = 32
const outer = 10.13 * 1.25
const radius = Math.max(6, outer)
const rad = THREE.MathUtils.degToRad(fov)
const aspect = 1180 / 640
const hFov = 2 * Math.atan(Math.tan(rad / 2) * aspect)
const dist = (radius / Math.sin(Math.min(rad, hFov) / 2)) * 1.32
console.log('radius', radius.toFixed(2), 'dist', dist.toFixed(2))
// 카메라 (0, dist*0.16, dist), target (0,0,0)
const camPos = new THREE.Vector3(0, dist * 0.16, dist)
const camDir = camPos.clone().normalize()
// 스톤 중심 방향 (0,1,0) — 화면에 보이려면 카메라 방향과의 각도가 fov/2 보다 작아야
const stoneDir = new THREE.Vector3(0, 1, 0)
const ang = camPos.angleTo(camPos.clone().add(stoneDir.clone().multiplyScalar(dist)))
console.log('stone top at angle(deg) from camera axis:', ((ang * 180) / Math.PI).toFixed(1))
const vFovHalf = (fov / 2) * (Math.PI / 180)
console.log('vFov/2 deg:', ((vFovHalf * 180) / Math.PI).toFixed(1))
