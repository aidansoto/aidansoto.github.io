/**
 * Manager conversation.
 *
 * The Manager answers from actual campus state — never invented status. Every
 * response here is assembled from the live document: real missions, real
 * subtasks, real agents, real model choices.
 *
 * Some questions are also *commands* ("use only free AI", "finish by 6"). Those
 * return an `effect` the caller applies, so the chat can genuinely change how
 * the campus runs rather than merely describing it.
 */

import type { CampusDocument } from '@/core/types';
import type { RoutingMode } from '@/core/mission';
import { routingModeLabel } from './router';
import { describeMemory } from './memory';

export interface ChatEffect {
  kind: 'set_routing' | 'set_deadline' | 'cancel_mission' | 'reassign';
  routingMode?: RoutingMode;
  deadline?: number;
  missionId?: string;
  subtaskId?: string;
}

export interface ChatReply {
  text: string;
  effect: ChatEffect | null;
}

function fmtTime(ms: number | null): string {
  return ms === null ? 'no deadline' : new Date(ms).toLocaleString();
}

function relative(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${Math.round(hours / 24)} day(s) ago`;
}

/**
 * Answer a question about the campus.
 * Pure: given the same document and question it always produces the same reply.
 */
export function answer(doc: CampusDocument, question: string): ChatReply {
  const q = question.trim();
  const lower = q.toLowerCase();

  const active = doc.missions.find(
    (m) => m.status === 'running' || m.status === 'planning' || m.status === 'awaiting_approval',
  );
  const managerName = doc.agents.find((a) => a.id === doc.managerAgentId)?.name ?? 'the Manager';

  /* -- Commands ----------------------------------------------------- */

  if (/\b(only )?free\b.*\bai\b|\buse (only )?free\b|\bfree only\b|\bno paid\b|\bdon'?t pay\b/.test(lower)) {
    return {
      text: 'Switched to AUTO — FREE ONLY. Only free local models will be used from now on. If a task cannot be done with what is available, I will tell you rather than reaching for a paid provider.',
      effect: { kind: 'set_routing', routingMode: 'auto_free' },
    };
  }

  if (/\b(fastest|be quick|hurry|speed)\b/.test(lower)) {
    return {
      text: 'Switched to AUTO — FASTEST. I will prefer the quickest capable model for each task.',
      effect: { kind: 'set_routing', routingMode: 'auto_fast' },
    };
  }

  if (/\b(best quality|highest quality|most accurate|be thorough)\b/.test(lower)) {
    return {
      text: 'Switched to AUTO — BEST QUALITY. I will prefer the strongest capable model for each task.',
      effect: { kind: 'set_routing', routingMode: 'auto_quality' },
    };
  }

  // "finish this by 6", "by 18:00", "by 6pm"
  const byTime = lower.match(/\bby\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (byTime && active) {
    let hour = parseInt(byTime[1], 10);
    const minute = byTime[2] ? parseInt(byTime[2], 10) : 0;
    const meridiem = byTime[3];
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    // Bare "by 6" almost always means this evening.
    if (!meridiem && hour <= 11) hour += 12;

    const when = new Date();
    when.setHours(hour, minute, 0, 0);
    if (when.getTime() <= Date.now()) when.setDate(when.getDate() + 1);

    return {
      text: `Deadline for "${active.title}" set to ${when.toLocaleString()}. I will warn you if it looks like slipping.`,
      effect: { kind: 'set_deadline', deadline: when.getTime(), missionId: active.id },
    };
  }

  if (/\b(stop|cancel|abandon)\b.*\bmission\b|\bcancel this\b/.test(lower) && active) {
    return {
      text: `Cancelling "${active.title}". In-flight work is being stopped and the agents released.`,
      effect: { kind: 'cancel_mission', missionId: active.id },
    };
  }

  /* -- Questions ---------------------------------------------------- */

  // "what is Agent 4 working on?"
  const agentMatch = q.match(/\bagent\s*0?(\d{1,2})\b/i);
  if (agentMatch) {
    const num = agentMatch[1].padStart(2, '0');
    const agent =
      doc.agents.find((a) => a.name.toLowerCase().includes(`agent ${num}`)) ??
      doc.agents.find((a) => a.name.toLowerCase().replace(/\s+/g, '').includes(`agent${num}`));

    if (!agent) return { text: `There is no Agent ${num} on the roster.`, effect: null };

    if (agent.id === doc.managerAgentId) {
      return {
        text: `${agent.name} is the Manager — that is me. I am coordinating${active ? ` "${active.title}"` : ', with nothing running right now'}.`,
        effect: null,
      };
    }

    const subtask = doc.subtasks.find(
      (s) => s.assignedAgentId === agent.id && !['done', 'failed', 'cancelled'].includes(s.status),
    );
    const assignment = doc.assignments.find((a) => a.agentId === agent.id);

    if (!subtask) {
      return {
        text: `${agent.name} is not working on anything right now${assignment ? `, though still assigned as ${assignment.roleLabel}` : ''}.`,
        effect: null,
      };
    }

    const mission = doc.missions.find((m) => m.id === subtask.missionId);
    return {
      text: [
        `${agent.name} is acting as ${assignment?.roleLabel ?? subtask.roleLabel ?? 'a specialist'} on "${subtask.title}".`,
        `Status: ${subtask.status.replace(/_/g, ' ')}.`,
        subtask.modelId ? `Running on ${subtask.modelId}.` : '',
        subtask.routingReason ? subtask.routingReason : '',
        mission ? `Part of "${mission.title}".` : '',
      ].filter(Boolean).join(' '),
      effect: null,
    };
  }

  // "why is this taking so long?"
  if (/\b(taking so long|slow|why.*long|delayed|stuck)\b/.test(lower)) {
    if (!active) return { text: 'Nothing is running, so nothing is running late.', effect: null };
    const subtasks = doc.subtasks.filter((s) => s.missionId === active.id);
    const blocked = subtasks.filter((s) => s.status === 'pending');
    const retried = subtasks.filter((s) => s.retryCount > 0);
    const revised = subtasks.filter((s) => s.revisionCount > 0);
    const waiting = subtasks.filter((s) => s.status === 'awaiting_approval');

    const reasons: string[] = [];
    if (waiting.length > 0) reasons.push(`${waiting.length} item(s) are waiting on your approval`);
    if (blocked.length > 0) reasons.push(`${blocked.length} step(s) are waiting on earlier work`);
    if (retried.length > 0) reasons.push(`${retried.length} task(s) had to be retried`);
    if (revised.length > 0) reasons.push(`${revised.length} task(s) failed review and were revised`);

    return {
      text: reasons.length > 0
        ? `"${active.title}" is at ${Math.round(active.progress * 100)}%. ${reasons.join('; ')}.`
        : `"${active.title}" is at ${Math.round(active.progress * 100)}% and progressing normally. Started ${relative(active.startedAt ?? active.createdAt)}.`,
      effect: null,
    };
  }

  // "give me the completed result"
  if (/\b(result|deliverable|output|finished work)\b/.test(lower)) {
    const completed = doc.missions
      .filter((m) => m.status === 'completed' && m.finalResult)
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
    if (completed.length === 0) {
      return {
        text: active
          ? `Nothing is finished yet. "${active.title}" is at ${Math.round(active.progress * 100)}%.`
          : 'No missions have produced a result yet.',
        effect: null,
      };
    }
    const latest = completed[0];
    return {
      text: `"${latest.title}" finished ${relative(latest.completedAt ?? Date.now())}. Open Results to read the full deliverable — it combines ${doc.subtasks.filter((s) => s.missionId === latest.id && s.status === 'done').length} completed subtask(s).`,
      effect: null,
    };
  }

  // "what needs me?"
  if (/\b(need|waiting on me|approve|approval|my input|decision)\b/.test(lower)) {
    const pending = doc.subtasks.filter((s) => s.status === 'awaiting_approval');
    if (pending.length === 0) return { text: 'Nothing is waiting on you.', effect: null };
    return {
      text: `${pending.length} item(s) need your decision: ${pending.map((s) => `"${s.title}"`).join(', ')}. They are on the dashboard under Needs My Attention.`,
      effect: null,
    };
  }

  // "what have you learned?"
  if (/\b(learn|remember|memory|know about)\b/.test(lower)) {
    const lines = describeMemory(doc.memory, 5);
    return {
      text: lines.length === 0
        ? 'I have not learned anything yet — memory builds up as missions run.'
        : `What I have learned so far:\n${lines.map((l) => `• ${l}`).join('\n')}`,
      effect: null,
    };
  }

  // "which model are you using?"
  if (/\b(model|brain|routing|which ai)\b/.test(lower)) {
    const inFlight = doc.subtasks.filter((s) => s.status === 'in_progress' && s.modelId);
    return {
      text: [
        `Routing mode is ${routingModeLabel(doc.settings.routingMode).toUpperCase()}, Smart Router ${doc.settings.smartRouter ? 'on' : 'off'}.`,
        inFlight.length > 0
          ? `Right now: ${inFlight.map((s) => `${s.modelId} on "${s.title}"`).join(', ')}.`
          : 'No tasks are running at the moment.',
      ].join(' '),
      effect: null,
    };
  }

  /* -- Default: a genuine status report ----------------------------- */

  if (!active) {
    const finished = doc.missions.filter((m) => m.status === 'completed').length;
    return {
      text: [
        `I am ${managerName}. Nothing is running right now.`,
        finished > 0 ? `${finished} mission(s) completed so far.` : 'No missions have run yet.',
        `${doc.agents.length - 1} worker agents are available.`,
        'Start a mission from the dashboard and I will plan it, assign roles and report back.',
      ].join(' '),
      effect: null,
    };
  }

  const subtasks = doc.subtasks.filter((s) => s.missionId === active.id);
  const done = subtasks.filter((s) => s.status === 'done').length;
  const working = subtasks.filter((s) => s.status === 'in_progress');
  const roles = doc.assignments
    .filter((a) => a.missionId === active.id)
    .map((a) => `${doc.agents.find((x) => x.id === a.agentId)?.name ?? a.agentId} as ${a.roleLabel}`);

  return {
    text: [
      `"${active.title}" — ${active.stage}, ${done} of ${subtasks.length} subtasks complete.`,
      roles.length > 0 ? `Assigned: ${roles.join(', ')}.` : '',
      working.length > 0 ? `In progress: ${working.map((s) => `"${s.title}"`).join(', ')}.` : '',
      `Deadline: ${fmtTime(active.deadline)}.`,
    ].filter(Boolean).join(' '),
    effect: null,
  };
}

/** Prompts shown as one-tap buttons in the chat panel. */
export const SUGGESTED_QUESTIONS = [
  "What's happening?",
  'What needs me?',
  'Why is this taking so long?',
  'Give me the completed result',
  'Use only free AI',
  'What have you learned?',
];
