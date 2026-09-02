/**
 * New Mission dialog.
 *
 * One question — "what do you want accomplished?" — and everything else
 * optional. The Manager handles the rest.
 */

import { useRef, useState } from 'react';
import { useCampus } from '@/state/store';
import { engine } from '@/state/engine';
import { ROUTING_OPTIONS } from '@/orchestration/router';
import { Button } from './primitives';
import type { MissionAttachment, MissionPriority, RoutingMode } from '@/core/mission';

/** Inline cap per attachment. Larger files keep metadata only. */
const INLINE_LIMIT = 200_000;

const DEADLINE_PRESETS: Array<{ label: string; ms: number | null }> = [
  { label: 'No deadline', ms: null },
  { label: 'In 1 hour', ms: 60 * 60 * 1000 },
  { label: 'Today, end of day', ms: -1 },
  { label: 'Tomorrow', ms: 24 * 60 * 60 * 1000 },
  { label: 'In 3 days', ms: 3 * 24 * 60 * 60 * 1000 },
];

export function NewMission(): JSX.Element | null {
  const open = useCampus((s) => s.newMissionOpen);
  const setOpen = useCampus((s) => s.setNewMissionOpen);
  const setScreen = useCampus((s) => s.setScreen);
  const doc = useCampus((s) => s.doc);

  const [goal, setGoal] = useState('');
  const [priority, setPriority] = useState<MissionPriority>('normal');
  const [routing, setRouting] = useState<RoutingMode>(doc?.settings.routingMode ?? 'auto_free');
  const [deadlineIdx, setDeadlineIdx] = useState(0);
  const [attachments, setAttachments] = useState<MissionAttachment[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  if (!open || !doc) return null;

  const manager = doc.agents.find((a) => a.id === doc.managerAgentId);
  const workers = doc.agents.filter((a) => a.id !== doc.managerAgentId).length;

  const resolveDeadline = (): number | null => {
    const preset = DEADLINE_PRESETS[deadlineIdx];
    if (preset.ms === null) return null;
    if (preset.ms === -1) {
      const end = new Date();
      end.setHours(23, 59, 0, 0);
      return end.getTime();
    }
    return Date.now() + preset.ms;
  };

  const addFiles = async (files: FileList): Promise<void> => {
    const next: MissionAttachment[] = [];
    for (const file of Array.from(files).slice(0, 6)) {
      const isText = file.type.startsWith('text/') || /\.(md|txt|json|csv|ya?ml)$/i.test(file.name);
      const isImage = file.type.startsWith('image/');
      let content: string | null = null;
      let truncated = false;

      try {
        if (file.size > INLINE_LIMIT) {
          truncated = true;
        } else if (isText) {
          content = await file.text();
        } else if (isImage) {
          // Data URL so a vision-capable local model can be handed the image.
          content = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });
        } else {
          truncated = true;
        }
      } catch {
        truncated = true;
      }

      next.push({
        id: `att_${Date.now().toString(36)}_${next.length}`,
        name: file.name,
        mime: file.type || 'application/octet-stream',
        size: file.size,
        content,
        truncated,
        addedAt: Date.now(),
      });
    }
    setAttachments((prev) => [...prev, ...next].slice(0, 6));
  };

  const close = (): void => {
    setOpen(false);
    setGoal('');
    setAttachments([]);
    setError(null);
    setStarting(false);
  };

  const start = async (): Promise<void> => {
    if (goal.trim().length < 3) {
      setError('Describe what you want accomplished.');
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const id = await engine.startMission({
        goal: goal.trim(),
        deadline: resolveDeadline(),
        priority,
        routingMode: routing,
        attachments,
      });
      if (!id) {
        setError('Could not start the mission — no Manager agent is configured.');
        setStarting(false);
        return;
      }
      close();
      setScreen('dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStarting(false);
    }
  };

  return (
    <div className="owner-overlay" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal" role="dialog" aria-label="New mission">
        <header className="owner-head">
          <div>
            <div className="owner-title">New Mission</div>
            <div className="owner-sub">
              {manager ? `${manager.name} will manage this` : 'No manager configured'} · {workers} worker agents available
            </div>
          </div>
          <Button onClick={close}>Close</Button>
        </header>

        <div className="modal-body">
          <div className="field">
            <label className="field-label" htmlFor="mission-goal">What do you want accomplished?</label>
            <textarea
              id="mission-goal"
              className="mission-input"
              autoFocus
              rows={5}
              value={goal}
              placeholder="e.g. Research this opportunity, create a plan, build the necessary files, have the work reviewed, and give me the completed result by tomorrow."
              onChange={(e) => { setGoal(e.target.value); setError(null); }}
            />
          </div>

          <div className="modal-columns">
            <div className="field">
              <label className="field-label">Deadline</label>
              <select value={deadlineIdx} onChange={(e) => setDeadlineIdx(Number(e.target.value))}>
                {DEADLINE_PRESETS.map((p, i) => (
                  <option key={p.label} value={i}>{p.label}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label">Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as MissionPriority)}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label className="field-label">AI</label>
            <select value={routing} onChange={(e) => setRouting(e.target.value as RoutingMode)}>
              {ROUTING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="dash-note">{ROUTING_OPTIONS.find((o) => o.value === routing)?.hint}</p>
          </div>

          <div className="field">
            <label className="field-label">Attachments (optional)</label>
            <div className="btn-row">
              <Button small onClick={() => fileInput.current?.click()}>Add Files</Button>
              {attachments.length > 0 && (
                <Button small onClick={() => setAttachments([])}>Clear</Button>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            {attachments.length > 0 && (
              <div className="list" style={{ marginTop: 8 }}>
                {attachments.map((a) => (
                  <div key={a.id} className="row" style={{ cursor: 'default' }}>
                    <div className="row-main">
                      <div className="row-title">{a.name}</div>
                      <div className="row-sub">
                        {(a.size / 1024).toFixed(1)} KB · {a.mime}
                        {a.truncated ? ' · too large to read, name only' : ' · readable'}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="agent-promote"
                      onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <p className="modal-error">{error}</p>}
        </div>

        <footer className="modal-foot">
          <Button onClick={close}>Cancel</Button>
          <Button accent="gold" disabled={starting || goal.trim().length < 3} onClick={() => void start()}>
            {starting ? 'Starting…' : 'Start Mission'}
          </Button>
        </footer>
      </div>
    </div>
  );
}
