import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { RingScene, type SceneMetrics } from './RingScene'
import type { Design, SculptMode } from '../core/types'
import { downloadBlob, downloadDataUrl, formatDateStamp } from '../utils/download'

export interface ViewerApi {
  exportSTL: (includeGems: boolean) => void
  capturePNG: () => void
  record: (seconds: number) => Promise<void>
  resetSculpt: () => void
  undoSculpt: () => void
}

interface Props {
  design: Design
  sculptMode: SculptMode
  brushRadius: number
  brushStrength: number
  turntable: boolean
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
  turntable,
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
        capturePNG: () => {
          try {
            const url = scene!.capturePNG()
            downloadDataUrl(url, `ringstudio_${formatDateStamp()}.png`)
            noticeCb.current('이미지를 저장했습니다.', 'ok')
          } catch (err) {
            noticeCb.current(err instanceof Error ? err.message : '이미지 저장에 실패했습니다.', 'error')
          }
        },
        record: async (seconds: number) => {
          try {
            noticeCb.current('턴테이블을 녹화하는 중입니다…', 'info')
            const { blob, ext } = await scene!.recordTurntable(seconds)
            downloadBlob(blob, `ringstudio_turntable_${formatDateStamp()}.${ext}`)
            noticeCb.current(`영상 저장 완료 (${seconds}초 · ${ext.toUpperCase()})`, 'ok')
          } catch (err) {
            noticeCb.current(err instanceof Error ? err.message : '녹화에 실패했습니다.', 'error')
          }
        },
        resetSculpt: () => {
          try {
            scene!.resetSculpted()
            noticeCb.current('조형을 초기화했습니다.', 'info')
          } catch {
            /* noop */
          }
        },
        undoSculpt: () => {
          try {
            if (!scene!.undoSculpt()) noticeCb.current('되돌릴 조형이 없습니다.', 'warn')
          } catch {
            /* noop */
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
    sceneRef.current?.setTurntable(turntable)
  }, [turntable])

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
