/**
 * Sound design.
 *
 * Every sound is synthesised with the Web Audio API — no audio files, nothing
 * to load, nothing to ship. The palette is deliberately quiet and low: soft
 * sine and triangle tones with long releases, plus a filtered noise bed for
 * campus ambience. Nothing here is allowed to sound like an arcade.
 *
 * Audio is off by default and every sound respects the master toggle.
 */

export type SoundId =
  | 'task_notify'
  | 'task_complete'
  | 'elevator'
  | 'door'
  | 'approval'
  | 'error'
  | 'emergency'
  | 'ui_click';

interface ToneSpec {
  /** Frequencies in Hz, played in sequence. */
  notes: number[];
  /** Seconds per note. */
  step: number;
  type: OscillatorType;
  gain: number;
  /** Release tail in seconds. */
  release: number;
}

const TONES: Record<SoundId, ToneSpec> = {
  task_notify: { notes: [880, 1174.7], step: 0.06, type: 'sine', gain: 0.11, release: 0.28 },
  task_complete: { notes: [659.3, 880, 1108.7], step: 0.075, type: 'sine', gain: 0.12, release: 0.45 },
  elevator: { notes: [392, 523.3], step: 0.11, type: 'triangle', gain: 0.07, release: 0.3 },
  door: { notes: [196, 147], step: 0.07, type: 'triangle', gain: 0.06, release: 0.22 },
  approval: { notes: [523.3, 784], step: 0.1, type: 'sine', gain: 0.14, release: 0.6 },
  error: { notes: [220, 174.6], step: 0.13, type: 'triangle', gain: 0.13, release: 0.4 },
  emergency: { notes: [130.8, 110, 87.3], step: 0.2, type: 'sawtooth', gain: 0.16, release: 0.8 },
  ui_click: { notes: [1320], step: 0.02, type: 'sine', gain: 0.05, release: 0.06 },
};

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientSource: AudioBufferSourceNode | null = null;
  private enabled = false;
  private volume = 0.4;
  /** Rate limiter: a busy campus can emit dozens of events per second. */
  private lastPlayed = new Map<SoundId, number>();

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stopAmbient();
      return;
    }
    void this.ensureContext();
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  }

  /**
   * Browsers require a user gesture before audio can start. Call this from a
   * click handler; before that, sounds are silently dropped.
   */
  async ensureContext(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
  }

  play(id: SoundId): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const now = this.ctx.currentTime;

    const last = this.lastPlayed.get(id) ?? -Infinity;
    if (now - last < 0.22) return;
    this.lastPlayed.set(id, now);

    const spec = TONES[id];
    spec.notes.forEach((freq, i) => {
      const t0 = now + i * spec.step;
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      const filter = this.ctx!.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 2600;

      osc.type = spec.type;
      osc.frequency.setValueAtTime(freq, t0);

      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(spec.gain, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.step + spec.release);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.master!);
      osc.start(t0);
      osc.stop(t0 + spec.step + spec.release + 0.05);
    });
  }

  /** A low filtered-noise bed: the sound of a large building at night. */
  startAmbient(): void {
    if (!this.enabled || !this.ctx || !this.master || this.ambientSource) return;

    const seconds = 4;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Brown noise: far gentler than white, and it loops without a seam.
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 340;

    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.06, this.ctx.currentTime, 1.4);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();

    this.ambientSource = src;
    this.ambientGain = gain;
  }

  stopAmbient(): void {
    if (!this.ambientSource || !this.ctx) return;
    this.ambientGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    const src = this.ambientSource;
    this.ambientSource = null;
    this.ambientGain = null;
    setTimeout(() => {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }, 900);
  }

  destroy(): void {
    this.stopAmbient();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }
}

export const sound = new SoundEngine();
