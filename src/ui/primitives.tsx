/** Small shared interface primitives. */

import type { ReactNode } from 'react';
import { sound } from '@/audio/sound';

export function Panel({
  title,
  actions,
  children,
  style,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  style?: React.CSSProperties;
}): JSX.Element {
  return (
    <section className="panel" style={style}>
      <header className="panel-head">
        <span className="panel-title">{title}</span>
        {actions}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  active,
  accent,
  small,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  accent?: 'gold' | 'red';
  small?: boolean;
  title?: string;
}): JSX.Element {
  const classes = [
    'btn',
    active ? 'is-active' : '',
    accent ? `accent-${accent}` : '',
    small ? 'small' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      disabled={disabled}
      title={title}
      onClick={() => {
        // Any click is a valid user gesture, which is also what unlocks audio.
        void sound.ensureContext();
        sound.play('ui_click');
        onClick?.();
      }}
    >
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}): JSX.Element {
  return (
    <div className="field-row">
      <span className="field-label">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`toggle${checked ? ' is-on' : ''}`}
        onClick={() => {
          void sound.ensureContext();
          onChange(!checked);
        }}
      />
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}): JSX.Element {
  return (
    <div className="field-row">
      <span className="field-label">{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="range"
          value={value}
          min={min}
          max={max}
          step={step}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--text-dim)',
            minWidth: 34,
            textAlign: 'right',
          }}
        >
          {format ? format(value) : value.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}): JSX.Element {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}): JSX.Element {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function StatusChip({
  color,
  children,
}: {
  color: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <span className="status-chip" style={{ color }}>
      <span className="status-dot" />
      {children}
    </span>
  );
}

export function Stat({ value, label }: { value: string | number; label: string }): JSX.Element {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

/** Convert a packed 0xRRGGBB colour to a CSS string. */
export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
