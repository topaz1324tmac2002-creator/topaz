import { useStore } from '../store'
import { GEMS, GEM_ORDER, SETTINGS, STONE_SHAPES, ksToInnerDiameter, stoneShape } from '../core/catalog'
import { estimateCarat } from '../core/stones'
import { Segmented, Section, Slider, Stat } from './controls'

export function StonePanel({ warnings }: { warnings: string[] }): JSX.Element {
  const stone = useStore((s) => s.design.stone)
  const band = useStore((s) => s.design.band)
  const patchStone = useStore((s) => s.patchStone)
  const hasStone = stone.count > 0
  const circumference = 2 * Math.PI * (ksToInnerDiameter(band.sizeKR) / 2)
  const spec = stoneShape(stone.shape)
  const footprint = stone.sizeMm * spec.aspect
  const setting = SETTINGS.find((s) => s.id === stone.setting)

  return (
    <div className="stack">
      <Section
        title="스톤"
        aside={<span className="badge">{hasStone ? `${stone.count}개 · ${stone.sizeMm.toFixed(1)}mm` : '없음'}</span>}
      >
        <Slider
          label="스톤 개수"
          value={stone.count}
          min={0}
          max={9}
          step={1}
          unit="개"
          hint="0으로 두면 스톤 없는 순수 밴드가 됩니다. 개수를 늘리면 상단 원주에 균등 배치됩니다."
          onChange={(v) => patchStone({ count: v }, 'stone:count')}
        />
        <Slider
          label="스톤 크기"
          value={stone.sizeMm}
          min={1.5}
          max={8}
          step={0.1}
          unit="mm"
          hint={
            hasStone
              ? `다이아몬드 기준 약 ${estimateCarat(stone.sizeMm, stone.shape).toFixed(2)}ct (1개, 참고값)`
              : undefined
          }
          onChange={(v) => patchStone({ sizeMm: v }, 'stone:size')}
        />
      </Section>

      <Section title="모양" aside={<span className="badge soft">{spec.cut === 'step' ? '스텝 컷' : spec.cut === 'cabochon' ? '캐보션' : '브릴리언트'}</span>}>
        <Segmented
          label="스톤 모양"
          value={stone.shape}
          options={STONE_SHAPES.map((s) => ({ value: s.id, label: s.label }))}
          hint={spec.hint}
          onChange={(v) => patchStone({ shape: v }, 'stone:shape')}
        />
      </Section>

      <Section title="보석 색" aside={<span className="badge">{GEMS[stone.gem].short}</span>}>
        <Segmented
          value={stone.gem}
          wrap={GEM_ORDER.length > 5}
          options={GEM_ORDER.map((id) => ({ value: id, label: GEMS[id].name.replace(' (스위스 블루)', '') }))}
          onChange={(v) => patchStone({ gem: v }, 'stone:gem')}
        />
        <p className="field-hint">
          굴절률 {GEMS[stone.gem].ior.toFixed(2)} · {GEMS[stone.gem].name}. 색은 3D 뷰와 렌더 품질(투과광)에
          바로 반영됩니다.
        </p>
      </Section>

      <Section title="세팅">
        <Segmented
          label="세팅 방식"
          value={stone.setting}
          options={SETTINGS.map((s) => ({ value: s.id, label: s.label }))}
          hint={setting?.hint}
          onChange={(v) => patchStone({ setting: v }, 'stone:setting')}
        />
        {stone.setting === 'prong4' || stone.setting === 'prong6' ? (
          <Slider
            label="프롱 지름"
            value={stone.prongMm}
            min={0.6}
            max={1.4}
            step={0.05}
            unit="mm"
            decimals={2}
            onChange={(v) => patchStone({ prongMm: v }, 'stone:prong')}
          />
        ) : null}
        <Slider
          label="배치 회전"
          value={stone.rotationDeg}
          min={-90}
          max={90}
          step={1}
          unit="°"
          onChange={(v) => patchStone({ rotationDeg: v }, 'stone:rotation')}
        />
      </Section>

      <Section title="배치 검증">
        <div className="stats-grid">
          <Stat label="스톤 외접" value={footprint.toFixed(1)} unit="mm" />
          <Stat label="밴드 원주" value={circumference.toFixed(1)} unit="mm" />
          <Stat label="세팅" value={setting?.label ?? '-'} />
        </div>
        {warnings.length === 0 ? (
          <p className="field-hint ok-text">간섭 없음 — 이웃 스톤 사이 최소 금속 두께가 확보되어 있습니다.</p>
        ) : (
          warnings.map((w) => (
            <p key={w} className="field-hint warn-text">
              ⚠ {w}
            </p>
          ))
        )}
      </Section>
    </div>
  )
}
