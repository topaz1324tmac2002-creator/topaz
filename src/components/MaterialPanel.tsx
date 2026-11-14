import { useStore } from '../store'
import { ENVIRONMENTS, METALS, METAL_ORDER } from '../core/catalog'
import { Segmented, Section, Toggle } from './controls'

function swatchColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`
}

export function MaterialPanel(): JSX.Element {
  const metal = useStore((s) => s.design.metal)
  const environment = useStore((s) => s.design.environment)
  const highQuality = useStore((s) => s.highQuality)
  const setHighQuality = useStore((s) => s.setHighQuality)
  const setMetal = useStore((s) => s.setMetal)
  const setEnvironment = useStore((s) => s.setEnvironment)

  return (
    <div className="stack">
      <Section title="금속 재질" aside={<span className="badge">{METALS[metal].short}</span>}>
        <div className="metal-grid">
          {METAL_ORDER.map((id) => {
            const m = METALS[id]
            return (
              <button
                key={id}
                type="button"
                className={`metal${id === metal ? ' is-active' : ''}`}
                onClick={() => setMetal(id)}
                aria-pressed={id === metal}
              >
                <span
                  className="metal-swatch"
                  style={{
                    background: `radial-gradient(circle at 32% 28%, #ffffffcc 0%, ${swatchColor(m.color)} 42%, #00000055 100%)`,
                  }}
                />
                <span className="metal-name">{m.name}</span>
                <span className="metal-meta">
                  {m.density.toFixed(2)} g/cm³ · 수축 {(m.shrink * 100).toFixed(1)}%
                </span>
              </button>
            )
          })}
        </div>
      </Section>

      <Section title="조명 환경">
        <Segmented
          value={environment}
          options={ENVIRONMENTS.map((e) => ({ value: e.id, label: e.label }))}
          hint={ENVIRONMENTS.find((e) => e.id === environment)?.hint}
          onChange={(v) => setEnvironment(v)}
        />
        <p className="field-hint">
          금속 반사는 환경맵(HDRI)으로 표현됩니다. 실제 조명과 가장 비슷한 것은 ‘소프트박스’입니다.
        </p>
      </Section>

      <Section title="보석 품질">
        <Toggle
          label="보석 투과광 (고품질)"
          checked={highQuality}
          hint="켜면 다이아몬드가 빛을 통과시키는 물리 기반 재질로 렌더링됩니다. GPU 부담이 커서 아이패드 구형 기기·소프트웨어 렌더러에서는 자동으로 꺼집니다."
          onChange={setHighQuality}
        />
      </Section>
    </div>
  )
}
