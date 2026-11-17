import { useStore } from '../store'
import { Segmented, Section, Slider, Toggle } from './controls'

const MAX_LEN = 20

export function EngravePanel(): JSX.Element {
  const engraving = useStore((s) => s.design.engraving)
  const patch = useStore((s) => s.patchEngraving)

  return (
    <div className="stack">
      <Section title="각인" aside={<span className="badge">{engraving.text.length}/{MAX_LEN}자</span>}>
        <Toggle
          label="각인 사용"
          checked={engraving.enabled}
          hint="스톤 반대편(6시 방향)에 새깁니다. 미리보기는 표면에서 0.06mm 띄운 음각 패치로 그려 확대·축소 어디서나 보입니다. 실물 각인 형상은 V1.1에서 차집합으로 생성합니다."
          onChange={(v) => patch({ enabled: v }, 'engrave:enabled')}
        />
        <div className="field">
          <div className="field-head">
            <label htmlFor="engrave-text">문자</label>
          </div>
          <input
            id="engrave-text"
            className="text-input"
            type="text"
            inputMode="text"
            maxLength={MAX_LEN}
            value={engraving.text}
            placeholder="예: 2026 KIM"
            onChange={(e) => patch({ text: e.target.value.slice(0, MAX_LEN) }, 'engrave:text')}
          />
          <p className="field-hint">영문·숫자·한글 모두 가능합니다(시스템 폰트 사용). 20자를 넘으면 축소됩니다.</p>
        </div>
        <Segmented
          label="위치"
          value={engraving.position}
          options={[
            { value: 'inner', label: '안쪽' },
            { value: 'outer', label: '바깥' },
          ]}
          onChange={(v) => patch({ position: v }, 'engrave:position')}
        />
        <Slider
          label="문자 높이"
          value={engraving.heightMm}
          min={0.8}
          max={2.5}
          step={0.1}
          unit="mm"
          hint="밴드 폭의 70%를 넘으면 글자가 밴드 밖으로 나갑니다."
          onChange={(v) => patch({ heightMm: v }, 'engrave:height')}
        />
      </Section>
      <Section title="안내">
        <ul className="bullets">
          <li>각인은 밴드 곡면을 따라 휘어지도록 투영되며, 안쪽·바깥 모두 표면에 정확히 붙습니다.</li>
          <li>안쪽 각인은 반지 구멍을 통해 보입니다. 뷰포트를 돌려 확인하세요.</li>
          <li>주물 후 각인 깊이는 0.15~0.5mm가 안전합니다.</li>
        </ul>
      </Section>
    </div>
  )
}
