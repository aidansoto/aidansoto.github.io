/**
 * Inspector: the detail view for whichever subject is selected.
 *
 * Answers the visibility requirement in full — current task, state, location,
 * active tool, progress and the last three actions — and doubles as the
 * configuration surface for renaming and reassignment.
 */

import { useMemo } from 'react';
import { useCampus } from '@/state/store';
import { engine } from '@/state/engine';
import { AGENT_VISUALS, BUILDING_VISUALS, TASK_STAGE_LABEL, suitFor } from '@/render/stateVisuals';
import { Panel, Button, TextField, Select, cssColor } from './primitives';
import type { AgentPresentation, BuildingStyle } from '@/core/types';

const STYLE_OPTIONS: Array<{ value: BuildingStyle; label: string }> = [
  { value: 'tower', label: 'Tower' },
  { value: 'slab', label: 'Horizontal Facility' },
  { value: 'lab', label: 'Glass Laboratory' },
  { value: 'bunker', label: 'Secure Bunker' },
  { value: 'vault', label: 'Vault Archive' },
  { value: 'studio', label: 'Open Studio' },
  { value: 'cylinder', label: 'Circular Drum' },
  { value: 'suite', label: 'Elevated Suite' },
  { value: 'hub', label: 'Transit Canopy' },
  { value: 'annex', label: 'Annex Block' },
];

export function Inspector(): JSX.Element | null {
  const selectedAgentId = useCampus((s) => s.selectedAgentId);
  const selectedBuildingId = useCampus((s) => s.selectedBuildingId);

  if (selectedAgentId) return <AgentInspector agentId={selectedAgentId} />;
  if (selectedBuildingId) return <BuildingInspector buildingId={selectedBuildingId} />;
  return null;
}

/* ------------------------------------------------------------------ */

function AgentInspector({ agentId }: { agentId: string }): JSX.Element | null {
  const doc = useCampus((s) => s.doc);
  const agents = useCampus((s) => s.agents);
  const tasks = useCampus((s) => s.tasks);
  const updateAgent = useCampus((s) => s.updateAgent);
  const selectAgent = useCampus((s) => s.selectAgent);

  const cfg = doc?.agents.find((a) => a.id === agentId);
  const rt = agents.find((a) => a.id === agentId);
  if (!doc || !cfg || !rt) return null;

  const vis = AGENT_VISUALS[rt.state];
  const task = rt.taskId ? tasks.find((t) => t.id === rt.taskId) : null;
  const building = rt.buildingId ? doc.buildings.find((b) => b.id === rt.buildingId) : null;
  const room = building?.rooms.find((r) => r.id === rt.locationId);
  const suit = suitFor(cfg.presentation, cfg.suitVariant);

  return (
    <Panel
      title="Agent Inspector"
      actions={
        <Button small onClick={() => selectAgent(null)}>
          Close
        </Button>
      }
    >
      <div className="inspector-head">
        <span className="status-dot" style={{ color: cssColor(vis.color), width: 10, height: 10 }} />
        <div style={{ minWidth: 0 }}>
          <div className="inspector-name">{cfg.name}</div>
          <div className="inspector-role">
            {cfg.role} · {vis.label}
          </div>
        </div>
      </div>

      <dl className="kv">
        <dt>State</dt>
        <dd style={{ color: cssColor(vis.color) }}>{vis.label}</dd>
        <dt>Location</dt>
        <dd>{building ? building.name : 'Campus grounds'}</dd>
        <dt>Room</dt>
        <dd>{room ? `${room.name} · L${room.level}` : '—'}</dd>
        <dt>Task</dt>
        <dd>{task ? task.label : '—'}</dd>
        <dt>Stage</dt>
        <dd>{task ? TASK_STAGE_LABEL[task.stage] : '—'}</dd>
        <dt>Tool</dt>
        <dd>{rt.tool ?? '—'}</dd>
        <dt>Transport</dt>
        <dd>{rt.transport ?? (rt.path.length > 0 ? 'walk' : 'stationary')}</dd>
        <dt>Position</dt>
        <dd>
          {rt.pos.x.toFixed(1)}, {rt.pos.y.toFixed(1)}
          {rt.elevation > 0.2 ? ` · +${rt.elevation.toFixed(0)}` : ''}
        </dd>
        <dt>Attire</dt>
        <dd>{suit.name}</dd>
      </dl>

      {rt.taskId && (
        <div className="field">
          <span className="field-label">Progress · {Math.round(rt.progress * 100)}%</span>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${rt.progress * 100}%` }} />
          </div>
        </div>
      )}

      {rt.trail.length > 0 && (
        <div className="field">
          <span className="field-label">Recent Actions</span>
          <ul className="trail">
            {[...rt.trail].reverse().map((t, i) => (
              <li key={`${t.at}-${i}`}>
                {new Date(t.at).toLocaleTimeString([], { hour12: false })} · {t.label}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="btn-row" style={{ marginBottom: 14 }}>
        <Button small onClick={() => engine.renderer?.focusAgent(cfg.id)}>
          Follow
        </Button>
        <Button
          small
          onClick={() =>
            engine.sim?.setAgentState(cfg.id, rt.state === 'paused' ? 'idle' : 'paused')
          }
        >
          {rt.state === 'paused' ? 'Resume Agent' : 'Pause Agent'}
        </Button>
        <Button
          small
          onClick={() =>
            engine.sim?.setAgentState(cfg.id, rt.state === 'offline' ? 'idle' : 'offline')
          }
        >
          {rt.state === 'offline' ? 'Bring Online' : 'Take Offline'}
        </Button>
      </div>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
        <TextField
          label="Name"
          value={cfg.name}
          onChange={(v) => updateAgent(cfg.id, { name: v })}
        />
        <TextField
          label="Role Label"
          value={cfg.role}
          placeholder="Assign later"
          onChange={(v) => updateAgent(cfg.id, { role: v })}
        />
        <Select<AgentPresentation>
          label="Dress Code"
          value={cfg.presentation}
          options={[
            { value: 'suit_black', label: 'Black suit · silver accents' },
            { value: 'suit_alt', label: 'Alternate formal palette' },
          ]}
          onChange={(v) => updateAgent(cfg.id, { presentation: v })}
        />
        {cfg.presentation === 'suit_alt' && (
          <Select
            label="Suit Palette"
            value={String(cfg.suitVariant)}
            options={[
              { value: '0', label: 'Deep Navy' },
              { value: '1', label: 'Charcoal Blue' },
              { value: '2', label: 'Graphite Blue' },
              { value: '3', label: 'Dark Emerald' },
            ]}
            onChange={(v) => updateAgent(cfg.id, { suitVariant: Number(v) })}
          />
        )}
        <Select
          label="Assigned Building"
          value={cfg.homeBuildingId}
          options={doc.buildings.map((b) => ({ value: b.id, label: b.name }))}
          onChange={(v) => {
            const target = doc.buildings.find((b) => b.id === v);
            updateAgent(cfg.id, {
              homeBuildingId: v,
              homeRoomId: target?.rooms[0]?.id ?? cfg.homeRoomId,
            });
          }}
        />
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

function BuildingInspector({ buildingId }: { buildingId: string }): JSX.Element | null {
  const doc = useCampus((s) => s.doc);
  const agents = useCampus((s) => s.agents);
  const buildingStatus = useCampus((s) => s.buildingStatus);
  const updateBuilding = useCampus((s) => s.updateBuilding);
  const selectBuilding = useCampus((s) => s.selectBuilding);

  const cfg = doc?.buildings.find((b) => b.id === buildingId);
  const occupants = useMemo(
    () => agents.filter((a) => a.buildingId === buildingId),
    [agents, buildingId],
  );
  if (!doc || !cfg) return null;

  const status = buildingStatus[buildingId] ?? 'normal';
  const vis = BUILDING_VISUALS[status];

  return (
    <Panel
      title="Site Inspector"
      actions={
        <Button small onClick={() => selectBuilding(null)}>
          Close
        </Button>
      }
    >
      <div className="inspector-head">
        <span
          className="status-dot"
          style={{ color: cssColor(vis.beacon ?? vis.glow), width: 10, height: 10 }}
        />
        <div style={{ minWidth: 0 }}>
          <div className="inspector-name">{cfg.name}</div>
          <div className="inspector-role">
            {cfg.code ?? 'Unassigned'} · {vis.label}
          </div>
        </div>
      </div>

      <dl className="kv">
        <dt>Status</dt>
        <dd style={{ color: cssColor(vis.beacon ?? vis.glow) }}>{vis.label}</dd>
        <dt>Occupancy</dt>
        <dd>
          {occupants.length} / {cfg.rooms.reduce((n, r) => n + r.capacity, 0)}
        </dd>
        <dt>Footprint</dt>
        <dd>
          {cfg.footprint.w} × {cfg.footprint.h} at {cfg.footprint.x}, {cfg.footprint.y}
        </dd>
        <dt>Height</dt>
        <dd>{cfg.height} units</dd>
        <dt>Rooms</dt>
        <dd>{cfg.rooms.length}</dd>
        <dt>Access</dt>
        <dd>{cfg.ownerOnly ? 'Owner only' : 'Open'}</dd>
      </dl>

      {occupants.length > 0 && (
        <div className="field">
          <span className="field-label">Present</span>
          <div className="list">
            {occupants.slice(0, 8).map((rt) => {
              const name = doc.agents.find((a) => a.id === rt.id)?.name ?? rt.id;
              const av = AGENT_VISUALS[rt.state];
              return (
                <div
                  key={rt.id}
                  className="row"
                  onClick={() => engine.renderer?.focusAgent(rt.id)}
                >
                  <span
                    className="status-dot"
                    style={{ color: cssColor(av.color), width: 6, height: 6 }}
                  />
                  <div className="row-main">
                    <div className="row-title">{name}</div>
                    <div className="row-sub">{av.label}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="btn-row" style={{ marginBottom: 14 }}>
        <Button small onClick={() => engine.renderer?.focusBuilding(cfg.id)}>
          Focus
        </Button>
        <Button small onClick={() => engine.renderer?.goHome()}>
          Back to Plaza
        </Button>
      </div>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
        <TextField label="Name" value={cfg.name} onChange={(v) => updateBuilding(cfg.id, { name: v })} />
        <TextField
          label="Code"
          value={cfg.code ?? ''}
          placeholder="Optional"
          onChange={(v) => updateBuilding(cfg.id, { code: v })}
        />
        <Select<BuildingStyle>
          label="Architecture"
          value={cfg.style}
          options={STYLE_OPTIONS}
          onChange={(v) => updateBuilding(cfg.id, { style: v })}
        />
        <Select
          label="Accent"
          value={cfg.accent ?? 'none'}
          options={[
            { value: 'none', label: 'None' },
            { value: 'silver', label: 'Silver' },
            { value: 'blue', label: 'Cool Blue' },
            { value: 'gold', label: 'Gold' },
          ]}
          onChange={(v) =>
            updateBuilding(cfg.id, { accent: v as NonNullable<typeof cfg.accent> })
          }
        />
      </div>
    </Panel>
  );
}
