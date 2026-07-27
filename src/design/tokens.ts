/**
 * Obsidian Campus — Design System
 *
 * A single source of truth for colour, elevation, motion and typography.
 * Every renderer layer and every React panel reads from here so the campus and
 * the interface never drift apart.
 *
 * Direction: black obsidian glass, brushed silver, graphite, near-black
 * structures, white architectural light, cool blue used *sparingly*.
 */

/** Application version, mirrored from package.json / tauri.conf.json. */
export const APP_VERSION = '0.1.0';

/** Hex numbers for PixiJS. */
export const palette = {
  /* Structure -------------------------------------------------------- */
  void: 0x03050700 & 0xffffff, // reserved, fully transparent backdrop
  skyDeep: 0x05070b,
  skyHorizon: 0x0b1119,
  obsidian: 0x070a0e,
  obsidianGlass: 0x0b1017,
  graphite: 0x151a21,
  graphiteHigh: 0x1e242d,
  graphiteEdge: 0x2a323d,
  concrete: 0x11151a,
  concreteLight: 0x191e25,

  /* Metal ------------------------------------------------------------ */
  silver: 0x9aa7b5,
  silverBright: 0xd7e0ea,
  silverDim: 0x5d6874,
  chrome: 0xeef4fb,

  /* Light ------------------------------------------------------------ */
  lightWhite: 0xf4f8ff,
  lightWarm: 0xffe9c4,
  lightCool: 0xdcecff,

  /* Accent (sparing) -------------------------------------------------- */
  blue: 0x4d90d8,
  blueDeep: 0x2b5f9e,
  blueGlow: 0x8fc4ff,
  cyanData: 0x6fd4ff,

  /* Semantics --------------------------------------------------------- */
  gold: 0xc9a227,
  goldBright: 0xf0d36b,
  red: 0xc4453b,
  redBright: 0xff6a5c,
  amber: 0xd8922e,
  green: 0x3f9a72,

  /* Water / landscape -------------------------------------------------- */
  water: 0x081119,
  waterHighlight: 0x18344a,
  foliage: 0x16241f,
  foliageHigh: 0x22362d,
  stone: 0x0d1116,
  stoneLight: 0x161c23,
} as const;

/** CSS strings for the React interface layer. */
export const css = {
  bg0: '#04060a',
  bg1: '#080b11',
  bg2: '#0d1219',
  bg3: '#141a23',
  line: '#1e2732',
  lineBright: '#2c3846',
  text: '#dce4ee',
  textDim: '#8794a4',
  textFaint: '#5a6674',
  silver: '#9aa7b5',
  silverBright: '#d7e0ea',
  blue: '#4d90d8',
  blueGlow: '#8fc4ff',
  gold: '#c9a227',
  red: '#c4453b',
  green: '#3f9a72',
  amber: '#d8922e',
} as const;

/** Motion — every transition in the app pulls its timing from this table. */
export const motion: {
  cameraFlyMs: number;
  fastMs: number;
  panelMs: number;
  ambientPeriodMs: number;
} = {
  /** Camera flight between campus points of interest. */
  cameraFlyMs: 900,
  /** Short UI transition. */
  fastMs: 140,
  /** Panel open / close. */
  panelMs: 220,
  /** Ambient loop period for slow architectural breathing. */
  ambientPeriodMs: 6400,
};

/** Cubic easing used by the camera. Cinematic: slow out, slow in. */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Decelerating ease for follow / snap movements. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Frame-rate independent exponential smoothing factor. */
export function damp(lambda: number, dtMs: number): number {
  return 1 - Math.exp(-lambda * (dtMs / 1000));
}

export const typography = {
  ui: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
  mono: "'SF Mono', 'JetBrains Mono', ui-monospace, 'Menlo', monospace",
} as const;

/** Isometric tile geometry. 2:1 diamond. */
export const iso = {
  tileWidth: 64,
  tileHeight: 32,
  /** Screen pixels per unit of building height at zoom 1. */
  heightUnit: 22,
} as const;

/** Zoom envelope for the camera. Values are plain numbers, not literals. */
export const zoomLimits: {
  min: number;
  max: number;
  default: number;
  lodDetail: number;
  lodCoarse: number;
} = {
  // Low enough that a 96×96 campus frames fully in a laptop viewport. Agents
  // stay legible down here because AgentView enforces a minimum pixel size.
  min: 0.14,
  max: 2.6,
  /** Opening pose: the plaza in context, with neighbouring blocks in frame. */
  default: 0.4,
  /** Below this, signage and fine detail stop drawing. */
  lodDetail: 0.5,
  /** Below this, animation stops — but lit windows never do. */
  lodCoarse: 0.3,
};
