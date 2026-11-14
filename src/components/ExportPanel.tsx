import { useStore } from '../store'
import { METALS } from '../core/catalog'
import { parametricChecks, weightGrams } from '../core/measure'
import type { SceneMetrics } from '../viewer/RingScene'
import type { MetalId } from '../core/types'
import { Section, Stat } from './controls'

interface Props {
  metrics: SceneMetrics | null
  onExportSTL: (includeGems: boolean) => void
  onCapturePNG: () => void
}

const SHOWCASE: MetalId[] = ['gold18k', 'silver925', 'rose18k']

export function ExportPanel({ metrics, onExportSTL, onCapturePNG }: Props): JSX.Element {
  const design = useStore((s) => s.design)
  const volume = metrics?.measure.metalVolumeCm3 ?? 0
  const metal = METALS[design.metal]
  const grams = weightGrams(volume, metal)

  const checks = parametricChecks({
    thicknessMm: design.band.thicknessMm,
    widthMm: design.band.widthMm,
    stoneSizeMm: design.stone.count > 0 ? design.stone.sizeMm : 0,
    stoneCount: design.stone.count,
    engravingOn: design.engraving.enabled,
    engravingHeightMm: design.engraving.heightMm,
    sculpted: metrics?.sculpted ?? false,
    measure: metrics?.measure ?? null,
  })
  const blocked = checks.some((c) => c.level === 'fail')

  return (
    <div className="stack">
      <Section
        title="출력 준비"
        aside={
          <span className={`badge ${blocked ? 'bad' : 'good'}`}>
            {blocked ? '검증 실패' : '출력 가능'}
          </span>
        }
      >
        <div className="weight-hero">
          <div className="weight-main">
            <span className="weight-value">{grams.toFixed(2)}</span>
            <span className="weight-unit">g</span>
          </div>
          <div className="weight-sub">
            {metal.name} · {volume.toFixed(3)} cm³
            <br />
            <small>주물 수축 {(metal.shrink * 100).toFixed(1)}% 보정 포함</small>
          </div>
        </div>
        <div className="weight-row">
          {SHOWCASE.map((id) => (
            <div key={id} className={`weight-chip${id === design.metal ? ' is-active' : ''}`}>
              <span>{METALS[id].short}</span>
              <strong>{weightGrams(volume, METALS[id]).toFixed(2)}g</strong>
            </div>
          ))}
        </div>
      </Section>

      <Section title="검사 결과">
        <div className="stats-grid">
          <Stat label="체적" value={volume.toFixed(3)} unit="cm³" />
          <Stat label="삼각형" value={(metrics?.triangles ?? 0).toLocaleString('ko-KR')} unit="개" />
          <Stat label="열린 엣지" value={String(metrics?.measure.openEdges ?? 0)} unit="개" />
          <Stat label="보석" value={String(metrics?.measure.gemCount ?? 0)} unit="개" />
        </div>
        <ul className="checks">
          {checks.map((c) => (
            <li key={c.title} className={`check ${c.level}`}>
              <span className="check-icon">{c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '×'}</span>
              <div>
                <strong>{c.title}</strong>
                <p>{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
        {metrics?.warnings.map((w) => (
          <p key={w} className="field-hint warn-text">
            ⚠ {w}
          </p>
        ))}
      </Section>

      <Section title="내보내기">
        <button type="button" className="btn primary block" onClick={() => onExportSTL(false)}>
          STL 다운로드 (바이너리 · mm)
        </button>
        <p className="field-hint">
          밴드 + 세팅 금속부를 하나의 STL로 저장합니다. 보석은 주물 형상에 포함되지 않습니다.
        </p>
        <div className="btn-row">
          <button type="button" className="btn ghost" onClick={() => onExportSTL(true)}>
            보석 포함 STL
          </button>
          <button type="button" className="btn ghost" onClick={onCapturePNG}>
            뷰 PNG 저장
          </button>
        </div>
        <p className="field-hint">
          파일명 예: ring_KS{design.band.sizeKR}_{design.band.profile}_w{design.band.widthMm.toFixed(1)}_t
          {design.band.thicknessMm.toFixed(1)}_v1.stl · 슬라이서에서 mm 단위로 열립니다(Z-up).
        </p>
      </Section>
    </div>
  )
}
