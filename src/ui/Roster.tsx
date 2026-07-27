/**
 * Roster: every agent and every building, with live state.
 *
 * Clicking a row both selects the subject and flies the camera to it — the map
 * is the interface, so a list selection has to move the view, not replace it.
 */

import { useMemo, useState } from 'react';
import { useCampus } from '@/state/store';
import { engine } from '@/state/engine';
import { AGENT_VISUALS, BUILDING_VISUALS } from '@/render/stateVisuals';
import { Panel, Button, cssColor } from './primitives';
import type { AgentRuntime } from '@/core/types';

type Tab = 'agents' | 'buildings';

export function Roster(): JSX.Element {
  const doc = useCampus((s) => s.doc);
  const agents = useCampus((s) => s.agents);
  const buildingStatus = useCampus((s) => s.buildingStatus);
  const selectedAgentId = useCampus((s) => s.selectedAgentId);
  const selectedBuildingId = useCampus((s) => s.selectedBuildingId);
  const [tab, setTab] = useState<Tab>('agents');

  const runtimeById = useMemo(() => {
    const map = new Map<string, AgentRuntime>();
    for (const a of agents) map.set(a.id, a);
    return map;
  }, [agents]);

  const buildingNames = useMemo(
    () => Object.fromEntries((doc?.buildings ?? []).map((b) => [b.id, b.name])),
    [doc?.buildings],
  );

  if (!doc) return <Panel title="Roster">…</Panel>;

  return (
    <Panel
      title="Campus Roster"
      actions={
        <div className="btn-row">
          <Button small active={tab === 'agents'} onClick={() => setTab('agents')}>
            Agents
          </Button>
          <Button small active={tab === 'buildings'} onClick={() => setTab('buildings')}>
            Sites
          </Button>
        </div>
      }
    >
      {tab === 'agents' ? (
        <div className="list">
          {doc.agents.map((cfg) => {
            const rt = runtimeById.get(cfg.id);
            const vis = rt ? AGENT_VISUALS[rt.state] : AGENT_VISUALS.offline;
            return (
              <div
                key={cfg.id}
                className={`row${selectedAgentId === cfg.id ? ' is-selected' : ''}`}
                onClick={() => engine.renderer?.focusAgent(cfg.id)}
              >
                <span
                  className="status-dot"
                  style={{ color: cssColor(vis.color), width: 7, height: 7 }}
                />
                <div className="row-main">
                  <div className="row-title">{cfg.name}</div>
                  <div className="row-sub">
                    {vis.label}
                    {rt?.buildingId ? ` · ${buildingNames[rt.buildingId] ?? rt.buildingId}` : ''}
                  </div>
                </div>
                {rt?.taskId && (
                  <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                    {Math.round(rt.progress * 100)}%
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="list">
          {doc.buildings.map((b) => {
            const status = buildingStatus[b.id] ?? 'normal';
            const vis = BUILDING_VISUALS[status];
            const occupancy = agents.filter((a) => a.buildingId === b.id).length;
            return (
              <div
                key={b.id}
                className={`row${selectedBuildingId === b.id ? ' is-selected' : ''}`}
                onClick={() => {
                  useCampus.getState().selectBuilding(b.id);
                  engine.renderer?.focusBuilding(b.id);
                }}
              >
                <span
                  className="status-dot"
                  style={{ color: cssColor(vis.beacon ?? vis.glow), width: 7, height: 7 }}
                />
                <div className="row-main">
                  <div className="row-title">
                    {b.name}
                    {b.ownerOnly ? ' ◆' : ''}
                  </div>
                  <div className="row-sub">
                    {vis.label} · {occupancy} present
                  </div>
                </div>
                <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                  {b.code ?? ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
