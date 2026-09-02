/**
 * Settings.
 *
 * Everything here writes into the campus document, which autosaves and
 * survives a restart. Nothing is hard-coded in the renderer — each control
 * maps to a field the campus configuration already carries.
 */

import { useRef, useState } from 'react';
import { useCampus } from '@/state/store';
import { engine } from '@/state/engine';
import { THEMES } from '@/config/themes';
import { normalizeCampus } from '@/config/schema';
import { APP_VERSION } from '@/design/tokens';
import { Panel, Toggle, Slider, Select, Button, TextField } from './primitives';
import type { AiProvider, CampusDocument, TimeOfDay, WeatherKind } from '@/core/types';

const PROVIDER_LABEL: Record<AiProvider, string> = {
  offline: 'Offline Simulation (free, default)',
  local: 'Local Model — not yet connected',
  ollama: 'Ollama — not yet connected',
  custom: 'Custom Provider — not yet connected',
};

export function SettingsPanel(): JSX.Element | null {
  const doc = useCampus((s) => s.doc);
  const patch = useCampus((s) => s.patchSettings);
  const setDoc = useCampus((s) => s.setDoc);
  const backend = useCampus((s) => s.storageBackend);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    doc: CampusDocument;
    repairs: string[];
    name: string;
  } | null>(null);
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
        label="Weather (Clear disables all weather effects)"
        value={s.weather}
        options={[
          { value: 'clear', label: 'Clear — weather effects off' },
          { value: 'rain', label: 'Light rain' },
          { value: 'fog', label: 'Fog' },
          { value: 'snow', label: 'Snow' },
        ]}
        onChange={(v) => patch({ weather: v })}
      />

      <Divider label="AI Provider" />
      <Select<AiProvider>
        label="Agent intelligence"
        value={s.aiProvider}
        options={(['offline', 'local', 'ollama', 'custom'] as AiProvider[]).map((p) => ({
          value: p,
          label: PROVIDER_LABEL[p],
        }))}
        onChange={(v) => patch({ aiProvider: v })}
      />
      {s.aiProvider === 'offline' ? (
        <p className="empty" style={{ textAlign: 'left', padding: '0 0 10px' }}>
          The campus is operating locally. All agents are simulated, no paid AI provider is
          connected, and no API charges are being created. Nothing to configure.
        </p>
      ) : (
        <p
          className="empty"
          style={{ textAlign: 'left', padding: '8px 10px', border: '1px solid rgba(216,146,46,0.4)', borderRadius: 3, color: 'var(--amber)' }}
        >
          Provider connections ship in a later phase — this stores your preference only. The
          campus continues running the free offline simulation. Nothing has been activated, no
          API key has been requested, and no billing exists. When hosted providers (e.g. Claude)
          are connected later, they can create usage charges and will warn you first; keys will
          be stored in the macOS Keychain, never in files.
        </p>
      )}

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
      <Toggle label="Idle agent wandering" checked={s.idleMovement} onChange={(v) => patch({ idleMovement: v })} />
      <Toggle
        label="Simulated work when idle"
        checked={s.ambientTaskSimulation}
        onChange={(v) => patch({ ambientTaskSimulation: v })}
      />
      <p className="empty" style={{ textAlign: 'left', padding: '0 0 10px' }}>
        Keeps the campus moving between missions. It already stops on its own
        while a mission is running — turn it off and the campus only ever shows
        real work.
      </p>
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
        Storage backend: <code>{backend}</code>. Changes save automatically, and the desktop app
        keeps the last 20 revisions of the campus inside its local database as automatic backups.
      </p>
      <div className="btn-row" style={{ marginBottom: 8 }}>
        <Button onClick={() => void engine.flush()}>Save Now</Button>
        <Button onClick={() => exportCampus(doc)}>Export Data</Button>
        <Button onClick={() => fileInput.current?.click()}>Import Data</Button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          void file.text().then((text) => {
            try {
              const { doc: incoming, repairs } = normalizeCampus(JSON.parse(text));
              setPendingImport({ doc: incoming, repairs, name: file.name });
            } catch {
              setPendingImport(null);
              useCampus.getState().pushLog({
                severity: 'error',
                text: `Import failed — ${file.name} is not readable campus JSON.`,
              });
            }
          });
        }}
      />
      {pendingImport && (
        <div
          style={{ border: '1px solid rgba(216,146,46,0.45)', borderRadius: 3, padding: 10, marginBottom: 10 }}
        >
          <p className="empty" style={{ textAlign: 'left', padding: '0 0 8px', color: 'var(--amber)' }}>
            Importing “{pendingImport.name}” will replace your current campus — buildings, agents
            and settings. Your current data will be overwritten (the desktop app keeps prior
            revisions in its database).
            {pendingImport.repairs.length > 0 &&
              ` ${pendingImport.repairs.length} item(s) in the file were repaired on load.`}
          </p>
          <div className="btn-row">
            <Button
              accent="gold"
              onClick={() => {
                setDoc(pendingImport.doc);
                useCampus.getState().pushLog({
                  severity: 'good',
                  text: `Campus imported from ${pendingImport.name}.`,
                });
                setPendingImport(null);
              }}
            >
              Replace Campus
            </Button>
            <Button onClick={() => setPendingImport(null)}>Cancel</Button>
          </div>
        </div>
      )}
      <div className="btn-row">
        <Button accent="red" onClick={() => void engine.resetCampus()}>
          Reset Campus
        </Button>
      </div>

      <Divider label="Diagnostics" />
      <DiagnosticsSection />
    </Panel>
  );
}

/** Serialise the campus to a portable JSON file (with a clipboard fallback). */
function exportCampus(doc: CampusDocument): void {
  const json = JSON.stringify(doc, null, 2);
  const name = `${doc.campusName.replace(/\W+/g, '-').toLowerCase() || 'campus'}-export.json`;
  try {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    useCampus.getState().pushLog({ severity: 'good', text: `Campus exported as ${name}.` });
  } catch {
    // Some webviews block programmatic downloads; the clipboard still works.
    void navigator.clipboard?.writeText(json);
    useCampus.getState().pushLog({
      severity: 'warn',
      text: 'Download blocked by the webview — the campus JSON was copied to the clipboard instead.',
    });
  }
}

function DiagnosticsSection(): JSX.Element {
  const mode = useCampus((s) => s.mode);
  const backend = useCampus((s) => s.storageBackend);
  const loadError = useCampus((s) => s.loadError);
  const dbDegraded = useCampus((s) => s.dbDegraded);
  const ready = useCampus((s) => s.ready);
  const stats = useCampus((s) => s.stats);
  const doc = useCampus((s) => s.doc);
  const log = useCampus((s) => s.log);
  const [copied, setCopied] = useState(false);

  const recentIssues = log.filter((l) => l.severity === 'error' || l.severity === 'warn').slice(-5);
  const rendererStatus = loadError ? 'failed' : stats.fps > 0 ? 'running' : 'starting';

  const report = [
    `Obsidian Campus diagnostics`,
    `Version:        ${APP_VERSION}`,
    `Platform:       ${navigator.platform || 'unknown'} · ${navigator.userAgent}`,
    `Mode:           ${mode}`,
    `AI provider:    ${doc?.settings.aiProvider ?? 'offline'} (simulated, no charges)`,
    `Database:       ${backend}${dbDegraded ? ' — DEGRADED (in-memory fallback, changes not persisted)' : ' — ok'}`,
    `Renderer:       ${rendererStatus} · ${stats.fps} fps · assets generated at runtime`,
    `Last startup:   ${ready ? (loadError ? `degraded — ${loadError}` : 'ok') : 'incomplete'}`,
    `Recent issues:  ${recentIssues.length === 0 ? 'none' : ''}`,
    ...recentIssues.map((l) => `  [${l.severity}] ${l.at} ${l.text}`),
  ].join('\n');

  const copy = (): void => {
    const done = (): void => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(report).then(done);
    } else {
      const ta = document.createElement('textarea');
      ta.value = report;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      done();
    }
  };

  return (
    <div>
      <dl className="kv">
        <dt>Version</dt>
        <dd>{APP_VERSION}</dd>
        <dt>Mode</dt>
        <dd>{mode}</dd>
        <dt>Provider</dt>
        <dd>{doc?.settings.aiProvider ?? 'offline'} · simulated</dd>
        <dt>Database</dt>
        <dd>{backend}{dbDegraded ? ' · degraded' : ' · ok'}</dd>
        <dt>Renderer</dt>
        <dd>{rendererStatus} · {stats.fps} fps</dd>
        <dt>Startup</dt>
        <dd>{ready ? (loadError ? 'degraded' : 'ok') : 'incomplete'}</dd>
        <dt>Issues</dt>
        <dd>{recentIssues.length === 0 ? 'none recent' : `${recentIssues.length} recent`}</dd>
      </dl>
      <Button small onClick={copy}>{copied ? 'Copied' : 'Copy Diagnostics'}</Button>
    </div>
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
