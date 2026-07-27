# Limitations and next phase

## What was verified

Run in a headless Chromium against the production bundle, plus the automated
suites:

- The application builds (`tsc --noEmit` clean, `vite build` clean).
- The campus loads, and all ten buildings, eighteen agents and the plaza render.
- Agents move: pathfinding, walking, transport modes, elevators, entering and
  leaving buildings.
- States change and drive visuals across all fourteen states.
- Building status changes drive window luminance, plinth wash and beacons.
- Settings persist across a reload — campus name, lighting, weather, theme and
  every toggle came back after a full page reload from the storage backend.
- Emergency stop works: every agent goes offline, packets clear, buildings go
  dark, the monument dims, and the state is recoverable.
- Camera controls work: pan, cursor-anchored zoom, fly-to-building,
  follow-agent, return-to-plaza, frame-campus.
- 164 unit tests pass; 3 Rust SQLite tests pass.

## What was *not* verified, and why

**Frame rate on real hardware.** This container has no GPU — Chromium fell back
to SwiftShader software rasterisation, which reported ~10 fps. That number says
nothing about a Mac. The performance work is real (retained-mode graphics,
cached textures, culling, LOD tiers, 5 Hz React mirroring) but the 60 fps claim
is unmeasured. **Measure this first on your machine**, and use the FPS readout
in the top bar and the Owner Suite's renderer panel.

**The macOS `.app` and `.dmg`.** Tauri cannot cross-compile to macOS: the
bundle layout, `hdiutil` and `codesign` are macOS-only, so `npm run tauri build`
has to run on the Mac. See the README for the output paths and the Gatekeeper
step an unsigned build requires.

What *was* verified on the Linux host, after installing the GTK/WebKit system
libraries Tauri needs there:

- The Rust backend compiles clean in both debug and release.
- `tauri.conf.json` validates, the generated icon set resolves (including
  `icon.icns` for macOS), and the frontend `dist` wiring is correct.
- The SQLite persistence layer compiles and its tests pass.

None of that touches macOS-specific packaging, so budget a little time for
toolchain setup on the first `tauri build` — chiefly installing Rust via rustup
and the Xcode Command Line Tools.

**Sound.** The synthesised sound design is implemented and wired to events, but
audio cannot be captured in this environment. It is off by default; enable it in
Settings and expect to tune levels.

---

## Known limitations

### Visual

- **Agent label collision.** Labels are counter-scaled and never overlap the
  figure, but two agents standing close together will overlap each other's name
  plates. There is no de-collision pass yet.
- **Labels hide at full-campus zoom.** Below 0.3× the state indicator still
  draws (so agents remain locatable and their state readable), but name plates
  are suppressed — eighteen overlapping labels at that scale would be less
  readable than none. Selected and hovered agents always keep theirs.
- **Interiors are implied, not modelled.** Agents inside a building are drawn
  over the facade at reduced opacity with interior light behind them. There are
  no interior floor plans, no cutaway view, and no drawn rooms. "Enter a
  building and see inside" is the largest visual gap.
- **No true reflections.** Water has animated specular streaks and a coping
  detail, but buildings are not mirrored in it.
- **Day mode is under-designed.** It works and is legible, but night got the
  design attention. Day currently reads as "night with a lighter sky".
- **Shadows are contact shadows only** — soft ellipses under agents and trees.
  Buildings do not cast directional shadows across the campus.
- **Skybridges do not carry traffic.** They are architecture; agents route
  around at ground level rather than crossing them.

### Functional

- **Layout editing is partial.** Names, codes, architecture, accent, dress
  code and building assignment are editable from the inspector. Moving,
  resizing, adding or deleting buildings is supported by the data model,
  the schema normaliser and the renderer's rebuild path — but there is no
  drag-to-place editor UI yet. `findFootprintCollisions` exists and is tested,
  ready for that editor to call.
- **No agent add/remove UI.** The roster is seeded from configuration and the
  simulation handles agents appearing and disappearing on rebuild, but there is
  no button for it.
- **Approvals auto-resolve by default.** So an unattended campus keeps flowing.
  Turn off "Auto-resolve stale approvals" in Settings to make every approval
  genuinely require you.
- **Performance mode partially needs a restart.** Ticker cap and particle
  density apply immediately; renderer resolution applies on next launch.
- **Reserved expansion plots are decorative.** They render as dark surveyed
  land and block pathfinding, but nothing can be built on them yet.
- **No undo.** The SQLite backend retains 20 revisions per document and
  `list_revisions` is implemented, but nothing in the interface surfaces them.

### Technical

- **Single campus.** The document models one campus; multi-campus and
  underground/rooftop levels are not represented.
- **The task packet retirement window is time-based** (20 s), not capacity-based.
- **`localStorage` quota** is not surfaced to the user; if a write fails the
  campus keeps running from memory without warning.

---

## Recommended next phase

In priority order.

**1. Building interiors.** The single biggest jump in perceived quality. When
the camera passes a zoom threshold on a focused building, fade the near facade
and reveal a floor plate with rooms, workstations and agents laid out inside.
The data is already there — `RoomConfig` carries level, anchor, kind and
capacity, and agents already track `locationId` and elevation. This is a
rendering feature, not a modelling one.

**2. The layout editor.** Drag to move buildings, handles to resize, a palette
to add from the ten archetypes, and a path/landscaping brush. Everything
downstream already supports it: the document is normalised on load, the
simulation rebuilds and rescues stranded agents, the renderer rebuilds the
scene, and collision detection is written and tested. This is the feature that
turns the campus from *yours to look at* into *yours to shape*.

**3. The backend seam.** Before real agents arrive, prove the seam works:
implement a second `CampusSimulation`-shaped class driven entirely by
`bus.ingest()` from an external process, and run the campus off a scripted
event log. Doing this *before* wiring real tools is what guarantees the visual
layer never quietly acquires authority over agent behaviour.

**4. Performance validation on your Mac.** Measure with the full campus in
frame, then again with the roster scaled to 60+ agents. Sprite batching for
agents and a quadtree for culling are the obvious next steps if the numbers
demand them — but measure before building either.

**5. Visual polish pass.** Directional building shadows, water reflections, a
proper day grade, and label de-collision. Individually small; together they are
what separates "very good" from "I'd leave this open on my second monitor".
