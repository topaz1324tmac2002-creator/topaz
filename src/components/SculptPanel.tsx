import { useStore } from '../store'
import { Segmented, Section, Slider } from './controls'

export function SculptPanel(): JSX.Element {
  const sculptMode = useStore((s) => s.sculptMode)
  const setSculptMode = useStore((s) => s.setSculptMode)
  const brushRadiusMm = useStore((s) => s.brushRadiusMm)
  const brushStrength = useStore((s) => s.brushStrength)
  const setBrush = useStore((s) => s.setBrush)
  const requestSculptAction = useStore((s) => s.requestSculptAction)

  const on = sculptMode !== 'off'

  return (
    <div className="stack">
      <Section
        title="자유 조형"
        aside={<span className={`badge ${on ? 'good' : 'soft'}`}>{on ? '조형 중' : '꺼짐'}</span>}
      >
        <button type="button" className={`btn ${on ? 'ghost' : 'primary'} block`} onClick={() => setSculptMode(on ? 'off' : 'push')}>
          {on ? '조형 종료' : '✎ 조형 시작'}
        </button>
        <p className="field-hint">
          조형을 켜면 3D 뷰에서 한 손가락(마우스)이 브러시가 됩니다. 표면을 문질러 밀고 당기면 실제 메쉬가 변형되고,
          중량과 수밀 검사가 즉시 다시 계산됩니다.
        </p>
      </Section>

      {on ? (
        <Section title="브러시">
          <Segmented
            value={sculptMode}
            options={[
              { value: 'push', label: '밀기' },
              { value: 'pull', label: '당기기' },
              { value: 'smooth', label: '스무스' },
            ]}
            onChange={(v) => setSculptMode(v)}
          />
          <Slider
            label="브러시 반경"
            value={brushRadiusMm}
            min={0.6}
            max={6}
            step={0.1}
            unit="mm"
            onChange={(v) => setBrush({ radiusMm: v })}
          />
          <Slider
            label="강도"
            value={brushStrength * 100}
            min={5}
            max={100}
            step={5}
            unit="%"
            decimals={0}
            onChange={(v) => setBrush({ strength: v / 100 })}
          />
        </Section>
      ) : null}

      <Section title="되돌리기" aside={<span className="badge soft">조형 20단계</span>}>
        <div className="btn-row">
          <button type="button" className="btn ghost" onClick={() => requestSculptAction('undo')}>
            조형 되돌리기
          </button>
          <button type="button" className="btn ghost" onClick={() => requestSculptAction('reset')}>
            조형 초기화
          </button>
        </div>
        <p className="field-hint">파라미터(호수·폭·두께)를 바꾸면 조형이 초기화됩니다.</p>
      </Section>
    </div>
  )
}
