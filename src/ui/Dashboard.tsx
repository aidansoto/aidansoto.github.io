/**
 * Command Dashboard.
 *
 * Answers five questions within seconds of opening:
 *   What is happening?  What needs me?  What is finished?
 *   What is wrong?      What happens next?
 *
 * Deliberately plain: no charts, no dense tables, no decoration. Every row is
 * either a fact or an action, and everything reflects real backend state.
 */

import { useMemo, useState } from 'react';
import { useCampus } from '@/state/store';
import { engine } from '@/state/engine';
import { AGENT_VISUALS } from '@/render/stateVisuals';
import { routingModeLabel } from '@/orchestration/router';
import { Button, cssColor } from './primitives';
import type { AttentionItem, Mission, Subtask } from '@/core/mission';
import { MAX_AGENTS } from '@/core/mission';

/* ------------------------------------------------------------------ */

export function Dashboard(): JSX.Element {
  const doc = useCampus((s) => s.doc);
  const mode = useCampus((s) => s.mode);
  const ready = useCampus((s) => s.ready);
  const setScreen = useCampus((s) => s.setScreen);
  const setNewMissionOpen = useCampus((s) => s.setNewMissionOpen);
  const setViewingResult = useCampus((s) => s.setViewingResult);
  const providerStatuses = useCampus((s) => s.providerStatuses);
  const dbDegraded = useCampus((s) => s.dbDegraded);
  const loadError = useCampus((s) => s.loadError);
  const log = useCampus((s) => s.log);
  const [tick, setTick] = useState(0);

  // The Manager's derived views are computed outside React; recompute them
  // whenever the document changes.
  const attention = useMemo<AttentionItem[]>(
    () => engine.manager?.attention() ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, tick],
  );

  if (!ready || !doc) {
    return (
      <div className="screen">
        <div className="screen-body">
          <div className="empty" style={{ padding: 60 }}>
            Loading the campus…
          </div>
        </div>
      </div>
    );
  }

  const missions = doc.missions;
  const active = missions.find((m) => m.status === 'running' || m.status === 'planning' || m.status === 'awaiting_approval') ?? null;
  const finished = missions
    .filter((m) => ['completed', 'failed', 'cancelled'].includes(m.status))
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  const activeSubtasks = active ? doc.subtasks.filter((s) => s.missionId === active.id) : [];

  const upcoming = active
    ? activeSubtasks
        .filter((s) => s.status === 'pending' || s.status === 'ready')
        .sort((a, b) => a.order - b.order)
    : [];

  const recentErrors = log.filter((l) => l.severity === 'error').slice(-3);

  return (
    <div className="screen">
      {/* ---------------------------------------------------------- */}
      <header className="screen-head">
        <div>
          <h1 className="screen-title">Command Dashboard</h1>
          <p className="screen-sub">
            {doc.campusName} · {mode === 'running' ? 'Operational' : mode === 'paused' ? 'Paused' : 'Emergency stop'} ·{' '}
            {doc.agents.length} / {MAX_AGENTS} agents
          </p>
        </div>
        <div className="btn-row">
          <Button accent="gold" onClick={() => setNewMissionOpen(true)}>New Mission</Button>
          {mode === 'running' ? (
            <Button onClick={() => { engine.setMode('paused', 'Owner paused the campus'); setTick((t) => t + 1); }}>
              Pause All
            </Button>
          ) : (
            <Button onClick={() => { engine.setMode('running', 'Owner resumed the campus'); setTick((t) => t + 1); }}>
              Resume
            </Button>
          )}
          <Button onClick={() => setScreen('results')}>View Results</Button>
          <Button onClick={() => setScreen('vault')}>Knowledge Vault</Button>
          <Button onClick={() => setScreen('workflows')}>Workflows</Button>
          <Button onClick={() => setScreen('campus')}>Back to Campus</Button>
        </div>
      </header>

      <div className="screen-body dashboard-grid">
        {/* ACTIVE MISSION -------------------------------------------- */}
        <section className="dash-card dash-wide">
          <h2 className="dash-title">Active Mission</h2>
          {active ? (
            <ActiveMission mission={active} subtasks={activeSubtasks} doc={doc} onChanged={() => setTick((t) => t + 1)} />
          ) : (
            <div className="empty">
              Nothing running.
              <div style={{ marginTop: 12 }}>
                <Button accent="gold" onClick={() => setNewMissionOpen(true)}>Start a Mission</Button>
              </div>
            </div>
          )}
        </section>

        {/* NEEDS MY ATTENTION ---------------------------------------- */}
        <section className="dash-card">
          <h2 className="dash-title">
            Needs My Attention
            {attention.length > 0 && <span className="dash-count">{attention.length}</span>}
          </h2>
          {attention.length === 0 ? (
            <div className="empty">Nothing is waiting on you.</div>
          ) : (
            <div className="list">
              {attention.slice(0, 8).map((item) => (
                <AttentionRow key={item.id} item={item} onResolved={() => setTick((t) => t + 1)} />
              ))}
            </div>
          )}
        </section>

        {/* AGENTS ---------------------------------------------------- */}
        <section className="dash-card dash-wide">
          <h2 className="dash-title">Agents</h2>
          <AgentTable onChanged={() => setTick((t) => t + 1)} />
        </section>

        {/* UPCOMING -------------------------------------------------- */}
        <section className="dash-card">
          <h2 className="dash-title">Upcoming</h2>
          {upcoming.length === 0 ? (
            <div className="empty">Nothing queued.</div>
          ) : (
            <div className="list">
              {upcoming.slice(0, 8).map((st) => (
                <div key={st.id} className="row" style={{ cursor: 'default' }}>
                  <div className="row-main">
                    <div className="row-title">{st.title}</div>
                    <div className="row-sub">
                      {st.status === 'pending'
                        ? `Waiting on ${st.dependsOn.length} earlier step(s)`
                        : 'Ready — waiting for a free agent'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {active?.deadline && (
            <p className="dash-note">
              Deadline: {new Date(active.deadline).toLocaleString()}
            </p>
          )}
        </section>

        {/* COMPLETED ------------------------------------------------- */}
        <section className="dash-card">
          <h2 className="dash-title">Completed</h2>
          {finished.length === 0 ? (
            <div className="empty">No missions finished yet.</div>
          ) : (
            <div className="list">
              {finished.slice(0, 6).map((m) => (
                <div
                  key={m.id}
                  className="row"
                  onClick={() => { setViewingResult(m.id); setScreen('results'); }}
                >
                  <span
                    className="status-dot"
                    style={{
                      color: m.status === 'completed' ? 'var(--green)' : m.status === 'failed' ? 'var(--red)' : 'var(--text-faint)',
                      width: 7, height: 7,
                    }}
                  />
                  <div className="row-main">
                    <div className="row-title">{m.title}</div>
                    <div className="row-sub">
                      {m.status} · {m.completedAt ? new Date(m.completedAt).toLocaleTimeString() : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* SYSTEM ---------------------------------------------------- */}
        <section className="dash-card">
          <h2 className="dash-title">System</h2>
          <div className="list">
            {providerStatuses.map((p) => (
              <div key={p.id} className="row" style={{ cursor: 'default' }}>
                <span
                  className="status-dot"
                  style={{
                    color: p.health === 'available' ? 'var(--green)' : p.health === 'checking' ? 'var(--amber)' : 'var(--text-faint)',
                    width: 7, height: 7,
                  }}
                />
                <div className="row-main">
                  <div className="row-title">
                    {p.label} {p.free && <span className="tag-free">FREE</span>}
                  </div>
                  <div className="row-sub">{p.detail}</div>
                </div>
              </div>
            ))}
          </div>
          <dl className="kv" style={{ marginTop: 12 }}>
            <dt>Routing</dt>
            <dd>{routingModeLabel(doc.settings.routingMode)}</dd>
            <dt>Smart Router</dt>
            <dd>{doc.settings.smartRouter ? 'on' : 'off'}</dd>
            <dt>Database</dt>
            <dd>{dbDegraded ? 'degraded — not saving' : 'ok'}</dd>
            <dt>Automation</dt>
            <dd>{mode === 'running' ? 'running' : mode}</dd>
          </dl>
          {(recentErrors.length > 0 || loadError) && (
            <div style={{ marginTop: 10 }}>
              <div className="field-label" style={{ marginBottom: 4 }}>Recent errors</div>
              {loadError && <div className="log-line"><span className="log-text sev-error">{loadError}</span></div>}
              {recentErrors.map((e) => (
                <div key={e.id} className="log-line">
                  <span className="log-time">{e.at}</span>
                  <span className="log-text sev-error">{e.text}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ActiveMission({
  mission,
  subtasks,
  doc,
  onChanged,
}: {
  mission: Mission;
  subtasks: Subtask[];
  doc: NonNullable<ReturnType<typeof useCampus.getState>['doc']>;
  onChanged: () => void;
}): JSX.Element {
  const setViewingResult = useCampus((s) => s.setViewingResult);
  const setScreen = useCampus((s) => s.setScreen);
  const managerName = doc.agents.find((a) => a.id === mission.managerAgentId)?.name ?? 'Manager';
  const done = subtasks.filter((s) => s.status === 'done').length;

  return (
    <div>
      <div className="mission-goal">{mission.goal}</div>

      <dl className="kv" style={{ marginTop: 12 }}>
        <dt>Manager</dt>
        <dd>{managerName}</dd>
        <dt>Stage</dt>
        <dd>{mission.stage}</dd>
        <dt>Started</dt>
        <dd>{mission.startedAt ? new Date(mission.startedAt).toLocaleTimeString() : '—'}</dd>
        <dt>Deadline</dt>
        <dd>{mission.deadline ? new Date(mission.deadline).toLocaleString() : 'none'}</dd>
        <dt>Routing</dt>
        <dd>{routingModeLabel(mission.routingMode)}</dd>
      </dl>

      <div className="field">
        <span className="field-label">
          Progress · {done} of {subtasks.length} complete
        </span>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${mission.progress * 100}%` }} />
        </div>
      </div>

      <div className="subtask-list">
        {subtasks
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((st) => (
            <SubtaskRow key={st.id} subtask={st} doc={doc} onChanged={onChanged} />
          ))}
      </div>

      <div className="btn-row" style={{ marginTop: 12 }}>
        {mission.finalResult && (
          <Button onClick={() => { setViewingResult(mission.id); setScreen('results'); }}>
            View Result
          </Button>
        )}
        <Button accent="red" onClick={() => { engine.cancelMission(mission.id); onChanged(); }}>
          Cancel Mission
        </Button>
      </div>

      {mission.events.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="field-label" style={{ marginBottom: 4 }}>Mission log</div>
          <div className="mission-log">
            {mission.events.slice(-8).reverse().map((e, i) => (
              <div key={`${e.at}-${i}`} className="log-line">
                <span className="log-time">{new Date(e.at).toLocaleTimeString([], { hour12: false })}</span>
                <span className={`log-text sev-${e.kind === 'success' ? 'good' : e.kind}`}>{e.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const SUBTASK_COLOR: Record<Subtask['status'], string> = {
  pending: 'var(--text-faint)',
  ready: 'var(--silver)',
  assigned: 'var(--blue)',
  in_progress: 'var(--blue-glow)',
  in_review: 'var(--gold)',
  revising: 'var(--amber)',
  awaiting_approval: 'var(--gold-bright)',
  done: 'var(--green)',
  failed: 'var(--red)',
  cancelled: 'var(--text-faint)',
};

function SubtaskRow({
  subtask,
  doc,
  onChanged,
}: {
  subtask: Subtask;
  doc: NonNullable<ReturnType<typeof useCampus.getState>['doc']>;
  onChanged: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const agent = doc.agents.find((a) => a.id === subtask.assignedAgentId);
  const reviewer = doc.agents.find((a) => a.id === subtask.reviewerAgentId);

  return (
    <div className="subtask">
      <div className="subtask-head" onClick={() => setOpen((o) => !o)}>
        <span className="status-dot" style={{ color: SUBTASK_COLOR[subtask.status], width: 7, height: 7 }} />
        <div className="row-main">
          <div className="row-title">{subtask.title}</div>
          <div className="row-sub">
            {subtask.status.replace(/_/g, ' ')}
            {agent ? ` · ${agent.name}` : ''}
            {subtask.roleLabel ? ` as ${subtask.roleLabel}` : ''}
            {subtask.modelId ? ` · ${subtask.modelId}` : ''}
          </div>
        </div>
        <span className="subtask-toggle">{open ? '−' : '+'}</span>
      </div>

      {open && (
        <div className="subtask-detail">
          <p className="subtask-instruction">{subtask.instruction}</p>
          {subtask.routingReason && (
            <p className="dash-note"><strong>Model choice:</strong> {subtask.routingReason}</p>
          )}
          {reviewer && <p className="dash-note"><strong>Reviewer:</strong> {reviewer.name}</p>}
          {subtask.revisionCount > 0 && (
            <p className="dash-note">Revised {subtask.revisionCount}×</p>
          )}
          {subtask.retryCount > 0 && <p className="dash-note">Retried {subtask.retryCount}×</p>}
          {subtask.reviewNotes && (
            <>
              <div className="field-label" style={{ marginTop: 8 }}>Review notes</div>
              <pre className="output-block">{subtask.reviewNotes}</pre>
            </>
          )}
          {subtask.output && (
            <>
              <div className="field-label" style={{ marginTop: 8 }}>Output</div>
              <pre className="output-block">{subtask.output}</pre>
            </>
          )}
          {subtask.status === 'awaiting_approval' && (
            <div className="btn-row" style={{ marginTop: 8 }}>
              <Button small accent="gold" onClick={() => { engine.resolveSubtaskApproval(subtask.id, true); onChanged(); }}>
                Approve
              </Button>
              <Button small accent="red" onClick={() => { engine.resolveSubtaskApproval(subtask.id, false); onChanged(); }}>
                Decline
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AttentionRow({ item, onResolved }: { item: AttentionItem; onResolved: () => void }): JSX.Element {
  const color =
    item.kind === 'failure' ? 'var(--red)' : item.kind === 'approval' ? 'var(--gold)' : 'var(--amber)';
  return (
    <div className="row" style={{ cursor: 'default', alignItems: 'flex-start' }}>
      <span className="status-dot" style={{ color, width: 7, height: 7, marginTop: 5 }} />
      <div className="row-main">
        <div className="row-title">{item.title}</div>
        <div className="row-sub" style={{ whiteSpace: 'normal' }}>{item.detail}</div>
        {item.kind === 'approval' && item.subtaskId && (
          <div className="btn-row" style={{ marginTop: 6 }}>
            <Button small accent="gold" onClick={() => { engine.resolveSubtaskApproval(item.subtaskId!, true); onResolved(); }}>
              Approve
            </Button>
            <Button small accent="red" onClick={() => { engine.resolveSubtaskApproval(item.subtaskId!, false); onResolved(); }}>
              Decline
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function AgentTable({ onChanged }: { onChanged: () => void }): JSX.Element {
  const doc = useCampus((s) => s.doc);
  const runtimes = useCampus((s) => s.agents);
  if (!doc) return <div className="empty">…</div>;

  return (
    <div className="agent-table">
      <div className="agent-row agent-row-head">
        <span>Agent</span>
        <span>Mission Role</span>
        <span>Current Task</span>
        <span>Brain</span>
        <span>Status</span>
      </div>
      {doc.agents.map((cfg) => {
        const rt = runtimes.find((r) => r.id === cfg.id);
        const assignment = doc.assignments.find((a) => a.agentId === cfg.id);
        const subtask = doc.subtasks.find(
          (s) => s.assignedAgentId === cfg.id && !['done', 'failed', 'cancelled'].includes(s.status),
        );
        const isManager = doc.managerAgentId === cfg.id;
        const vis = rt ? AGENT_VISUALS[rt.state] : AGENT_VISUALS.offline;

        return (
          <div key={cfg.id} className="agent-row">
            <span className="agent-name">
              {cfg.name}
              {isManager && <span className="tag-manager">MANAGER</span>}
            </span>
            <span className="agent-cell">
              {isManager ? 'Manager / CEO' : (assignment?.roleLabel ?? <em className="dim">unassigned</em>)}
            </span>
            <span className="agent-cell">
              {subtask ? subtask.title : <em className="dim">—</em>}
            </span>
            <span className="agent-cell mono">
              {subtask?.modelId ?? <em className="dim">—</em>}
            </span>
            <span className="agent-cell">
              <span className="status-dot" style={{ color: cssColor(vis.color), width: 6, height: 6, marginRight: 6 }} />
              {vis.label}
              {subtask && subtask.status === 'in_progress' && (
                <div className="mini-progress"><div style={{ width: '50%' }} /></div>
              )}
            </span>
            {!isManager && (
              <button
                type="button"
                className="agent-promote"
                title={`Make ${cfg.name} the Manager`}
                onClick={() => { engine.setManagerAgent(cfg.id); onChanged(); }}
              >
                Make Manager
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
