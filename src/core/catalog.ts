/**
 * 카탈로그 — 금속·프로파일·호수 환산.
 * 실제 현장 값(비중·수축률·프롱 두께)을 코드 수정 없이 바꿀 수 있도록 데이터로 분리했습니다.
 */
import type {
  ComfortFit,
  EnvironmentId,
  Metal,
  MetalId,
  ProfileId,
  SettingType,
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

export const PROFILES: { id: ProfileId; label: string; hint: string }[] = [
  { id: 'dome', label: '돔', hint: '바깥면이 볼록한 기본형. 가장 흔한 결혼반지 단면' },
  { id: 'flat', label: '평면', hint: '각진 모서리의 클래식한 플랫 밴드' },
  { id: 'bevel', label: '각진', hint: '바깥 모서리를 깎은 베벨(나이프) 단면' },
]

export const COMFORT: { id: ComfortFit; label: string; k: number }[] = [
  { id: 'off', label: '끔', k: 0 },
  { id: 'soft', label: '약', k: 0.5 },
  { id: 'strong', label: '강', k: 1 },
]

export const STONE_SHAPES: { id: StoneShape; label: string }[] = [
  { id: 'round', label: '라운드' },
  { id: 'oval', label: '오벌' },
]

export const SETTINGS: { id: SettingType; label: string }[] = [
  { id: 'prong4', label: '프롱 4' },
  { id: 'prong6', label: '프롱 6' },
  { id: 'bezel', label: '베젤' },
]

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
