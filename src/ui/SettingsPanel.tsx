/**
 * Settings.
 *
 * Everything here writes into the campus document, which autosaves and
 * survives a restart. Nothing is hard-coded in the renderer — each control
 * maps to a field the campus configuration already carries.
 */

import { useCampus } from '@/state/store';
import { engine } from '@/state/engine';
import { THEMES } from '@/config/themes';
import { Panel, Toggle, Slider, Select, Button, TextField } from './primitives';
import type { TimeOfDay, WeatherKind } from '@/core/types';

export function SettingsPanel(): JSX.Element | null {
  const doc = useCampus((s) => s.doc);
  const patch = useCampus((s) => s.patchSettings);
  const setDoc = useCampus((s) => s.setDoc);
  const backend = useCampus((s) => s.storageBackend);
  if (!doc) return null;

  const s = doc.settings;

  return (
    <Panel title="Campus Settings">
      <TextField
        label="Campus Name"
        value={doc.campusName}
        onChange={(v) => setDoc({ ...doc, campusName: v })}
      />

      <Select<TimeOfDay>
        label="Lighting"
        value={s.timeOfDay}
        options={[
          { value: 'night', label: 'Night (primary)' },
          { value: 'day', label: 'Day' },
          { value: 'auto', label: 'Automatic by clock' },
        ]}
        onChange={(v) => patch({ timeOfDay: v })}
      />

      <Select
        label="Theme"
        value={doc.themeId}
        options={Object.values(THEMES).map((t) => ({ value: t.id, label: t.name }))}
        onChange={(v) => setDoc({ ...doc, themeId: v })}
      />

      <Select<WeatherKind>
        label="Weather"
        value={s.weather}
        options={[
          { value: 'clear', label: 'Clear' },
          { value: 'rain', label: 'Light rain' },
          { value: 'fog', label: 'Fog' },
          { value: 'snow', label: 'Snow' },
        ]}
        onChange={(v) => patch({ weather: v })}
      />

      <Divider label="Visibility" />
      <Toggle label="Agent name labels" checked={s.showAgentLabels} onChange={(v) => patch({ showAgentLabels: v })} />
      <Toggle label="Status tags" checked={s.showStatusTags} onChange={(v) => patch({ showStatusTags: v })} />
      <Toggle label="Activity trails" checked={s.showActivityTrails} onChange={(v) => patch({ showActivityTrails: v })} />
      <Toggle label="Task packets" checked={s.showTaskPackets} onChange={(v) => patch({ showTaskPackets: v })} />
      <Toggle label="Navigation grid" checked={s.showGrid} onChange={(v) => patch({ showGrid: v })} />

      <Divider label="Motion" />
      <Slider
        label="Animation speed"
        value={s.animationSpeed}
        min={0.25}
        max={3}
        step={0.05}
        format={(v) => `${v.toFixed(2)}×`}
        onChange={(v) => patch({ animationSpeed: v })}
      />
      <Toggle label="Ambient campus activity" checked={s.ambientActivity} onChange={(v) => patch({ ambientActivity: v })} />
      <Toggle label="Reduced motion" checked={s.reducedMotion} onChange={(v) => patch({ reducedMotion: v })} />
      <Toggle label="Teleport for long trips" checked={s.allowTeleport} onChange={(v) => patch({ allowTeleport: v })} />

      <Divider label="Performance" />
      <Select
        label="Rendering mode"
        value={s.performanceMode}
        options={[
          { value: 'high', label: 'High fidelity' },
          { value: 'balanced', label: 'Balanced' },
          { value: 'efficient', label: 'Efficient (30 fps cap)' },
        ]}
        onChange={(v) => patch({ performanceMode: v as typeof s.performanceMode })}
      />
      <p className="empty" style={{ textAlign: 'left', padding: '0 0 10px' }}>
        Rendering resolution is applied on the next launch.
      </p>

      <Divider label="Sound" />
      <Toggle label="Sound effects" checked={s.soundEnabled} onChange={(v) => patch({ soundEnabled: v })} />
      <Slider
        label="Volume"
        value={s.soundVolume}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => patch({ soundVolume: v })}
      />

      <Divider label="Simulation" />
      <Toggle
        label="Auto-resolve stale approvals"
        checked={s.autoResolveApprovals}
        onChange={(v) => patch({ autoResolveApprovals: v })}
      />

      <Divider label="Data" />
      <p className="empty" style={{ textAlign: 'left', padding: '0 0 10px' }}>
        Storage backend: <code>{backend}</code>. Changes save automatically.
      </p>
      <div className="btn-row">
        <Button accent="red" onClick={() => void engine.resetCampus()}>
          Reset Campus
        </Button>
        <Button onClick={() => void engine.flush()}>Save Now</Button>
      </div>
    </Panel>
  );
}

function Divider({ label }: { label: string }): JSX.Element {
  return (
    <div
      style={{
        marginTop: 14,
        marginBottom: 6,
        paddingTop: 10,
        borderTop: '1px solid var(--line)',
        fontSize: 9,
        letterSpacing: '1.4px',
        textTransform: 'uppercase',
        color: 'var(--text-faint)',
      }}
    >
      {label}
    </div>
  );
}
