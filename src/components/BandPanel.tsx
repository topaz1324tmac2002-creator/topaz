import { useStore } from '../store'
import { PROFILES, formatUs, innerCircumference, ksToInnerDiameter } from '../core/catalog'
import { buildProfile } from '../core/ring'
import { Segmented, Section, Slider, Stat } from './controls'

export function BandPanel(): JSX.Element {
  const band = useStore((s) => s.design.band)
  const patchBand = useStore((s) => s.patchBand)

  const innerDiameter = ksToInnerDiameter(band.sizeKR)
  const profile = buildProfile(band)

  return (
    <div className="stack">
      <Section
        title="호수"
        aside={<span className="badge">KS {band.sizeKR}호</span>}
      >
        <Slider
          label="한국(KS) 호수"
          value={band.sizeKR}
          min={1}
          max={30}
          step={1}
          unit="호"
          onChange={(v) => patchBand({ sizeKR: v }, 'band:size')}
        />
        <div className="stats-grid">
          <Stat label="내경" value={innerDiameter.toFixed(2)} unit="mm" />
          <Stat label="안둘레" value={innerCircumference(innerDiameter).toFixed(1)} unit="mm" />
          <Stat label="US" value={formatUs(innerDiameter)} unit="호" />
        </div>
        <p className="field-hint">
          반지 안쪽 지름을 기준으로 계산합니다(KS 신게이지 1호 = 13.0mm, 1호당 1/3mm). 호수를 모르면 종이에
          원을 그려 손가락 둘레를 재면 됩니다.
        </p>
      </Section>

      <Section title="밴드 치수">
        <Slider
          label="밴드 폭"
          value={band.widthMm}
          min={1.5}
          max={12}
          step={0.1}
          unit="mm"
          onChange={(v) => patchBand({ widthMm: v }, 'band:width')}
        />
        <Slider
          label="밴드 두께"
          value={band.thicknessMm}
          min={1}
          max={3.5}
          step={0.1}
          unit="mm"
          hint="주물 기준 권장 최소 0.8mm. 얇을수록 가볍지만 출력 실패 위험이 커집니다."
          onChange={(v) => patchBand({ thicknessMm: v }, 'band:thickness')}
        />
      </Section>

      <Section title="단면 프로파일" aside={<span className="badge soft">단면적 {profile.area.toFixed(2)}mm²</span>}>
        <Segmented
          value={band.profile}
          options={PROFILES.map((p) => ({ value: p.id, label: p.label }))}
          hint={PROFILES.find((p) => p.id === band.profile)?.hint}
          onChange={(v) => patchBand({ profile: v }, 'band:profile')}
        />
        <Segmented
          label="컴포트 핏 (안쪽 모서리 라운드)"
          value={band.comfort}
          options={[
            { value: 'off', label: '끔' },
            { value: 'soft', label: '약' },
            { value: 'strong', label: '강' },
          ]}
          onChange={(v) => patchBand({ comfort: v }, 'band:comfort')}
        />
      </Section>
    </div>
  )
}
