import { useStore } from '../store'
import { SETTINGS, STONE_SHAPES, ksToInnerDiameter } from '../core/catalog'
import { estimateCarat } from '../core/stones'
import { Segmented, Section, Slider, Stat } from './controls'

export function StonePanel({ warnings }: { warnings: string[] }): JSX.Element {
  const stone = useStore((s) => s.design.stone)
  const band = useStore((s) => s.design.band)
  const patchStone = useStore((s) => s.patchStone)
  const hasStone = stone.count > 0
  const circumference = 2 * Math.PI * (ksToInnerDiameter(band.sizeKR) / 2)
  const footprint = stone.sizeMm * (stone.shape === 'oval' ? 1.4 : 1)

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

      <Section title="모양 · 세팅">
        <Segmented
          label="스톤 모양"
          value={stone.shape}
          options={STONE_SHAPES.map((s) => ({ value: s.id, label: s.label }))}
          onChange={(v) => patchStone({ shape: v }, 'stone:shape')}
        />
        <Segmented
          label="세팅 방식"
          value={stone.setting}
          options={SETTINGS.map((s) => ({ value: s.id, label: s.label }))}
          hint={
            stone.setting === 'bezel'
              ? '베젤: 스톤 둘레를 금속 테로 감쌉니다. 프롱보다 안전하지만 스톤이 작아 보입니다.'
              : '프롱: 금속 다리로 스톤을 잡습니다. 빛이 잘 들어가 반짝임이 좋습니다.'
          }
          onChange={(v) => patchStone({ setting: v }, 'stone:setting')}
        />
        {stone.setting !== 'bezel' ? (
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
          <Stat label="세팅" value={stone.setting === 'bezel' ? '베젤' : '프롱'} />
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
