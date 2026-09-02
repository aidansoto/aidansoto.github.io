/**
 * Local macOS notifications.
 *
 * Uses Tauri's notification plugin on the desktop and the Web Notification API
 * in a browser. Everything is local — no push service, no account, no network.
 *
 * Permission is requested lazily, on the first notification the owner has
 * actually opted into, never at startup.
 */

import { isTauri } from '@/persistence/storage';

export type NotifyKind =
  | 'mission_complete'
  | 'mission_failed'
  | 'task_complete'
  | 'agent_blocked'
  | 'approval_needed'
  | 'deadline';

export interface NotifyPayload {
  kind: NotifyKind;
  title: string;
  body: string;
  missionId: string | null;
  subtaskId: string | null;
}

/** Which events are worth interrupting the owner for. */
const IMPORTANT: NotifyKind[] = [
  'mission_complete',
  'mission_failed',
  'approval_needed',
  'agent_blocked',
  'deadline',
];

type ClickHandler = (payload: NotifyPayload) => void;

class Notifier {
  private enabled = false;
  private granted: boolean | null = null;
  private onClick: ClickHandler | null = null;
  /** Rate limit so a burst of task completions cannot spam Notification Centre. */
  private lastAt = 0;

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  /** Called when the owner clicks a notification, where the platform supports it. */
  setClickHandler(handler: ClickHandler | null): void {
    this.onClick = handler;
  }

  private async ensurePermission(): Promise<boolean> {
    if (this.granted !== null) return this.granted;

    try {
      if (isTauri()) {
        const mod = await import('@tauri-apps/plugin-notification');
        let allowed = await mod.isPermissionGranted();
        if (!allowed) {
          const result = await mod.requestPermission();
          allowed = result === 'granted';
        }
        this.granted = allowed;
        return allowed;
      }

      if (typeof Notification !== 'undefined') {
        if (Notification.permission === 'granted') {
          this.granted = true;
        } else if (Notification.permission !== 'denied') {
          this.granted = (await Notification.requestPermission()) === 'granted';
        } else {
          this.granted = false;
        }
        return this.granted;
      }
    } catch {
      // A blocked or unavailable notification system must never break a mission.
    }

    this.granted = false;
    return false;
  }

  /**
   * Send a notification if the owner has them on and this event warrants one.
   * Never throws.
   */
  async send(payload: NotifyPayload): Promise<void> {
    if (!this.enabled) return;
    if (!IMPORTANT.includes(payload.kind)) return;

    // Task completions are frequent; the important kinds are not, but a
    // pathological mission could still burst. One every three seconds.
    const now = Date.now();
    if (now - this.lastAt < 3000) return;
    this.lastAt = now;

    if (!(await this.ensurePermission())) return;

    try {
      if (isTauri()) {
        const mod = await import('@tauri-apps/plugin-notification');
        mod.sendNotification({ title: payload.title, body: payload.body });
        return;
      }
      if (typeof Notification !== 'undefined') {
        const n = new Notification(payload.title, { body: payload.body });
        n.onclick = () => {
          window.focus();
          this.onClick?.(payload);
        };
      }
    } catch {
      /* nothing to do — notifications are a convenience, not a requirement */
    }
  }
}

export const notifier = new Notifier();
