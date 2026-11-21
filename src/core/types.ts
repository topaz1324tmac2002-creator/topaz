/**
 * 주얼리 스튜디오 — 도메인 타입
 *
 * 이 파일 이하 src/core/* 는 DOM·React에 의존하지 않는 순수 모듈입니다.
 * (PRD 5.3의 packages/geometry·catalog·export 경계와 1:1 대응하도록 폴더를 나눴습니다.)
 * 단위는 항상 mm / g 입니다.
 */

export type ProfileId = 'dome' | 'flat' | 'bevel' | 'twist'
export type ComfortFit = 'off' | 'soft' | 'strong'
export type StoneShape = 'round' | 'oval' | 'pear' | 'marquise' | 'emerald' | 'cabochon'
export type SettingType = 'prong4' | 'prong6' | 'bezel' | 'halo' | 'channel'
export type GemId = 'diamond' | 'ruby' | 'sapphire' | 'citrine' | 'topaz' | 'blackDiamond'
export type MetalId = 'gold18k' | 'gold14k' | 'rose18k' | 'white18k' | 'silver925' | 'pt950'
export type EnvironmentId = 'studio' | 'softbox' | 'dark'
export type EngravePosition = 'inner' | 'outer'
/** 보석 커팅 방식 — 모양에서 결정됩니다 */
export type StoneCut = 'brilliant' | 'step' | 'cabochon'

export interface BandParams {
  /** KS(한국) 호수 1~30 */
  sizeKR: number
  /** 밴드 폭 mm */
  widthMm: number
  /** 밴드 두께 mm */
  thicknessMm: number
  /** 단면 프로파일 */
  profile: ProfileId
  /** 내부 컴포트 핏 */
  comfort: ComfortFit
}

export interface StoneParams {
  shape: StoneShape
  setting: SettingType
  /** 스톤 개수 1~9 */
  count: number
  /** 스톤 지름(짧은 축) mm */
  sizeMm: number
  /** 프롱 지름 mm */
  prongMm: number
  /** 배치 회전 오프셋(도) */
  rotationDeg: number
  /** 보석 재질(색) */
  gem: GemId
}

export interface EngravingParams {
  enabled: boolean
  text: string
  position: EngravePosition
  /** 문자 높이 mm */
  heightMm: number
}

export interface Design {
  band: BandParams
  stone: StoneParams
  engraving: EngravingParams
  metal: MetalId
  environment: EnvironmentId
}

export interface Metal {
  id: MetalId
  name: string
  short: string
  /** PBR 기준색 */
  color: number
  roughness: number
  /** 비중 g/cm³ (PRD 3.5 표) */
  density: number
  /** 주물 수축률 */
  shrink: number
}

export interface Gem {
  id: GemId
  name: string
  short: string
  /** 기준색 */
  color: number
  /** 굴절률(IOR) */
  ior: number
  roughness: number
  /** 환경 반사 강도 */
  envIntensity: number
  /** 투과(transmission) 세기 */
  transmission: number
  /** 표면 코트층 세기 — 패싯 경계의 날카로운 반사광을 만듭니다(기본 1) */
  clearcoat?: number
  /** 코트층 거칠기(기본 0.02) */
  clearcoatRoughness?: number
  /** 유전체 반사 하이라이트 세기(기본 1) */
  specularIntensity?: number
  /** 빛을 통과시키지 않는 보석 — 투과 대신 표면 반사로만 표현합니다(블랙 다이아몬드) */
  opaque?: boolean
}

export const DEFAULT_DESIGN: Design = {
  band: {
    sizeKR: 12,
    widthMm: 4,
    thicknessMm: 1.8,
    profile: 'dome',
    comfort: 'soft',
  },
  stone: {
    shape: 'round',
    setting: 'prong4',
    count: 1,
    sizeMm: 4,
    prongMm: 0.9,
    rotationDeg: 0,
    gem: 'diamond',
  },
  engraving: {
    enabled: false,
    text: '2026 KIM',
    position: 'inner',
    heightMm: 1.2,
  },
  metal: 'gold18k',
  environment: 'studio',
}
