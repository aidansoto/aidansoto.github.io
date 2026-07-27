/**
 * Owner Command Suite.
 *
 * The private control room for the whole estate: approvals, manual override,
 * emergency stop, live system state and campus configuration. Deliberately
 * presented as a room you enter rather than a settings dialog you open.
 */

import { useMemo } from 'react';
import { useCampus } from '@/state/store';
import { engine } from '@/state/engine';
import { AGENT_VISUALS, BUILDING_VISUALS, TASK_STAGE_LABEL } from '@/render/stateVisuals';
import { Button, Stat, Toggle, cssColor } from './primitives';

export function OwnerConsole(): JSX.Element | null {
  const open = useCampus((s) => s.ownerSuiteOpen);
  const setOpen = useCampus((s) => s.setOwnerSuiteOpen);
  const doc = useCampus((s) => s.doc);
  const mode = useCampus((s) => s.mode);
  const agents = useCampus((s) => s.agents);
  const tasks = useCampus((s) => s.tasks);
  const approvals = useCampus((s) => s.approvals);
  const buildingStatus = useCampus((s) => s.buildingStatus);
  const activityLevel = useCampus((s) => s.activityLevel);
  const patch = useCampus((s) => s.patchSettings);
  const stats = useCampus((s) => s.stats);

  const names = useMemo(
    () => ({
      agents: Object.fromEntries((doc?.agents ?? []).map((a) => [a.id, a.name])),
      buildings: Object.fromEntries((doc?.buildings ?? []).map((b) => [b.id, b.name])),
    }),
    [doc],
  );

  if (!open || !doc) return null;

  const busy = agents.filter((a) =>
    ['working', 'using_tool', 'planning', 'collaborating', 'reviewing'].includes(a.state),
  ).length;
  const blocked = agents.filter((a) => a.state === 'blocked' || a.state === 'failed').length;
  const activeTasks = tasks.filter((t) => t.stage !== 'archived' && t.stage !== 'failed').length;
  const archived = tasks.filter((t) => t.stage === 'archived').length;

  const ownerBuilding = doc.buildings.find((b) => b.ownerOnly);

  return (
    <div
      className="owner-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="owner-suite">
        <header className="owner-head">
          <div>
            <div className="owner-title">Owner Command Suite</div>
            <div className="owner-sub">
              {doc.campusName} · Private Level · {ownerBuilding?.code ?? 'OS-09'}
            </div>
          </div>
          <div className="btn-row">
            {ownerBuilding && (
              <Button
                onClick={() => {
                  engine.renderer?.focusBuilding(ownerBuilding.id);
                  setOpen(false);
                }}
              >
                View From Suite
              </Button>
            )}
            <Button onClick={() => setOpen(false)}>Close</Button>
          </div>
        </header>

        <div className="owner-grid">
          {/* ---------------------------------------------------------- */}
          <section className="owner-card">
            <h3>System State</h3>
            <div className="stat-grid">
              <Stat value={`${busy}/${agents.length}`} label="Agents engaged" />
              <Stat value={activeTasks} label="Live tasks" />
              <Stat value={approvals.length} label="Awaiting approval" />
              <Stat value={blocked} label="Blocked or failed" />
              <Stat value={archived} label="Archived" />
              <Stat value={`${Math.round(activityLevel * 100)}%`} label="Activity level" />
            </div>
          </section>

          {/* ---------------------------------------------------------- */}
          <section className="owner-card">
            <h3>Approval Queue</h3>
            {approvals.length === 0 && <div className="empty">Nothing is waiting on you.</div>}
            {approvals.map((task) => (
              <div key={task.id} className="approval-card">
                <div className="approval-title">{task.label}</div>
                <div className="approval-meta">
                  {task.id} · {TASK_STAGE_LABEL[task.stage]} · {task.risk}
                  {task.assignedAgentId ? ` · ${names.agents[task.assignedAgentId] ?? ''}` : ''}
                </div>
                <div className="btn-row">
                  <Button small accent="gold" onClick={() => engine.resolveApproval(task.id, true)}>
                    Approve
                  </Button>
                  <Button small accent="red" onClick={() => engine.resolveApproval(task.id, false)}>
                    Decline
                  </Button>
                  <Button small onClick={() => engine.renderer?.focusTask(task.id)}>
                    Locate
                  </Button>
                </div>
              </div>
            ))}
          </section>

          {/* ---------------------------------------------------------- */}
          <section className="owner-card">
            <h3>Manual Override</h3>
            <div className="btn-row" style={{ marginBottom: 12 }}>
              <Button
                active={mode === 'running'}
                disabled={mode === 'running'}
                onClick={() => engine.setMode('running', 'Owner resumed the campus')}
              >
                Resume All
              </Button>
              <Button
                active={mode === 'paused'}
                disabled={mode === 'paused'}
                onClick={() => engine.setMode('paused', 'Owner paused the campus')}
              >
                Pause All
              </Button>
            </div>
            <Button
              accent="red"
              onClick={() => {
                if (mode === 'stopped') engine.setMode('running', 'Owner cleared the emergency stop');
                else engine.emergencyStop();
              }}
            >
              {mode === 'stopped' ? 'Clear Emergency Stop' : 'Emergency Stop'}
            </Button>
            <p className="empty" style={{ textAlign: 'left', padding: '12px 0 0' }}>
              Emergency stop takes every agent offline, halts all task movement and darkens the
              estate. Nothing resumes until you clear it.
            </p>
          </section>

          {/* ---------------------------------------------------------- */}
          <section className="owner-card">
            <h3>Building Monitor</h3>
            <div className="list">
              {doc.buildings.map((b) => {
                const status = buildingStatus[b.id] ?? 'normal';
                const vis = BUILDING_VISUALS[status];
                const present = agents.filter((a) => a.buildingId === b.id).length;
                return (
                  <div
                    key={b.id}
                    className="row"
                    onClick={() => {
                      engine.renderer?.focusBuilding(b.id);
                      setOpen(false);
                    }}
                  >
                    <span
                      className="status-dot"
                      style={{ color: cssColor(vis.beacon ?? vis.glow), width: 7, height: 7 }}
                    />
                    <div className="row-main">
                      <div className="row-title">{b.name}</div>
                      <div className="row-sub">
                        {vis.label} · {present} present
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ---------------------------------------------------------- */}
          <section className="owner-card">
            <h3>Agent Monitor</h3>
            <div className="list">
              {agents
                .slice()
                .sort((a, b) => severityRank(b.state) - severityRank(a.state))
                .slice(0, 10)
                .map((rt) => {
                  const vis = AGENT_VISUALS[rt.state];
                  return (
                    <div
                      key={rt.id}
                      className="row"
                      onClick={() => {
                        engine.renderer?.focusAgent(rt.id);
                        setOpen(false);
                      }}
                    >
                      <span
                        className="status-dot"
                        style={{ color: cssColor(vis.color), width: 7, height: 7 }}
                      />
                      <div className="row-main">
                        <div className="row-title">{names.agents[rt.id] ?? rt.id}</div>
                        <div className="row-sub">
                          {vis.label}
                          {rt.buildingId ? ` · ${names.buildings[rt.buildingId] ?? ''}` : ''}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>

          {/* ---------------------------------------------------------- */}
          <section className="owner-card">
            <h3>Estate Configuration</h3>
            <Toggle
              label="Ambient campus activity"
              checked={doc.settings.ambientActivity}
              onChange={(v) => patch({ ambientActivity: v })}
            />
            <Toggle
              label="Task packet visualisation"
              checked={doc.settings.showTaskPackets}
              onChange={(v) => patch({ showTaskPackets: v })}
            />
            <Toggle
              label="Agent name labels"
              checked={doc.settings.showAgentLabels}
              onChange={(v) => patch({ showAgentLabels: v })}
            />
            <Toggle
              label="Auto-resolve stale approvals"
              checked={doc.settings.autoResolveApprovals}
              onChange={(v) => patch({ autoResolveApprovals: v })}
            />
            <div
              style={{
                marginTop: 12,
                paddingTop: 10,
                borderTop: '1px solid var(--line)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-faint)',
                lineHeight: 1.7,
              }}
            >
              <div>renderer · {stats.fps} fps</div>
              <div>
                drawn · {stats.buildingsDrawn} sites / {stats.agentsDrawn} agents
              </div>
              <div>grid · {doc.gridSize.w} × {doc.gridSize.h}</div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function severityRank(state: string): number {
  switch (state) {
    case 'failed':
      return 6;
    case 'blocked':
      return 5;
    case 'waiting_for_approval':
      return 4;
    case 'reviewing':
      return 3;
    case 'collaborating':
      return 2;
    case 'working':
      return 1;
    default:
      return 0;
  }
}
