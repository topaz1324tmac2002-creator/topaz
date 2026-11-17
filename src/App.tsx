import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, type TabId } from './store'
import { METALS, stoneShape } from './core/catalog'
import { weightGrams } from './core/measure'
import { RingViewer, type ViewerApi } from './viewer/RingViewer'
import type { SceneMetrics } from './viewer/RingScene'
import { BandPanel } from './components/BandPanel'
import { StonePanel } from './components/StonePanel'
import { EngravePanel } from './components/EngravePanel'
import { MaterialPanel } from './components/MaterialPanel'
import { ExportPanel } from './components/ExportPanel'

const TABS: { id: TabId; label: string }[] = [
  { id: 'band', label: '밴드' },
  { id: 'stone', label: '스톤' },
  { id: 'engrave', label: '각인' },
  { id: 'material', label: '재질' },
  { id: 'export', label: 'STL' },
]

function useIsWide(): boolean {
  const [wide, setWide] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 1024))
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = (): void => setWide(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return wide
}

export default function App(): JSX.Element {
  const design = useStore((s) => s.design)
  const tab = useStore((s) => s.tab)
  const setTab = useStore((s) => s.setTab)
  const highQuality = useStore((s) => s.highQuality)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const canUndo = useStore((s) => s.undoStack.length > 0)
  const canRedo = useStore((s) => s.redoStack.length > 0)
  const toast = useStore((s) => s.toast)
  const showToast = useStore((s) => s.showToast)

  const [metrics, setMetrics] = useState<SceneMetrics | null>(null)
  const apiRef = useRef<ViewerApi | null>(null)
  const isWide = useIsWide()

  const metal = METALS[design.metal]
  const grams = weightGrams(metrics?.measure.metalVolumeCm3 ?? 0, metal)
  const shapeLabel = stoneShape(design.stone.shape).label
  const leftTabs = useMemo(() => TABS, [])
  const activeLeft = leftTabs.some((t) => t.id === tab) ? tab : 'band'

  const panelFor = (id: TabId): JSX.Element => {
    switch (id) {
      case 'band':
        return <BandPanel />
      case 'stone':
        return <StonePanel warnings={metrics?.warnings ?? []} />
      case 'engrave':
        return <EngravePanel />
      case 'material':
        return <MaterialPanel />
      case 'export':
      default:
        return <ExportPanel metrics={metrics} onExportSTL={(includeGems) => apiRef.current?.exportSTL(includeGems)} />
    }
  }

  const leftTabStrip = (
    <div className="tabstrip">
      {leftTabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={activeLeft === t.id ? 'tab is-active' : 'tab'}
          onClick={() => setTab(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ◎
          </span>
          <div className="brand-text">
            <strong>김영훈의 주얼리 스튜디오</strong>
            <small>RingStudio · 디자인 → 검증 → STL</small>
          </div>
        </div>

        <div className="summary">
          <span className="chip">KS {design.band.sizeKR}호</span>
          <span className="chip">{design.band.widthMm.toFixed(1)}mm</span>
          <span className="chip">{metal.short}</span>
          {design.stone.count > 0 ? (
            <span className="chip">
              {shapeLabel} × {design.stone.count}
            </span>
          ) : null}
          <span className="chip strong">{grams.toFixed(2)}g</span>
        </div>

        <div className="topbar-actions">
          <button type="button" className="btn ghost" onClick={undo} disabled={!canUndo} title="실행 취소">
            ↶ <span className="btn-text">실행취소</span>
          </button>
          <button type="button" className="btn ghost" onClick={redo} disabled={!canRedo} title="다시 실행">
            ↷ <span className="btn-text">다시</span>
          </button>
        </div>
      </header>

      <main className="stage">
        <section className="viewport-wrap">
          <RingViewer
            design={design}
            highQuality={highQuality}
            onMetrics={setMetrics}
            onNotice={showToast}
            apiRef={apiRef}
          />

          <div className="view-buttons">
            <button
              type="button"
              className="btn ghost"
              onClick={() => apiRef.current?.setView('front')}
              title="정면에서 보기"
            >
              앞
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => apiRef.current?.setView('right')}
              title="밴드 폭과 단면이 보이는 우측에서 보기"
            >
              우측
            </button>
            {design.engraving.enabled ? (
              <button
                type="button"
                className="btn ghost"
                onClick={() => apiRef.current?.setView('engrave')}
                title="각인을 읽을 수 있는 방향에서 보기"
              >
                각인
              </button>
            ) : null}
          </div>

          <div className="viewport-foot">
            <span>V {metrics?.measure.metalVolumeCm3.toFixed(3) ?? '0.000'} cm³</span>
            <span>
              {metal.name} {grams.toFixed(2)} g
            </span>
            <span>{metrics?.measure.allWatertight ? '수밀 ✓' : '수밀 확인 필요'}</span>
            <span>삼각형 {(metrics?.triangles ?? 0).toLocaleString('ko-KR')}</span>
          </div>
        </section>

        {isWide ? (
          <aside className="panel panel-left">
            {leftTabStrip}
            <div className="panel-scroll">{panelFor(activeLeft)}</div>
          </aside>
        ) : (
          <section className="sheet">
            <div className="tabstrip sheet-tabs">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={tab === t.id ? 'tab is-active' : 'tab'}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="sheet-scroll">{panelFor(tab)}</div>
          </section>
        )}
      </main>

      {toast ? (
        <div className={`toast ${toast.kind}`} role="status">
          {toast.text}
        </div>
      ) : null}
    </div>
  )
}
