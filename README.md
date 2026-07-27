# Obsidian Campus

A premium isometric 2D AI agent workplace for macOS.

The campus **is** the interface. Ten configurable buildings surround a central
command plaza; configurable agents in tailored suits move between them, carry
work, collaborate, wait, review, and escalate to the owner. Nothing about what
an agent *does* is defined here — roles, tools, instructions and workflows are
assigned later. This phase builds the visual workplace and the state machinery
that drives it.

**Design direction:** black obsidian glass, brushed silver, graphite, near-black
structures, white architectural light, cool blue used sparingly, and gold
reserved for owner-level signals. Night is the primary grade.

---

## Requirements

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 20+ | 22 recommended |
| npm | 10+ | |
| Rust | 1.77+ | Desktop build only — install via [rustup](https://rustup.rs) |
| Xcode Command Line Tools | — | macOS only: `xcode-select --install` |

## Setup

```bash
git clone <this repo>
cd obsidian-campus
npm install
```

## Running

**Browser (fastest loop for visual work):**

```bash
npm run dev          # http://localhost:5173
```

Persistence falls back to `localStorage`, so the campus configuration still
survives a reload. Everything visual behaves identically to the desktop app.

**macOS desktop app:**

```bash
npm run tauri dev    # launches the Tauri shell with SQLite persistence
```

---

## Building the macOS application

Run this **on the Mac** — Tauri cannot cross-compile a `.app` or `.dmg` from
Linux or Windows, because the bundle format, `hdiutil` and `codesign` are
macOS-only.

```bash
npm install
npm run tauri build
```

The first build compiles the whole Rust dependency tree and takes several
minutes. Later builds are incremental and much faster.

### Where the files land

Both paths are relative to the project root.

| Artifact | Path |
| --- | --- |
| Application | `src-tauri/target/release/bundle/macos/Obsidian Campus.app` |
| Installer | `src-tauri/target/release/bundle/dmg/Obsidian Campus_0.1.0_aarch64.dmg` |

The DMG filename ends in `_aarch64` on Apple Silicon and `_x64` on Intel. To
ship one file that runs on both:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run tauri build -- --target universal-apple-darwin
```

That writes to `src-tauri/target/universal-apple-darwin/release/bundle/`
instead.

### Installing

1. Open the `.dmg`.
2. Drag **Obsidian Campus** into **Applications**.
3. Open Finder → Applications.
4. **Right-click the app and choose Open**, then confirm.

Step 4 matters. This build is not code-signed, so double-clicking it the first
time gets you *"Obsidian Campus cannot be opened because the developer cannot
be verified."* Right-click → Open registers the exception once; after that it
launches normally from the Dock like any other app. If macOS refuses outright,
clear the quarantine flag:

```bash
xattr -dr com.apple.quarantine "/Applications/Obsidian Campus.app"
```

To remove the warning permanently you need an Apple Developer Program
membership ($99/yr), then set `signingIdentity` under `bundle.macOS` in
`src-tauri/tauri.conf.json` and notarise the build.

Once installed it behaves like any desktop app — pin it to the Dock and leave
the campus running on a second monitor.

## Verifying

```bash
npm run typecheck            # strict TypeScript, no emit
npm test                     # 164 unit tests (vitest)
npm run build                # typecheck + production bundle
cd src-tauri && cargo test   # SQLite persistence tests
```

---

## Controls

| Action | Input |
| --- | --- |
| Pan | Drag anywhere on the campus, or `W A S D` / arrow keys |
| Zoom | Scroll wheel or trackpad pinch (anchored under the cursor) |
| Zoom in / out | `+` / `−`, or the on-screen cluster |
| Return to the plaza | `0`, or the `◆` button |
| Frame the whole campus | `F`, or the `⤢` button |
| Owner Command Suite | `◈` button, or the top bar |
| Inspect | Click an agent or a building |
| Follow an agent | Click it in the roster, or press **Follow** in the inspector |
| Clear selection | `Esc` |

## What the campus tells you at a glance

**Agents.** Every agent carries a name plate, a state tag, and a state
indicator that uses a distinct *colour and shape* — so state never depends on
colour alone. Agents holding work show a progress bar tinted to their task.
Click one for its current task, state, location, room, active tool, transport
mode and last three actions.

The figure has a minimum on-screen size and never shrinks past it, so agents
stay findable at any zoom. Name plates are counter-scaled to a constant pixel
size and hide only at full-campus zoom, where eighteen overlapping labels would
be less readable than none — the selected and hovered agent always keep theirs.

**Buildings.** Window luminance, plinth wash and rooftop beacon encode status:

| Status | Reading |
| --- | --- |
| Normal | Soft white interior light, no beacon |
| Active | Brighter, cool blue beacon |
| Productive | Warm gold highlights, high luminance |
| Blocked | Red rooftop beacon |
| Approval needed | Gold beacon — the owner is being waited on |
| Paused | Dimmed |
| Offline | Nearly dark |

Nothing flashes. The fastest beacon period is 1.4 seconds.

**The plaza monument** carries the whole ecosystem's state: calm white when
normal, drifting blue when active, gold when productive, red on serious
problems, dimmed when paused or stopped.

**Tasks** appear as luminous packets arcing between buildings. Risk changes the
container, not the amount of effect: a glass shard for standard work, a ribbed
capsule for elevated, a sealed silver container for secure.

---

## Configuration

Everything is data. The campus document — buildings, footprints, heights,
architecture, rooms, agents, dress, landscaping, walkways, water, skybridges,
reserved plots, theme and settings — is persisted as JSON and normalised on
every load. Names and layout are editable from the interface; the seed values
in `src/config/defaultCampus.ts` are placeholders with no built-in meaning.

A corrupt or outdated document never blocks startup: `normalizeCampus` repairs
what it can (relocating an entrance stranded inside its own mass, reassigning
an agent whose building vanished, dropping bridges to nowhere) and reports each
repair to the activity log.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, the event
  contract, the rendering pipeline, and how to swap the simulation for a real
  agent backend.
- [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) — what this phase does not do,
  and the recommended next phase.

## Project layout

```
src/
  core/         iso projection, event bus, navigation + A*, domain types
  config/       campus seed data, schema normalisation, themes
  sim/          agent state machine, task lifecycle, building status
  render/       PixiJS scene: camera, geometry, buildings, agents, layers
  state/        zustand store, engine wiring
  persistence/  storage adapter (SQLite via Tauri, localStorage in browser)
  ui/           React interface overlay
  audio/        synthesised sound design (no audio assets)
src-tauri/      Rust backend — SQLite persistence with revision history
tests/          164 unit tests
```

No image or audio assets ship with the app. Every texture and every sound is
generated at runtime, which keeps the bundle small and lets the whole campus be
re-themed from `src/design/tokens.ts`.
