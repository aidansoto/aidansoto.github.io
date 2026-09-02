/**
 * Mission results.
 *
 * Where completed deliverables live. A mission's final result is the combined
 * output the Manager assembled, with the supporting work beneath it.
 */

import { useState } from 'react';
import { useCampus } from '@/state/store';
import { Button } from './primitives';
import type { Mission } from '@/core/mission';

export function Results(): JSX.Element {
  const doc = useCampus((s) => s.doc);
  const setScreen = useCampus((s) => s.setScreen);
  const viewingResultId = useCampus((s) => s.viewingResultId);
  const setViewingResult = useCampus((s) => s.setViewingResult);
  const [copied, setCopied] = useState(false);

  if (!doc) {
    return (
      <div className="screen">
        <div className="screen-body"><div className="empty" style={{ padding: 60 }}>Loading…</div></div>
      </div>
    );
  }

  const finished = doc.missions
    .filter((m) => ['completed', 'failed', 'cancelled'].includes(m.status))
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  const selected =
    finished.find((m) => m.id === viewingResultId) ?? finished[0] ?? null;

  const copy = (text: string): void => {
    const done = (): void => { setCopied(true); setTimeout(() => setCopied(false), 1800); };
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text).then(done);
    else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      done();
    }
  };

  const download = (mission: Mission): void => {
    const text = mission.finalResult ?? '';
    try {
      const blob = new Blob([text], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${mission.title.replace(/\W+/g, '-').toLowerCase()}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      copy(text);
    }
  };

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <h1 className="screen-title">Results</h1>
          <p className="screen-sub">{finished.length} finished mission(s)</p>
        </div>
        <div className="btn-row">
          <Button onClick={() => setScreen('dashboard')}>Dashboard</Button>
          <Button onClick={() => setScreen('campus')}>Back to Campus</Button>
        </div>
      </header>

      <div className="screen-body results-layout">
        <aside className="results-list">
          {finished.length === 0 ? (
            <div className="empty">No finished missions yet.</div>
          ) : (
            <div className="list">
              {finished.map((m) => (
                <div
                  key={m.id}
                  className={`row${selected?.id === m.id ? ' is-selected' : ''}`}
                  onClick={() => setViewingResult(m.id)}
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
                      {m.status} · {m.completedAt ? new Date(m.completedAt).toLocaleDateString() : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>

        <section className="results-detail">
          {!selected ? (
            <div className="empty" style={{ padding: 60 }}>
              Finished missions and their deliverables appear here.
            </div>
          ) : (
            <>
              <div className="results-head">
                <div>
                  <h2 className="results-title">{selected.title}</h2>
                  <p className="screen-sub">
                    {selected.status} ·{' '}
                    {selected.completedAt ? new Date(selected.completedAt).toLocaleString() : ''}
                  </p>
                </div>
                {selected.finalResult && (
                  <div className="btn-row">
                    <Button small onClick={() => copy(selected.finalResult!)}>
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                    <Button small onClick={() => download(selected)}>Download</Button>
                  </div>
                )}
              </div>

              <div className="mission-goal" style={{ marginBottom: 14 }}>{selected.goal}</div>

              {selected.failureReason && (
                <p className="modal-error" style={{ marginBottom: 12 }}>{selected.failureReason}</p>
              )}

              {selected.finalResult ? (
                <pre className="result-block">{selected.finalResult}</pre>
              ) : (
                <div className="empty">This mission produced no final result.</div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
