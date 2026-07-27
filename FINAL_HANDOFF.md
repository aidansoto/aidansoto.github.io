# Final Handoff — Obsidian Campus

Everything you need to know to take this project, run it, and build it into a
free local Mac application.

## The project

| | |
| --- | --- |
| **Project name** | Obsidian Campus (placeholder — rename any time in `src-tauri/tauri.conf.json` → `productName` and Settings → Campus Name) |
| **Project folder** | `aidansoto.github.io` (clone as `obsidian-campus` if you prefer: `git clone <repo> obsidian-campus`) |
| **GitHub repository** | `https://github.com/aidansoto/aidansoto.github.io`, branch `claude/ai-campus-visual-design-3yuyjw` |
| **ZIP** | Not created — GitHub access was available, so the repository is the source of truth. (GitHub's **Code → Download ZIP** produces one on demand.) |
| **Version** | 0.1.0 |
| **Operating mode** | Offline Simulation (default; free; no API keys; no network use) |

## Launch and build

| Action | Double-click | Terminal |
| --- | --- | --- |
| Run in development | `Launch Campus.command` | `npm install` then `npm run tauri dev` |
| Build the permanent app | `Build Mac App.command` | `npm run tauri build` |
| Open project in Finder | `Open Project Folder.command` | `open .` |
| Erase saved campus data | `Reset Local Data.command` | — |

**Output locations after `npm run tauri build` (relative to the project root):**

- `.app` → `src-tauri/target/release/bundle/macos/Obsidian Campus.app`
- `.dmg` → `src-tauri/target/release/bundle/dmg/Obsidian Campus_0.1.0_aarch64.dmg`
  (`_x64` on Intel Macs)

First launch of the built app: **right-click → Open** (it is unsigned; this is
normal for private local use and needs no paid developer account). Signing and
notarisation only matter if you later distribute the app to other people.

## Required free software

- Node.js 20+ (`brew install node`)
- Rust via rustup (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- Xcode Command Line Tools (`xcode-select --install`)

**Optional software:** Homebrew (easiest way to install Node), Ollama (only
for a future local-model phase — not used by the current version).

## What state the app restarts into

The app relaunches into the **running offline simulation** — safe by design,
because simulated agents take no external actions, call no services, and cost
nothing. Pause and Emergency Stop are always one click away in the top bar,
and Emergency Stop fully halts agents and task movement until you clear it.

## Data, backups, restore

- All data lives in `~/Library/Application Support/com.obsidiancampus.app/campus.sqlite`.
- The app automatically keeps the **last 20 revisions** of the campus in that
  database (`revisions` table) — several rolling backups, never just one.
- **Export / Import**: Settings → Data → Export Data (portable JSON) and
  Import Data (asks for confirmation before overwriting).
- **Restore a revision**: the supported path is export/import; direct
  restoration is `sqlite3 campus.sqlite "SELECT value FROM revisions ORDER BY id DESC LIMIT 5"`,
  then import the chosen JSON via Settings → Data.

## Feature status

**Fully working (verified):**
- Isometric campus with ten configurable buildings, central plaza, monument
- Agents: movement, pathfinding, 14 visual states, labels, inspection
- Task lifecycle with visual packets; simulated approvals; collaboration
- Camera: pan, cursor-anchored zoom, focus building/agent, return to plaza
- Building status lighting; day/night themes; optional weather
- Pause, Resume, Emergency Stop (and recovery)
- Owner Command Suite (approvals, override, monitors)
- SQLite persistence with automatic revisions; settings survive restart
- Export/Import, diagnostics panel with copy, graceful DB-failure fallback
- Renamable agents/buildings; no fixed roles; all names are placeholders

**Simulated (by design, this phase):**
- All agent intelligence — the deterministic local simulation drives every
  agent. No AI service exists in the code path.

**Not yet connected (future phases):**
- Real AI providers (Local Model / Ollama / Claude / Custom) — the Settings →
  AI Provider section stores the preference only
- Building interiors (cutaway view), drag-and-drop layout editor
- In-app revision browser (backups exist; UI for browsing them does not)

**Failed tests:** none — 164/164 frontend tests and 4/4 Rust tests pass.

## Was it tested on macOS?

**No — this preparation environment is Linux.** Everything that can be
verified off-macOS was verified here:

- `npm install`, `npm run typecheck`, `npm test`, `npm run build` — all pass
- `cargo test` / release compile of the Rust backend — pass
- `npm run tauri build` — completes end-to-end (Linux bundles: .deb/.rpm/.AppImage)
- The **packaged desktop binary** was launched under a virtual display: campus
  renders, SQLite persistence confirmed across a restart, tasks/approvals flow

The final `.app` and `.dmg` **must be built on your Mac** (`npm run tauri
build` or `Build Mac App.command`) — Tauri cannot produce macOS bundles from
Linux. So: **final build not yet verified on macOS**; the pipeline it runs is.

## Known limitations

See [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) for the full list. Headlines:
frame rate is unmeasured on real Mac hardware (this environment has no GPU);
building interiors are implied rather than modelled; the layout editor UI is
not built yet (the data model and collision detection are).

## Cost verification

The default configuration was checked end-to-end for cost: no network calls
to AI services exist in the codebase, no API keys are requested or stored, no
billing can be enabled, offline simulation is the schema default, and every
dependency (Tauri, React, TypeScript, PixiJS, SQLite, Vite, Zustand, Vitest)
is free and open source. Running this app costs nothing beyond electricity.
