# Final Handoff — Obsidian Campus

Everything you need to take this project, run it, and build it into a free
local Mac application.

New in this build: **Mission Control** — a Manager agent that genuinely plans,
delegates, reviews and delivers. See [`MISSION_CONTROL.md`](MISSION_CONTROL.md)
for how to use it. This document covers getting it running.

## The project

| | |
| --- | --- |
| **Project name** | Obsidian Campus (placeholder — rename any time in `src-tauri/tauri.conf.json` → `productName` and Settings → Campus Name) |
| **Project folder** | `aidansoto.github.io` (clone as `obsidian-campus` if you prefer: `git clone <repo> obsidian-campus`) |
| **GitHub repository** | `https://github.com/aidansoto/aidansoto.github.io` — **private**, branch `claude/mission-control-upgrade` |
| **Version** | 0.1.0 |
| **Operating mode** | Offline Simulation (default; free; no API keys; no network use) |

## Getting it running on your Mac

```bash
git clone https://github.com/aidansoto/aidansoto.github.io.git obsidian-campus
cd obsidian-campus
npm install
npm run tauri build
```

Then open `src-tauri/target/release/bundle/dmg/`, double-click the `.dmg`, drag
**Obsidian Campus** into Applications, and launch it from there. Pin it to the
Dock and it behaves like any other Mac app.

Or double-click the `.command` files instead of using Terminal:

| Action | Double-click | Terminal |
| --- | --- | --- |
| Run in development | `Launch Campus.command` | `npm install` then `npm run tauri dev` |
| Build the permanent app | `Build Mac App.command` | `npm run tauri build` |
| Open project in Finder | `Open Project Folder.command` | `open .` |
| Erase saved campus data | `Reset Local Data.command` | — |

**Output locations after `npm run tauri build`** (relative to the project root):

- `.app` → `src-tauri/target/release/bundle/macos/Obsidian Campus.app`
- `.dmg` → `src-tauri/target/release/bundle/dmg/Obsidian Campus_0.1.0_aarch64.dmg`
  (`_x64` on Intel Macs)

First launch of the built app: **right-click → Open**. It is unsigned, which is
normal for private local use and needs no paid developer account. Signing and
notarisation only matter if you later hand the app to other people.

### Required free software

- Node.js 20+ (`brew install node`)
- Rust via rustup (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- Xcode Command Line Tools (`xcode-select --install`)

**Optional:** Homebrew (easiest way to install Node), [Ollama](https://ollama.com)
(free local models — the campus picks it up automatically if it's running).

## First five minutes

1. Launch the app. The campus loads; ten agents, Agent 01 is the Manager.
2. Click **Mission Control** in the top bar.
3. **New Mission** → describe something real → **Start Mission**.
4. Watch the dashboard, or click **Back to Campus** and watch the agents work.
5. **View Results** when it finishes.

## What state the app restarts into

The app relaunches into the **running offline simulation**. That is safe by
design: simulated agents take no external actions, call no services, and cost
nothing. Missions do not resume automatically — finished ones stay finished and
their results stay readable. Pause and Emergency Stop are always one click away.

## Data, backups, restore

- All data lives in `~/Library/Application Support/com.obsidiancampus.app/campus.sqlite`.
- The app keeps the **last 20 revisions** in that database (`revisions` table)
  — several rolling backups, never just one.
- **Export / Import**: Settings → Data → Export Data (portable JSON) and Import
  Data (asks for confirmation before overwriting).
- **Restore a revision**:
  `sqlite3 campus.sqlite "SELECT value FROM revisions ORDER BY id DESC LIMIT 5"`,
  then import the chosen JSON via Settings → Data.

## Feature status

**Working and verified:**

*Campus* — isometric map with ten configurable buildings, plaza and monument;
agent movement and pathfinding; 14 visual states; persistent labels; camera pan,
cursor-anchored zoom and focus; building status lighting; day/night; weather;
Owner Command Suite; pause, resume, emergency stop.

*Mission Control* — Manager agent (changeable); ten-agent cap; dynamic
temporary roles cleared at mission end; real subtasks with dependencies;
cross-agent review with bounded revision; bounded retry and recovery; result
aggregation; Command Dashboard; Smart Model Router with the free-only guarantee;
performance learning; Knowledge Vault with three scopes; decaying Manager
memory; Workflow Builder; Manager conversation; macOS notifications.

*Platform* — SQLite persistence with automatic revisions; schema migration from
older campus files; export/import; diagnostics; graceful database-failure
fallback; the campus map mirrors real mission state.

**Simulated by default (and labelled as such):** agent intelligence. The offline
provider produces structured deliverables so everything is exercisable with
nothing installed, and stamps every artefact `[Simulated · offline campus]`.
Install Ollama for genuine local model output — still free, still offline.

**Not connected:** paid AI providers. The architecture has a slot for them; this
build cannot create a charge.

**Not built yet:** building interiors as a cutaway view; drag-and-drop layout
editor (the data model and collision detection exist, the UI does not); in-app
revision browser.

## What was tested, and how

**Automated:** 295 frontend tests across 12 files, 4 Rust tests. All pass.
`npm run typecheck` is clean. `npm run build` and `npm run tauri build` both
complete end to end.

**The 23-step acceptance run** in `tests/acceptance.mjs` drives the real
production bundle through the whole flow — clicking real buttons, typing into
real fields, asserting on real persisted state — and reports 42/42 checks with
zero console errors. To run it yourself:

```bash
npm install --no-save playwright && npx playwright install chromium
npm run build
npx vite preview --port 4173 &
npm run acceptance
```

**The packaged desktop binary** was launched under a virtual display and driven
by mouse through the full loop: open Mission Control → New Mission → type a goal
→ Start Mission → mission completes → quit → relaunch → the completed mission
and its deliverable are still there, loaded from SQLite. The database was
inspected directly to confirm the mission, subtask, assigned agent, model,
645-character result, knowledge entry, model statistics and memory fact all
persisted, and that temporary role assignments were correctly cleared.

**Not tested on macOS.** This preparation environment is Linux, and Tauri cannot
produce macOS bundles from Linux. The build *pipeline* is verified — it produces
`.deb`/`.rpm`/`.AppImage` here and will produce `.app`/`.dmg` on your Mac — but
the macOS bundles themselves have not been built or opened. That is the one step
that has to happen on your machine.

## Known limitations

See [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md). Headlines: frame rate is
unmeasured on real Mac hardware (this environment has no GPU); building
interiors are implied rather than modelled; offline-provider output is
structured placeholder prose, not analysis, which is why it is labelled.

## Cost verification

Checked end to end. No network calls to AI services exist in the codebase. No
API key is requested, stored or read. Billing cannot be enabled. Offline
simulation is the schema default and FREE ONLY is the default routing mode,
enforced as a filter rather than a preference. Every dependency — Tauri, React,
TypeScript, PixiJS, SQLite, Vite, Zustand, Vitest — is free and open source.

Running this app costs nothing beyond electricity.

## If you add a paid provider later

Nothing here needs changing to keep it free. If you do connect one:

- Store the key in the **macOS Keychain**, never in a file in this repository.
- Keep FREE ONLY as the default routing mode; switch per mission when you
  actually want to spend.
- The repository is private. Keep it that way unless you have a reason not to.
