import { useEffect, useState } from 'react';
import { useCampus } from '@/state/store';
import { engine } from '@/state/engine';
import { Button, StatusChip } from './primitives';
import { css } from '@/design/tokens';

const MODE_COLOR = {
  running: css.green,
  paused: css.amber,
  stopped: css.red,
} as const;

export function TopBar(): JSX.Element {
  const doc = useCampus((s) => s.doc);
  const mode = useCampus((s) => s.mode);
  const agents = useCampus((s) => s.agents);
  const tasks = useCampus((s) => s.tasks);
  const approvals = useCampus((s) => s.approvals);
  const stats = useCampus((s) => s.stats);
  const openPanel = useCampus((s) => s.openPanel);
  const setPanel = useCampus((s) => s.setPanel);
  const setOwnerSuiteOpen = useCampus((s) => s.setOwnerSuiteOpen);

  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const busy = agents.filter((a) =>
    ['working', 'using_tool', 'planning', 'collaborating', 'reviewing', 'receiving_task'].includes(
      a.state,
    ),
  ).length;
  const trouble = agents.filter((a) => a.state === 'blocked' || a.state === 'failed').length;
  const activeTasks = tasks.filter((t) => t.stage !== 'archived' && t.stage !== 'failed').length;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" />
        <div>
          <div className="brand-name">{doc?.campusName ?? 'Obsidian Campus'}</div>
          <div className="brand-sub">Autonomous Operations Estate</div>
        </div>
      </div>

      <StatusChip color={MODE_COLOR[mode]}>
        {mode === 'running' ? 'Operational' : mode === 'paused' ? 'Paused' : 'Emergency Stop'}
      </StatusChip>

      {approvals.length > 0 && (
        <StatusChip color={css.gold}>
          {approvals.length} Approval{approvals.length === 1 ? '' : 's'}
        </StatusChip>
      )}
      {trouble > 0 && <StatusChip color={css.red}>{trouble} Blocked</StatusChip>}

      <div className="topbar-spacer" />

      <div className="metrics">
        <Metric label="Agents" value={`${busy}/${agents.length}`} />
        <Metric label="Tasks" value={String(activeTasks)} />
        <Metric label="FPS" value={String(stats.fps)} />
        <Metric
          label="Time"
          value={clock.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}
        />
      </div>

      <div className="btn-row">
        <Button active={openPanel === 'roster'} onClick={() => setPanel('roster')}>
          Roster
        </Button>
        <Button active={openPanel === 'log'} onClick={() => setPanel('log')}>
          Log
        </Button>
        <Button active={openPanel === 'settings'} onClick={() => setPanel('settings')}>
          Settings
        </Button>
        <Button accent="gold" onClick={() => setOwnerSuiteOpen(true)}>
          Owner Suite
        </Button>
        {mode === 'running' ? (
          <Button onClick={() => engine.setMode('paused', 'Owner paused the campus')}>Pause</Button>
        ) : (
          <Button onClick={() => engine.setMode('running', 'Owner resumed the campus')}>Resume</Button>
        )}
      </div>
    </header>
  );
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </div>
  );
}
