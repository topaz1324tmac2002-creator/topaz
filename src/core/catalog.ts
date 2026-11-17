/**
 * 카탈로그 — 금속·보석·프로파일·스톤 모양·세팅·호수 환산.
 * 실제 현장 값(비중·수축률·프롱 두께)을 코드 수정 없이 바꿀 수 있도록 데이터로 분리했습니다.
 */
import type {
  ComfortFit,
  EnvironmentId,
  Gem,
  GemId,
  Metal,
  MetalId,
  ProfileId,
  SettingType,
  StoneCut,
  StoneShape,
} from './types'

export const METALS: Record<MetalId, Metal> = {
  gold18k: { id: 'gold18k', name: '18K 옐로우 골드', short: '18K', color: 0xe8c56b, roughness: 0.09, density: 15.5, shrink: 0.015 },
  gold14k: { id: 'gold14k', name: '14K 옐로우 골드', short: '14K', color: 0xdfc07a, roughness: 0.11, density: 13.4, shrink: 0.013 },
  rose18k: { id: 'rose18k', name: '18K 로즈 골드', short: '18K R', color: 0xe0a98c, roughness: 0.1, density: 15.2, shrink: 0.015 },
  white18k: { id: 'white18k', name: '18K 화이트 골드', short: '18K W', color: 0xe6e8ea, roughness: 0.06, density: 15.3, shrink: 0.015 },
  silver925: { id: 'silver925', name: '925 실버', short: '925', color: 0xdde0e2, roughness: 0.13, density: 10.36, shrink: 0.02 },
  pt950: { id: 'pt950', name: '플래티넘 950', short: 'Pt950', color: 0xd9dcdf, roughness: 0.08, density: 20.1, shrink: 0.016 },
}

export const METAL_ORDER: MetalId[] = ['gold18k', 'gold14k', 'rose18k', 'white18k', 'silver925', 'pt950']

/** 보석 재질 — 색·굴절률·투과 세기를 실제 보석 값에 맞춰 둡니다. */
export const GEMS: Record<GemId, Gem> = {
  diamond: { id: 'diamond', name: '다이아몬드', short: 'DIA', color: 0xf4f9ff, ior: 2.417, roughness: 0.03, envIntensity: 2.6, transmission: 0.9 },
  ruby: { id: 'ruby', name: '루비', short: 'RUBY', color: 0xb00d24, ior: 1.77, roughness: 0.05, envIntensity: 2.2, transmission: 0.72 },
  sapphire: { id: 'sapphire', name: '사파이어', short: 'SAP', color: 0x123a96, ior: 1.77, roughness: 0.05, envIntensity: 2.2, transmission: 0.72 },
  citrine: { id: 'citrine', name: '시트린', short: 'CIT', color: 0xe0900f, ior: 1.55, roughness: 0.06, envIntensity: 2.1, transmission: 0.7 },
  topaz: { id: 'topaz', name: '토파즈 (스위스 블루)', short: 'TPZ', color: 0x3fa9dd, ior: 1.62, roughness: 0.04, envIntensity: 2.3, transmission: 0.78 },
}

export const GEM_ORDER: GemId[] = ['diamond', 'ruby', 'sapphire', 'citrine', 'topaz']

export const PROFILES: { id: ProfileId; label: string; hint: string }[] = [
  { id: 'dome', label: '돔', hint: '바깥면이 볼록한 기본형. 가장 흔한 결혼반지 단면' },
  { id: 'flat', label: '평면', hint: '각진 모서리의 클래식한 플랫 밴드' },
  { id: 'bevel', label: '각진', hint: '바깥 모서리를 깎은 베벨(나이프) 단면' },
  { id: 'twist', label: '트위스트', hint: '바깥면이 나선으로 꼬인 로프형 밴드. 안쪽은 매끈한 원통으로 유지됩니다' },
]

export const COMFORT: { id: ComfortFit; label: string; k: number }[] = [
  { id: 'off', label: '끔', k: 0 },
  { id: 'soft', label: '약', k: 0.5 },
  { id: 'strong', label: '강', k: 1 },
]

export const STONE_SHAPES: { id: StoneShape; label: string; cut: StoneCut; aspect: number; hint: string }[] = [
  { id: 'round', label: '라운드', cut: 'brilliant', aspect: 1, hint: '브릴리언트 컷 — 원형. 8개의 카이트(비젤)·8개의 스타·16개의 어퍼 거들 면' },
  { id: 'oval', label: '오벌', cut: 'brilliant', aspect: 1.4, hint: '브릴리언트 컷 타원형 — 폭:길이 = 1:1.4 (정석 오벌 비율)' },
  { id: 'pear', label: '페어', cut: 'brilliant', aspect: 4 / 3, hint: '브릴리언트 컷 물방울형 — 폭:길이 = 3:4, 둥근 몸통 + 뾰족한 팁' },
  { id: 'marquise', label: '마퀴즈', cut: 'brilliant', aspect: 2, hint: '브릴리언트 컷 보트형 — 폭:길이 = 1:2, 양 끝이 뾰족합니다' },
  { id: 'emerald', label: '에메랄드컷', cut: 'step', aspect: 1.3, hint: '스텝 컷 — 모서리를 깎은 직사각형, 계단형 면' },
  { id: 'cabochon', label: '캐보션', cut: 'cabochon', aspect: 1.15, hint: '패싯 없이 매끈하게 연마한 볼록 돔' },
]

export function stoneShape(id: StoneShape): (typeof STONE_SHAPES)[number] {
  return STONE_SHAPES.find((s) => s.id === id) ?? STONE_SHAPES[0]
}

/** 스톤 실측 크기 — sizeMm 는 폭(짧은 축), 길이 = 폭 × aspect */
export function stoneDimensions(shape: StoneShape, sizeMm: number): { width: number; length: number } {
  return { width: sizeMm, length: sizeMm * stoneShape(shape).aspect }
}

export const SETTINGS: { id: SettingType; label: string; hint: string }[] = [
  { id: 'prong4', label: '프롱 4', hint: '프롱: 금속 다리 4개로 스톤을 잡습니다. 빛이 잘 들어가 반짝임이 좋습니다.' },
  { id: 'prong6', label: '프롱 6', hint: '프롱: 다리 6개. 큰 스톤을 더 단단히 잡습니다.' },
  { id: 'bezel', label: '베젤', hint: '베젤: 스톤 둘레를 금속 테로 감쌉니다. 프롱보다 안전하지만 스톤이 작아 보입니다.' },
  { id: 'halo', label: '헤일로', hint: '헤일로: 센터 스톤 둘레를 같은 윤곽의 작은 메레 스톤이 감쌉니다. 스톤이 크게 보입니다.' },
  { id: 'channel', label: '채널', hint: '채널: 두 개의 금속 벽 사이에 작은 스톤을 나란히 물려 넣습니다(숄더 장식).' },
]

export function settingLabel(id: SettingType): string {
  return SETTINGS.find((s) => s.id === id)?.label ?? id
}

export const ENVIRONMENTS: { id: EnvironmentId; label: string; hint: string }[] = [
  { id: 'studio', label: '스튜디오', hint: '수업 시연용 기본 조명' },
  { id: 'softbox', label: '소프트박스', hint: '제품 사진풍의 부드러운 반사' },
  { id: 'dark', label: '다크', hint: '영상 촬영용 어두운 배경 + 강한 하이라이트' },
]

/* ── 호수 환산 (PRD 부록 A) ───────────────────────────────────────── */

/** KS 신게이지: 1호 = 내경 13.0mm, 1호당 +1/3mm */
export function ksToInnerDiameter(ks: number): number {
  return 13 + (ks - 1) / 3
}

export function innerDiameterToKs(mm: number): number {
  return (mm - 13) * 3 + 1
}

/** US: 내경 = 11.63 + 0.8128 × US */
export function innerDiameterToUs(mm: number): number {
  return (mm - 11.63) / 0.8128
}

export function usToInnerDiameter(us: number): number {
  return 11.63 + 0.8128 * us
}

export function innerCircumference(mm: number): number {
  return mm * Math.PI
}

/** 화면 표시용 US 호수(0.5 단위 반올림) */
export function formatUs(mm: number): string {
  const us = innerDiameterToUs(mm)
  return (Math.round(us * 2) / 2).toFixed(1)
}

/** KS 호수를 0.5 단위로 스냅하지 않고 1~30 정수로 유지 */
export function clampKs(ks: number): number {
  return Math.min(30, Math.max(1, Math.round(ks)))
}
