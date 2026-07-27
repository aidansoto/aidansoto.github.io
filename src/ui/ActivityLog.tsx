import { useEffect, useRef } from 'react';
import { useCampus } from '@/state/store';
import { Panel, Button } from './primitives';

export function ActivityLog(): JSX.Element {
  const log = useCampus((s) => s.log);
  const clearLog = useCampus((s) => s.clearLog);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);

  // Follow the tail, but only while the owner has not scrolled up to read.
  useEffect(() => {
    const el = bodyRef.current?.parentElement;
    if (!el || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [log]);

  return (
    <Panel
      title="Campus Activity"
      actions={
        <Button small onClick={clearLog}>
          Clear
        </Button>
      }
    >
      <div
        ref={bodyRef}
        onScrollCapture={(e) => {
          const el = e.currentTarget.parentElement;
          if (!el) return;
          pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {log.length === 0 && <div className="empty">No activity recorded yet.</div>}
        {log.map((entry) => (
          <div key={entry.id} className="log-line">
            <span className="log-time">{entry.at}</span>
            <span className={`log-text sev-${entry.severity}`}>{entry.text}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
