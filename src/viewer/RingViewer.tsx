import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { RingScene, type SceneMetrics } from './RingScene'
import { useStore } from '../store'
import type { Design, SculptMode } from '../core/types'
import { downloadBlob } from '../utils/download'

export interface ViewerApi {
  exportSTL: (includeGems: boolean) => void
}

interface Props {
  design: Design
  sculptMode: SculptMode
  brushRadius: number
  brushStrength: number
  highQuality: boolean
  onMetrics: (m: SceneMetrics) => void
  onNotice: (text: string, kind?: 'info' | 'warn' | 'error' | 'ok') => void
  apiRef: MutableRefObject<ViewerApi | null>
  sculptAction: { type: 'undo' | 'reset'; seq: number } | null
}

export function RingViewer({
  design,
  sculptMode,
  brushRadius,
  brushStrength,
  highQuality,
  onMetrics,
  onNotice,
  apiRef,
  sculptAction,
}: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<RingScene | null>(null)
  const initialDesign = useRef(design)
  const metricsCb = useRef(onMetrics)
  const noticeCb = useRef(onNotice)
  metricsCb.current = onMetrics
  noticeCb.current = onNotice

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let scene: RingScene | null = null
    try {
      scene = new RingScene(host, initialDesign.current, {
        onMetrics: (m) => metricsCb.current(m),
        onError: (msg) => noticeCb.current(msg, 'error'),
        onAutoQuality: (ms) => {
          useStore.getState().setHighQuality(false)
          noticeCb.current(`프레임이 느립니다(${ms}ms). 보석 투과광을 자동으로 껐습니다 — 재질 탭에서 다시 켤 수 있습니다.`, 'warn')
        },
      })
      sceneRef.current = scene
      apiRef.current = {
        exportSTL: (includeGems: boolean) => {
          try {
            const { blob, name, triangles } = scene!.exportSTL(includeGems)
            downloadBlob(blob, name)
            noticeCb.current(`STL 저장 완료 · ${name} (${triangles.toLocaleString('ko-KR')} 삼각형)`, 'ok')
          } catch (err) {
            noticeCb.current(err instanceof Error ? err.message : 'STL 내보내기에 실패했습니다.', 'error')
          }
        },
      }
    } catch (err) {
      noticeCb.current(
        err instanceof Error
          ? `3D 뷰를 초기화하지 못했습니다: ${err.message}`
          : '3D 뷰를 초기화하지 못했습니다. WebGL을 지원하는 브라우저인지 확인해 주세요.',
        'error',
      )
    }
    return () => {
      apiRef.current = null
      sceneRef.current = null
      scene?.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    sceneRef.current?.updateDesign(design)
  }, [design])

  useEffect(() => {
    sceneRef.current?.setSculptMode(sculptMode)
  }, [sculptMode])

  useEffect(() => {
    sceneRef.current?.setBrush(brushRadius, brushStrength)
  }, [brushRadius, brushStrength])

  useEffect(() => {
    sceneRef.current?.setHighQuality(highQuality)
  }, [highQuality])

  useEffect(() => {
    if (!sculptAction) return
    if (sculptAction.type === 'undo') sceneRef.current?.undoSculpt()
    else sceneRef.current?.resetSculpted()
  }, [sculptAction])

  return (
    <div
      ref={hostRef}
      className={`viewport${sculptMode !== 'off' ? ' is-sculpting' : ''}`}
      aria-label="3D 반지 뷰포트"
    />
  )
}
