import type { ReactNode } from 'react'

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  decimals?: number
  hint?: string
  disabled?: boolean
  onChange: (v: number) => void
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  decimals,
  hint,
  disabled,
  onChange,
}: SliderProps): JSX.Element {
  const digits = decimals ?? (step < 0.1 ? 2 : step < 1 ? 1 : 0)
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className={`field${disabled ? ' is-disabled' : ''}`}>
      <div className="field-head">
        <label>{label}</label>
        <span className="field-value">
          {value.toFixed(digits)}
          {unit ? <em>{unit}</em> : null}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        style={{ ['--pct' as string]: `${Math.max(0, Math.min(100, pct))}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  )
}

interface SegmentedProps<T extends string> {
  label?: string
  value: T
  options: { value: T; label: string }[]
  hint?: string
  onChange: (v: T) => void
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  hint,
  onChange,
}: SegmentedProps<T>): JSX.Element {
  return (
    <div className="field">
      {label ? (
        <div className="field-head">
          <label>{label}</label>
        </div>
      ) : null}
      <div className="segmented" role="group">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={o.value === value ? 'seg is-active' : 'seg'}
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  )
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  hint?: string
}): JSX.Element {
  return (
    <div className="field">
      <button type="button" className={`toggle${checked ? ' is-on' : ''}`} onClick={() => onChange(!checked)}>
        <span className="toggle-track">
          <span className="toggle-knob" />
        </span>
        <span className="toggle-label">{label}</span>
      </button>
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  )
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }): JSX.Element {
  return (
    <section className="section">
      <header className="section-head">
        <h3>{title}</h3>
        {aside}
      </header>
      <div className="section-body">{children}</div>
    </section>
  )
}

export function Stat({ label, value, unit }: { label: string; value: string; unit?: string }): JSX.Element {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {value}
        {unit ? <em>{unit}</em> : null}
      </span>
    </div>
  )
}
