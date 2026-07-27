# Architecture

## The governing rule

**The visual layer never decides what an agent is allowed to do.**

The renderer reads two things — the campus *document* (what exists) and a
simulation *snapshot* (what is happening) — and draws them. It writes back
nothing. Every behavioural decision belongs to the simulation today and to a
real agent runtime later. This is why the seam is worth the indirection: when
the backend arrives, one class is replaced and no renderer code moves.

A second rule shapes the configuration: **nothing encodes what a building is
for or what an agent does.** Buildings carry a `name` and an architectural
`style`; agents carry a free-form `role` string. The simulation never branches
on either. "Memory Archive" is a label on a vault-shaped mass, not a function.

---

## Layers

```
                       ┌───────────────────────────┐
   user input ────────▶│      CampusRenderer       │
                       │  camera · scene · hit-test│
                       └─────────────┬─────────────┘
                                     │ reads snapshot
                       ┌─────────────▼─────────────┐
   ┌──── events ──────▶│     CampusSimulation      │
   │                   │ agent FSM · tasks · status│
   │                   └─────────────┬─────────────┘
   │                                 │ emits
   │                   ┌─────────────▼─────────────┐
   └───────────────────│         EventBus          │
                       └─────────────┬─────────────┘
                                     │ subscribed by
             ┌───────────────────────┼──────────────────────┐
             ▼                       ▼                      ▼
      activity log            sound engine            React interface
                                     
                       ┌───────────────────────────┐
                       │       CampusEngine        │  ← the only module that
                       │ persistence · wiring      │    knows all of the above
                       └─────────────┬─────────────┘
                                     ▼
                       SQLite (Tauri) │ localStorage (browser)
```

`src/state/engine.ts` is the single integration point. Everything else has one
job and no knowledge of its neighbours.

---

## The event contract

The simulation publishes events in exactly the shape a real backend would post
over IPC. `EventBus.ingest()` accepts the same JSON from any source and drops
malformed messages rather than throwing — a bad backend message must never take
down the renderer.

```json
{
  "event_type": "agent_state_changed",
  "timestamp": "2026-07-27T21:14:08.412Z",
  "payload": {
    "agent_id": "agent_001",
    "previous_state": "idle",
    "new_state": "working",
    "task_id": "task_001",
    "building_id": "building_002",
    "location_id": "workspace_004",
    }
}
```

Declared event types (`src/core/types.ts` → `CampusEventMap`):

| Event | Meaning |
| --- | --- |
| `agent_state_changed` | An agent entered a new state |
| `agent_moved` | An agent arrived at a new building or room |
| `task_created` | Work entered the campus |
| `task_stage_changed` | Work advanced through its lifecycle |
| `approval_requested` | An agent is blocked on the owner |
| `approval_resolved` | The owner approved or declined |
| `building_status_changed` | A building's derived status changed |
| `system_mode_changed` | Running / paused / emergency-stopped |
| `alert` | Free-form operator notice |

Subscribers: the activity log, the sound engine, and any panel that needs
push semantics. The renderer deliberately does **not** subscribe — it polls the
snapshot each frame, which is cheaper and never drops a frame's worth of state.

### Replacing the simulation with a real backend

1. Keep `CampusSimulation`'s public surface: `tick`, `snapshot`, `rebuild`,
   `setMode`, `emergencyStop`, `resolveApproval`, `setAgentState`, `approvals`.
2. Implement that surface over IPC, feeding inbound backend events through
   `bus.ingest()` and maintaining the same `AgentRuntime` / `TaskRuntime` maps.
3. Swap the constructor call in `CampusEngine.boot`.

No file under `src/render/` or `src/ui/` needs to change.

---

## Coordinate system

A 2:1 isometric diamond grid (`src/core/iso.ts`, fully unit-tested).

- `gridToScreen(x, y, height)` — x runs down-right, y runs down-left, height
  lifts straight up the screen.
- `screenToGrid(sx, sy)` — exact inverse at ground level.
- Depth key is `(x + y) * 1000 + height`. Height is weighted lightly on
  purpose: a 38-unit tower must never occlude something genuinely in front of
  it.

Three coordinate spaces, in order: **grid** (tiles) → **world-screen**
(unscaled pixels, what the scene graph uses) → **viewport** (device pixels,
after the camera transform).

---

## Camera

`src/render/camera.ts` is pure logic with no PixiJS import, which is what makes
its easing, clamping and focus behaviour testable.

- **Free movement** uses frame-rate-independent exponential damping, so the
  feel is identical at 30 and 120 fps.
- **Flights** (`flyTo`, `goHome`, `fitAll`, `focusBuilding`) use
  `easeInOutCubic` over a fixed duration — slow out, slow in, cinematic.
- **Follow** tracks a supplier function; when the supplier returns `null` the
  follow releases itself. Panning cancels follow immediately, because a camera
  that fights the owner's drag is worse than no follow at all.
- **Zoom** is anchored under the cursor and solved against the *target* pose,
  so repeated wheel ticks stay locked to the same world point.
- **Clamping** keeps the campus on screen with padding proportional to the grid.
- `reducedMotion` replaces every ease with a snap.

---

## Rendering pipeline

```
stage
├── atmosphere.backdrop   screen space — sky gradient, stars (parallax)
├── world                 camera transform applied here
│   ├── scene             depth-sorted by zIndex
│   │   ├── ground        terrain, plots, water, paving, light washes
│   │   ├── props (flat)  lamps, benches, signage, planters, bollards
│   │   ├── trees         sort against buildings — they have real height
│   │   ├── buildings     one BuildingView per config entry
│   │   ├── bridges       one Graphics per skybridge, sorted at its midpoint
│   │   ├── vehicles      shuttles, drones
│   │   ├── agents        figures, shadows, interior light
│   │   ├── monument      the plaza obelisk
│   │   └── tasks         packets and their light trails
│   └── labels            agent name plates — always above every building
└── atmosphere.foreground screen space — weather, haze, lightning
```

Anything with real height is added directly to `scene` rather than nested in a
sub-container, because a nested container sorts internally and then occupies a
single z-band in its parent — which breaks interleaving with the buildings.

### Buildings

`massesFor(style, footprint, height)` returns a stack of extruded prisms. Ten
archetypes produce ten distinct silhouettes from one shared material language:

| Style | Silhouette |
| --- | --- |
| `tower` | Stepped obsidian shaft, podium → shaft → crown → mast |
| `slab` | Low horizontal facility with a parapet |
| `lab` | Glass laboratory with a lit clerestory band |
| `bunker` | Battered secure mass with corner buttresses |
| `vault` | Unbroken block with deep silver ribs, no windows |
| `studio` | Sawtooth north-light roof |
| `cylinder` | True drum with wrapped glazing and an antenna array |
| `suite` | Narrow core lifting a cantilevered glass box |
| `hub` | Open transit canopy on slender columns |
| `annex` | Industrial block with a rooftop service gantry |

Every mass gets the same treatment: graphite body, obsidian curtain wall inset
from the structural edge, brushed silver parapet and corner columns, directional
shading (key light high and screen-left: top 1.0, left 0.72, right 0.44).

Windows are **ribbon glazing** — wide, shallow lights separated by slim
mullions. A square grid reads as a game asset; a horizontal band reads as a
curtain wall. Each light eases toward a target luminance so office lights fade
rather than blink, and only ~5% of them retarget per cycle.

### Agents

Figures are pre-rendered once into a four-frame walk cycle per suit palette,
supersampled 4× so they stay crisp when zoomed in. The dress system is enforced
in the factory, not at the call site:

- `suit_black` → black tailored suit, silver tie and lapel hairlines, silver pin
- `suit_alt` → the same tailoring in Deep Navy, Charcoal Blue, Graphite Blue or
  Dark Emerald; never black

Both builds share proportions; build B has narrower shoulders and slightly more
hair volume. No faces — at campus scale, facial detail reads as noise, and its
absence is what keeps the figures looking like executives rather than cartoons.

Agents inside a building are drawn *over* their host building at 62% opacity
with a cool tint and a pool of interior light behind them. Sorting them below
the building hides them entirely; drawing them opaque makes them look like they
are standing on the roof. Room anchors sit near the building perimeter — desks
at the glass — which is both architecturally truthful and visually correct.

---

## Simulation

`src/sim/simulation.ts`. Deterministic: every random decision draws from a
seeded `Rng`, so behaviour is reproducible and testable.

**Agent lifecycle.** Fourteen states, each with a duration range. Movement and
state are independent: while an agent is walking its state clock is suspended,
so nobody "finishes planning" halfway across the plaza. Arriving at a
destination triggers the intended next state.

```
idle → receiving_task → planning → working ⇄ using_tool
                                      ├──→ collaborating → working
                                      ├──→ blocked → working | failed
                                      └──→ reviewing → waiting_for_approval → completed
                                                     └──────────────────────→ completed
```

**Task lifecycle.** `inbound → routing → assigned → in_progress → review →
approval → archived`, with `failed` as the alternate terminal. Inbound work
arrives at the tallest building as a packet, arcs to a target building, and is
handed to a free agent there. Completed work flies to the vault-style building
and is retired after 20 seconds so the map never accumulates clutter.

**Movement.** A* over a navigation grid rasterised from the campus document,
with string-pulled paths so agents cut diagonals across the plaza instead of
stair-stepping. Walkways cost less than open ground, so traffic follows paving
without being scripted to. Rasterisation order matters and mirrors construction:
paving is laid, then water is cut through it, then building masses are set down.

Trips under 16 tiles are walked; longer trips ride a shuttle (2.2×) or tram
(3.4×); teleport is available as an opt-in visual setting. Vertical movement is
a separate mechanical ramp — the elevator — running at a fixed rate whether or
not the agent is still walking.

**Building status** is derived, never stored: blocked outranks approval, which
outranks productive, active and normal. Mode overrides everything.

---

## Performance

Target: smooth on a modern Mac at 1600×1000 with the full campus in frame.

| Technique | Where |
| --- | --- |
| Retained-mode Graphics, redrawn only on change | Buildings, ground, props |
| Slow-cadence redraws (420 ms / 900 ms by LOD) | Window luminance |
| Runtime-generated textures, cached and shared | Every sprite in the app |
| Pre-rendered figure atlases per suit | Agents |
| Off-screen culling with margin | Buildings, agents |
| LOD tiers by zoom | Signage, detail, trim, animation |
| Screen-space particle fields | Weather |
| React mirrors the sim at 5 Hz, not 60 | `syncSnapshot` |
| `maxFPS = 30` and resolution 1 in efficient mode | Ticker + renderer |

Lit windows are the one thing LOD never drops — they are what separates one dark
mass from another when the whole campus is in frame. LOD freezes their
animation instead of hiding them.

---

## Persistence

One JSON blob in a key/value SQLite table, with the last 20 revisions retained
per key. A normalised relational schema would have to be migrated on every
layout tweak during design work; the frontend already repairs whatever it reads
back, so a stale blob degrades gracefully and costs nothing.

Writes are debounced (700 ms) because dragging a slider would otherwise issue
hundreds of writes, and flushed on `beforeunload`.

In the browser the same interface is backed by `localStorage`, so the visual
work can be iterated without Rust in the loop.

---

## Testing

164 unit tests across seven files, plus three Rust tests for the SQLite layer.

| File | Covers |
| --- | --- |
| `iso.test.ts` | Projection, round-trip, depth ordering, rect maths |
| `camera.test.ts` | Zoom anchoring, clamping, easing, follow, fit, reduced motion |
| `navigation.test.ts` | Grid rasterisation, A*, smoothing, reachability of every room |
| `simulation.test.ts` | State machine, task lifecycle, approvals, pause, emergency stop |
| `config.test.ts` | Layout invariants, schema repair, migration, themes |
| `persistence.test.ts` | Round-trip, corrupt input, autosave debounce, event bus |
| `visuals.test.ts` | State vocabulary, dress rules, building geometry, colour maths |

The layout tests are load-bearing, not decorative: they assert that no two
footprints overlap, that no building sits in water or on a reserved plot, that
every entrance is outside its own mass, that the Command Tower is the tallest
structure, and that a route exists from the plaza to every room in every
building. Two of them caught real bugs during development — a Security Center
overlapping a reflecting pool, and paving overwriting water in the nav grid.
