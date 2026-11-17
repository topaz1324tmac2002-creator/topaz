import { useStore } from '../store'
import { ENVIRONMENTS, GEMS, GEM_ORDER, METALS, METAL_ORDER } from '../core/catalog'
import { Segmented, Section, Toggle } from './controls'

function swatchColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`
}

export function MaterialPanel(): JSX.Element {
  const metal = useStore((s) => s.design.metal)
  const environment = useStore((s) => s.design.environment)
  const gem = useStore((s) => s.design.stone.gem)
  const patchStone = useStore((s) => s.patchStone)
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

      <Section title="보석 재질" aside={<span className="badge">{GEMS[gem].short}</span>}>
        <div className="metal-grid">
          {GEM_ORDER.map((id) => {
            const g = GEMS[id]
            return (
              <button
                key={id}
                type="button"
                className={`metal${id === gem ? ' is-active' : ''}`}
                onClick={() => patchStone({ gem: id }, 'stone:gem')}
                aria-pressed={id === gem}
              >
                <span
                  className="metal-swatch"
                  style={{
                    background: `radial-gradient(circle at 32% 28%, #ffffffcc 0%, ${swatchColor(g.color)} 42%, #00000088 100%)`,
                  }}
                />
                <span className="metal-name">{g.name}</span>
                <span className="metal-meta">
                  IOR {g.ior.toFixed(2)} · 투과 {Math.round(g.transmission * 100)}%
                </span>
              </button>
            )
          })}
        </div>
        <p className="field-hint">
          루비·사파이어는 코런덤(IOR 1.77), 시트린은 석영(IOR 1.55), 토파즈는 스위스 블루(IOR 1.62) 값으로
          렌더링됩니다.
        </p>
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
          hint="켜면 보석이 빛을 통과시키는 물리 기반 재질로 렌더링됩니다. GPU 부담이 커서 아이패드 구형 기기·소프트웨어 렌더러에서는 자동으로 꺼집니다."
          onChange={setHighQuality}
        />
      </Section>
    </div>
  )
}
