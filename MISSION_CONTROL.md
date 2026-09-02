# Mission Control

How the upgraded Obsidian Campus works: one Manager, nine assignable workers,
and real missions that produce real deliverables.

Everything here runs free and local. Nothing in this document requires an
account, a key, or a network connection.

---

## The one-minute version

1. Open the app.
2. Click **Mission Control** in the top bar (or press <kbd>M</kbd>).
3. Click **New Mission**, describe what you want in plain English, click
   **Start Mission**.
4. Watch it happen — on the dashboard, or on the campus itself.
5. When it finishes, click **View Results**.

That's the whole loop. Everything below is detail.

---

## Who does what

The campus has **ten agents, and only ten**. The roster is capped: the app will
not create an eleventh, and a configuration that contains more is trimmed on
load (extras are *archived*, never deleted).

**One agent is the Manager.** By default that's Agent 01. The Manager doesn't do
the work — it plans, delegates, monitors, reviews, recovers from failures, and
combines the finished pieces into one deliverable.

**The other nine have no permanent role.** This is deliberate and it is
enforced in the data model: an agent's configured `role` is just a label you
control, and nothing the system does ever writes to it. Mission roles live in a
separate `assignments` table, are attached when the Manager hands out work, and
are **cleared the moment the mission ends**. Agent 04 might be a Researcher this
morning and a Reviewer this afternoon.

### Changing the Manager

Mission Control → **Agents** table → **Make Manager** on any row. The change is
immediate and permanent until you change it again. There is always exactly one.

---

## Starting a mission

**New Mission** asks one real question: *what do you want accomplished?* Write it
the way you'd write it to a person. Long, multi-step goals are the point:

> Research this opportunity, create a plan, build the necessary files, have the
> work reviewed, and give me the completed result by tomorrow.

Optional, all with sensible defaults:

| Field | What it does |
| --- | --- |
| **Deadline** | No deadline, in an hour, end of today, tomorrow, in three days. Drives urgency and the deadline warning. |
| **Priority** | Low / Normal / High / Urgent. |
| **AI** | Which models the router may use. See below. |
| **Attachments** | Up to six files. Text and images are read and handed to the agents; anything too large is carried by name only. |

Attaching an image makes the plan start with an inspection step, so the picture
is looked at before anything is built on top of it.

---

## What the Manager actually does

This is not a progress bar over a fake process. Every step below writes real
rows you can inspect.

1. **Plans.** Breaks the goal into ordered subtasks with dependencies. Uses a
   model if one is available and a built-in planner otherwise, so planning
   works with no AI installed at all. Dependencies may only point backwards,
   which makes a circular plan structurally impossible rather than merely
   unlikely.
2. **Delegates.** Creates a real subtask, assigns a real agent, gives it a
   temporary role, and records who assigned it. Work is spread across the
   bench: proven skill leads, mission continuity is a mild preference, and
   current load is a penalty — so a mission doesn't land entirely on one agent.
3. **Routes.** Picks a model per subtask (see Smart Router).
4. **Monitors.** Tracks progress, flags a mission that will miss its deadline.
5. **Reviews.** A *different* agent checks each piece of work. A rejected piece
   goes back for revision — at most twice, then it comes to you rather than
   looping.
6. **Recovers.** A failed step is retried up to twice with a different seed. If
   it still fails, the Manager reassigns or escalates. There is no path that
   retries forever.
7. **Combines.** Merges the finished pieces into one deliverable you can read,
   copy or download.
8. **Tells you.** A macOS notification when a mission completes, needs your
   approval, is blocked, or is running out of time.

At most three subtasks run at once.

---

## Smart Model Router

Five modes, chosen per mission (or as a default in Settings):

| Mode | Behaviour |
| --- | --- |
| **AUTO — FREE ONLY** *(default)* | Only free and local models. **Never** a paid API. |
| **AUTO — BEST BALANCE** | Weighs quality, speed and cost. |
| **AUTO — FASTEST** | The quickest model that can do the job. |
| **AUTO — BEST QUALITY** | The strongest model that can do the job. |
| **MANUAL** | Each agent's own configured default. |

**The free-only guarantee is structural, not a preference.** Paid models are
filtered out of the candidate set *before* any scoring happens. If FREE ONLY is
selected and no free model can do the work, the router refuses and says so —
it does not quietly fall back to something that costs money. There are
adversarial tests for exactly this.

Every routing decision carries a plain-English reason, visible on the subtask:

> *Selected because the task involves an image, local execution is sufficient,
> and FREE ONLY is active.*

### Learning

The campus records how each model performs per task kind — success rate,
latency, review pass rate — and prefers what has worked. Statistics need at
least three attempts before they count for anything.

Learning affects **model preference only**. Constraints are evaluated first, so
nothing the campus learns can widen what it is permitted to do. It cannot relax
FREE ONLY, and it cannot touch a spending limit.

---

## Brains

| Provider | Cost | Status |
| --- | --- | --- |
| **Offline Simulation** | Free | Built in, always available. |
| **Ollama (local)** | Free | Used automatically if it's running. |

**Offline Simulation** is the default and needs nothing installed. It produces
structured, plausible deliverables so the whole system is exercisable — and
every artefact it writes is stamped **`[Simulated · offline campus]`** so its
output can never be mistaken for real analysis.

**Ollama** gives you genuine local model output, still free and still offline.
Install it from [ollama.com](https://ollama.com), then:

```bash
ollama serve
ollama pull llama3.2      # or any model you prefer
```

The campus probes for it every 30 seconds — start it any time and it appears in
the **System** card without a restart. Models are inspected for capability
(vision, context size, reasoning strength, speed) from their name and parameter
count, so the router can choose sensibly among whatever you've pulled.

**Paid providers are not connected.** The architecture has a slot for them —
one adapter file plus one line of registration — but nothing in this build can
create a charge. No key is requested, stored, or read. If you add one later,
put it in the macOS Keychain, never in a file in this repository.

---

## The Command Dashboard

| Card | Shows |
| --- | --- |
| **Active Mission** | The goal, stage, deadline, progress, every subtask with its agent, role and model, and a live mission log. Expand a subtask to read its output. |
| **Needs My Attention** | Approvals and escalations, with Approve / Decline inline. |
| **Agents** | All ten: temporary mission role, current task, model in use, live status. **Make Manager** here. |
| **Upcoming** | Queued work and what it's waiting on. |
| **Completed** | Finished missions — click through to the result. |
| **System** | Which brains are available, routing mode, database health, automation state. |

---

## The campus reflects real work

When a mission is running, the campus map is showing **that mission**. Agents
walk to the building their real subtask belongs to, their state is the real
subtask's state, and the label above them is the real model they're using.

Ambient activity — the invented tasks that keep an idle campus feeling alive —
**stops completely** while real work exists. It cannot overlap with or be
mistaken for a mission. If you'd rather the campus only ever show real work,
turn off **Settings → Motion → Simulated work when idle**.

---

## Ask Agent 01

The gold button, bottom right of every screen. The Manager answers from actual
campus state, never invented status. Ask it:

- *What's happening?* — real running work, real progress
- *Why is this taking so long?* — the actual blocking step
- *What do you need from me?* — real pending approvals
- *What have you learned?* — what's in memory and how confident it is
- *Which AI are you using?* — the real routing decisions

Some phrases are commands and genuinely change things:

- *"Use only free AI"* → switches routing to FREE ONLY
- *"Be fastest"* / *"Best quality"* → switches routing mode
- *"Finish this by 6"* → sets the active mission's deadline
- *"Cancel this mission"* → cancels it

---

## Knowledge Vault

Three separate scopes, and they do not leak into each other:

- **Shared** — every agent can retrieve it
- **Mission** — only agents working that mission
- **Agent** — only that one agent

Mission results are filed automatically. Attachments become mission knowledge.
Retrieval is budgeted (about 6,000 characters, at most four entries per task)
so context stays focused rather than dumping everything into every prompt.

### Manager memory

Separate from the vault: the Manager's own observations about how work goes —
which agents do well at what, which models are reliable, what tends to fail.

Memory **decays**. Confidence halves roughly every fortnight, so a single old
observation stops driving decisions. Repeated observations resist decay.
Confidence never reaches certainty (0.95 is the ceiling) — the Manager is never
allowed to assume that what was true once is still true.

---

## Workflows

**Workflows** builds reusable sequences on a visual canvas: click a node type to
add it, click two nodes to connect them. Fifteen node kinds cover research,
analysis, writing, building, review, testing, approval gates, branches and
loops. Save a workflow and run it as a mission whenever you want the same shape
of work repeated.

---

## Control

- **Pause All** (dashboard) — stops the campus and all mission work
- **Emergency Stop** (Owner Suite, campus screen) — hard halt until cleared
- **Cancel Mission** — stops one mission, releases its agents, clears its roles

The owner's controls outrank the Manager. While the campus is paused or
stopped, no mission work runs and the map shows no mission activity.

---

## Where things live

| What | Where |
| --- | --- |
| Everything | `~/Library/Application Support/com.obsidiancampus.app/campus.sqlite` |
| Rolling backups | the `revisions` table in that file — the last 20 |
| Export / Import | Settings → Data |

Missions, subtasks, outputs, knowledge, memory and model statistics all survive
a restart. Temporary role assignments deliberately do not — they belong to a
mission, and the mission is over.

---

## Upgrading an existing campus

Nothing to do. An older campus file is migrated on load: new fields are added
with sensible defaults, existing agents, buildings, settings and layout are
untouched, and the schema version is stamped. The one change that removes
anything — the ten-agent cap — archives the extra agents into
`archivedAgents` rather than deleting them, and tells you it did.

Migration is additive and lossless by design. Your campus is not rebuilt.
