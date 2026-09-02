/**
 * Manager conversation panel.
 *
 * A dockable panel available from any screen. Answers come from real campus
 * state; some questions are commands and genuinely change how the campus runs.
 */

import { useEffect, useRef, useState } from 'react';
import { useCampus } from '@/state/store';
import { engine } from '@/state/engine';
import { answer, SUGGESTED_QUESTIONS } from '@/orchestration/managerChat';
import { Button } from './primitives';

export function ManagerChat(): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const doc = useCampus((s) => s.doc);
  const messages = useCampus((s) => s.managerChat);
  const pushChat = useCampus((s) => s.pushChat);
  const clearChat = useCampus((s) => s.clearChat);
  const setDoc = useCampus((s) => s.setDoc);
  const [input, setInput] = useState('');
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, open]);

  if (!doc) return null;

  const managerName = doc.agents.find((a) => a.id === doc.managerAgentId)?.name ?? 'Manager';

  const ask = (text: string): void => {
    const question = text.trim();
    if (!question) return;
    pushChat({ from: 'owner', text: question });

    const current = useCampus.getState().doc;
    if (!current) return;
    const reply = answer(current, question);
    pushChat({ from: 'manager', text: reply.text });

    // Some answers are actions. Apply them for real.
    if (reply.effect) {
      const effect = reply.effect;
      if (effect.kind === 'set_routing' && effect.routingMode) {
        setDoc({ ...current, settings: { ...current.settings, routingMode: effect.routingMode } });
      } else if (effect.kind === 'set_deadline' && effect.missionId && effect.deadline) {
        setDoc({
          ...current,
          missions: current.missions.map((m) =>
            m.id === effect.missionId ? { ...m, deadline: effect.deadline! } : m,
          ),
        });
      } else if (effect.kind === 'cancel_mission' && effect.missionId) {
        engine.cancelMission(effect.missionId);
      }
    }
    setInput('');
  };

  if (!open) {
    return (
      <button type="button" className="chat-fab" onClick={() => setOpen(true)} title={`Ask ${managerName}`}>
        Ask {managerName}
      </button>
    );
  }

  return (
    <div className="chat-panel" role="dialog" aria-label="Manager conversation">
      <header className="chat-head">
        <div>
          <div className="panel-title">{managerName} · Manager</div>
          <div className="chat-sub">Answers come from live campus state</div>
        </div>
        <div className="btn-row">
          <Button small onClick={clearChat}>Clear</Button>
          <Button small onClick={() => setOpen(false)}>Close</Button>
        </div>
      </header>

      <div className="chat-body" ref={bodyRef}>
        {messages.length === 0 && (
          <div className="empty" style={{ textAlign: 'left', padding: '8px 0 12px' }}>
            Ask me anything about what the campus is doing.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg chat-${m.from}`}>
            <div className="chat-bubble">{m.text}</div>
          </div>
        ))}
      </div>

      <div className="chat-suggestions">
        {SUGGESTED_QUESTIONS.map((s) => (
          <button key={s} type="button" className="chat-chip" onClick={() => ask(s)}>
            {s}
          </button>
        ))}
      </div>

      <form
        className="chat-input-row"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <input
          type="text"
          value={input}
          placeholder="Ask the Manager…"
          onChange={(e) => setInput(e.target.value)}
        />
        <Button small onClick={() => ask(input)}>Send</Button>
      </form>
    </div>
  );
}
