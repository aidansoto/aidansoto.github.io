/**
 * Mission Control acceptance test.
 *
 * Drives the real production bundle through the twenty-three steps of the
 * acceptance criteria, using the actual UI — clicking real buttons, typing into
 * real fields — and asserting on real persisted state.
 *
 * Mission work is asynchronous, so nothing here sleeps for a fixed guess. The
 * script polls the persisted document and records everything it sees along the
 * way: some facts (temporary role assignments) are true only *during* a
 * mission, because they are cleared the moment it ends. Checking those against
 * the final state would report a passing behaviour as a failure.
 *
 * Playwright is deliberately NOT a dependency of this project — it would add a
 * browser download to every `npm install`, and nothing the application itself
 * does needs it. Install it only when you want to run this file:
 *
 *   npm install --no-save playwright && npx playwright install chromium
 *   npm run build
 *   npx vite preview --port 4173 &
 *   npm run acceptance
 */

import { chromium } from 'playwright';

const OUT = process.env.OUT ?? '.';
const URL = process.env.URL ?? 'http://localhost:4173';

const results = [];
const errors = [];
let step = 0;

function check(label, ok, detail = '') {
  step += 1;
  results.push({ step, label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(step).padStart(2)}. ${label}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({
  // CHROME_PATH lets a preinstalled build be used; otherwise Playwright's own.
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });

// The local Ollama probe is expected to fail here — no Ollama is installed in
// this environment — so its connection errors are not product failures.
const IGNORABLE = /ERR_CONNECTION_REFUSED|11434|favicon|status of 404/i;
page.on('console', (m) => {
  if (m.type() === 'error' && !IGNORABLE.test(m.text())) errors.push(`CONSOLE: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

/** Read the live campus document out of the running app. */
const doc = () => page.evaluate(() => JSON.parse(localStorage.getItem('obsidian-campus:campus.document') ?? 'null'));

/** Poll the persisted document until `pred` holds. Returns null on timeout. */
async function until(pred, timeoutMs = 60000, everyMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const d = await doc();
    if (d && pred(d)) return d;
    await page.waitForTimeout(everyMs);
  }
  return null;
}

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => document.querySelector('.boot.is-done') !== null, { timeout: 40000 });
await page.waitForTimeout(2500);

/* 1-3: open, roster, manager --------------------------------------- */
check('Application opens and the campus loads', await page.locator('.canvas-host canvas').isVisible());

let d = await doc();
check('No more than 10 agents', d.agents.length <= 10, `${d.agents.length} agents`);
check('One agent is designated Manager', Boolean(d.managerAgentId), d.managerAgentId);

/* 4: dashboard ------------------------------------------------------ */
await page.keyboard.press('m');
await page.waitForTimeout(800);
check('Command Dashboard opens', await page.locator('.screen-title', { hasText: 'Command Dashboard' }).isVisible());

/* 5-9: create the mission ------------------------------------------- */
await page.click('.btn:has-text("New Mission")');
await page.waitForTimeout(600);
check('New Mission dialog opens', await page.locator('#mission-goal').isVisible());

const GOAL = 'Research this opportunity, create a plan, build the necessary files, have the work reviewed, and give me the completed result by tomorrow.';
await page.fill('#mission-goal', GOAL);
check('A large multi-step goal can be entered', (await page.inputValue('#mission-goal')) === GOAL);

// Attach a real file through the real file input. Reading it is asynchronous,
// so wait for the row rather than guessing how long the read takes.
await page.setInputFiles('.modal input[type=file]', {
  name: 'brief.md',
  mimeType: 'text/markdown',
  buffer: Buffer.from('# Opportunity brief\nTarget: independent design studios.\nBudget: free tooling only.\n'),
});
const attached = await page
  .locator('.modal .row-title', { hasText: 'brief.md' })
  .waitFor({ state: 'visible', timeout: 10000 })
  .then(() => true, () => false);
check('A file can be attached', attached);

// AI select is the third select in the modal (deadline, priority, AI).
const aiSelect = page.locator('.modal select').nth(2);
await aiSelect.selectOption('auto_free');
check('AUTO — FREE ONLY can be selected', (await aiSelect.inputValue()) === 'auto_free');

await page.locator('.modal select').nth(0).selectOption('3'); // Tomorrow
check('A deadline can be set', (await page.locator('.modal select').nth(0).inputValue()) === '3');

const before = (await doc()).missions.length;
await page.click('.btn:has-text("Start Mission")');

d = await until((x) => x.missions.length > before, 30000);
const mission = d?.missions?.[d.missions.length - 1] ?? null;
check('Mission starts', Boolean(mission), mission?.title ?? 'none');
if (!mission) {
  console.log('\nAborting: the mission never reached the store.');
  await page.screenshot({ path: `${OUT}/mc-fail-no-mission.png` });
  await browser.close();
  process.exit(1);
}
check('Deadline was recorded', mission.deadline !== null);
check('Attachment was carried into the mission', mission.attachments?.length === 1);

/* 10-12: plan, roles, real subtasks ---------------------------------- */
d = (await until((x) => x.subtasks.some((s) => s.missionId === mission.id), 30000)) ?? d;
const planned = d.subtasks.filter((s) => s.missionId === mission.id).sort((a, b) => a.order - b.order);
check('Manager creates a plan', planned.length > 0, `${planned.length} subtasks`);
check('Plan inspects the attachment first', planned[0]?.kind === 'vision', planned[0]?.title);
check('Manager creates real subtasks with dependencies', planned.some((s) => s.dependsOn.length > 0));

/* Observe the mission as it runs. Temporary roles, routed models and live
   outputs exist only while work is in flight, so sample continuously. */
const seen = {
  assignments: [],
  routed: [],
  outputs: 0,
  reviewed: new Set(),
  selfAssigned: false,
  roleCellShown: false,
};
let finished = null;
const runDeadline = Date.now() + 180000;
let shot = false;

while (Date.now() < runDeadline) {
  d = await doc();
  const m = d.missions.find((x) => x.id === mission.id);
  const tasks = d.subtasks.filter((s) => s.missionId === mission.id);

  if (d.assignments.length > 0 && seen.assignments.length === 0) {
    seen.assignments = d.assignments.map((a) => a.roleLabel);
  }
  // Read the Mission Role column on every pass — a worker holds a temporary
  // role for only as long as its subtask runs, so one sample can easily miss it.
  if (!seen.roleCellShown) {
    seen.roleCellShown = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.agent-row:not(.agent-row-head)')).some((row) => {
        const role = row.querySelector('.agent-cell')?.textContent?.trim() ?? '';
        return role !== '' && role !== 'unassigned' && role !== 'Manager / CEO';
      }),
    );
  }
  for (const s of tasks) {
    if (s.modelId && !seen.routed.some((r) => r.id === s.id)) {
      seen.routed.push({ id: s.id, modelId: s.modelId, providerId: s.providerId, reason: s.routingReason });
    }
    if (s.output) seen.outputs += 0; // counted from the final document instead
    if (s.reviewerAgentId && s.reviewerAgentId !== s.assignedAgentId) seen.reviewed.add(s.id);
    if (s.assignedAgentId && s.assignedAgentId === d.managerAgentId) seen.selfAssigned = true;
  }

  if (!shot && tasks.some((s) => s.status === 'in_progress')) {
    shot = true;
    await page.screenshot({ path: `${OUT}/mc-10-mission-running.png` });
  }

  if (m && ['completed', 'failed', 'cancelled', 'awaiting_approval'].includes(m.status)) {
    finished = m;
    break;
  }
  await page.waitForTimeout(400);
}

d = await doc();
finished = finished ?? d.missions.find((x) => x.id === mission.id);
const missionTasks = d.subtasks.filter((s) => s.missionId === mission.id);
for (const s of missionTasks) {
  if (s.reviewerAgentId && s.reviewerAgentId !== s.assignedAgentId) seen.reviewed.add(s.id);
}
seen.outputs = missionTasks.filter((s) => s.output).length;

check('Manager assigns temporary roles to workers', seen.assignments.length > 0, seen.assignments.join(', '));
check('Manager never assigns work to itself', !seen.selfAssigned);

/* 13: routing -------------------------------------------------------- */
check('Smart Router selects a model per task', seen.routed.length > 0, seen.routed[0]?.modelId);
check(
  'Every routed model is free/local',
  seen.routed.every((r) => r.providerId === 'offline' || r.providerId === 'ollama'),
);
check('Routing decision is explained', Boolean(seen.routed[0]?.reason), seen.routed[0]?.reason);

/* 14-15: execution + dashboard --------------------------------------- */
check('Agents execute real tasks producing output', seen.outputs > 0, `${seen.outputs} outputs`);
check('Dashboard shows live temporary roles', seen.roleCellShown);

/* 16-18: review, progress, aggregation ------------------------------- */
check('One agent reviews another agent\'s work', seen.reviewed.size > 0, `${seen.reviewed.size} reviewed`);
check(
  'Manager tracked progress to completion',
  finished?.progress === 1,
  `${Math.round((finished?.progress ?? 0) * 100)}%`,
);
check('Manager combined the outputs into one deliverable', Boolean(finished?.finalResult));

/* 19: mission completes ---------------------------------------------- */
check('Mission completes', finished?.status === 'completed', finished?.status);

/* 20: notification --------------------------------------------------- */
// The owner's activity log lives on the campus screen, not the dashboard.
await page.click('.btn:has-text("Back to Campus")');
await page.waitForTimeout(900);
const notified = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.log-text')).some((n) => /Mission complete/i.test(n.textContent ?? '')),
);
check('Completion is announced to the owner', notified);

/* 21: result is viewable --------------------------------------------- */
await page.keyboard.press('m');
await page.waitForTimeout(700);
await page.click('.btn:has-text("View Results")');
await page.waitForTimeout(1200);
const resultVisible = await page.locator('.result-block').first().isVisible().catch(() => false);
check('The final result can be opened and read', resultVisible);
await page.screenshot({ path: `${OUT}/mc-11-results.png` });

/* 22-23: restart persistence ------------------------------------------ */
await page.waitForTimeout(1500);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => document.querySelector('.boot.is-done') !== null, { timeout: 40000 });
await page.waitForTimeout(2500);

const after = await doc();
const survived = after.missions.find((m) => m.id === mission.id);
check('Mission history survives a restart', Boolean(survived), `${after.missions.length} mission(s)`);
check('Mission outputs survive a restart', Boolean(survived?.finalResult));
check(
  'Temporary roles were cleared when the mission ended',
  after.assignments.filter((a) => a.missionId === mission.id).length === 0,
);
check('Agent roster is unchanged by the mission', after.agents.length === d.agents.length);
check('Result was filed in the Knowledge Vault', after.knowledge.some((k) => k.kind === 'result'));

/* Extra: controls ----------------------------------------------------- */
await page.keyboard.press('m');
await page.waitForTimeout(700);
await page.click('.btn:has-text("Pause All")');
await page.waitForTimeout(800);
const paused = await page.locator('.btn:has-text("Resume")').first().isVisible().catch(() => false);
check('Pause All works from the dashboard', paused);
if (paused) {
  await page.click('.btn:has-text("Resume")');
  await page.waitForTimeout(600);
}

// Emergency stop lives in the Owner Suite on the campus screen.
await page.click('.btn:has-text("Back to Campus")');
await page.waitForTimeout(800);
await page.click('.btn:has-text("Owner Suite")');
await page.waitForTimeout(700);
await page.click('.btn:has-text("Emergency Stop")');
await page.waitForTimeout(1200);
const stopped = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.status-chip')).some((n) => /Emergency Stop|Stopped/i.test(n.textContent ?? '')),
);
check('Emergency stop works', stopped);
await page.screenshot({ path: `${OUT}/mc-12-emergency-stop.png` });

await page.click('.btn:has-text("Clear Emergency Stop")');
await page.waitForTimeout(800);
await page.click('.owner-head .btn:has-text("Close")');
await page.waitForTimeout(500);

/* Extra: the other screens -------------------------------------------- */
await page.keyboard.press('m');
await page.waitForTimeout(700);
await page.click('.btn:has-text("Knowledge Vault")');
await page.waitForTimeout(900);
check(
  'Knowledge Vault opens with the mission result filed',
  await page.locator('.row-title', { hasText: 'Result:' }).first().isVisible().catch(() => false),
);
await page.screenshot({ path: `${OUT}/mc-13-vault.png` });

await page.click('.btn:has-text("Dashboard")');
await page.waitForTimeout(700);
await page.click('.btn:has-text("Workflows")');
await page.waitForTimeout(700);
await page.click('.btn:has-text("New Workflow")');
await page.waitForTimeout(900);
const nodeCount = await page.locator('.wf-node').count();
check('Workflow Builder creates and renders a workflow', nodeCount > 0, `${nodeCount} nodes`);
await page.screenshot({ path: `${OUT}/mc-14-workflows.png` });

/* Extra: manager chat -------------------------------------------------- */
await page.click('.btn:has-text("Back to Campus")');
await page.waitForTimeout(700);
await page.click('.chat-fab');
await page.waitForTimeout(600);
await page.click('.chat-chip:has-text("What\'s happening?")');
await page.waitForTimeout(900);
const chatReplied = (await page.locator('.chat-manager .chat-bubble').count()) > 0;
check(
  'Manager answers questions from real state',
  chatReplied,
  chatReplied ? (await page.locator('.chat-manager .chat-bubble').first().textContent())?.slice(0, 70) : '',
);

await page.click('.chat-chip:has-text("Use only free AI")');
await page.waitForTimeout(1200);
const afterChat = await doc();
check('Manager chat commands actually change settings', afterChat.settings.routingMode === 'auto_free');
await page.screenshot({ path: `${OUT}/mc-15-chat.png` });

/* Extra: window sizes -------------------------------------------------- */
for (const size of [{ width: 1280, height: 800 }, { width: 1024, height: 700 }, { width: 1920, height: 1080 }]) {
  await page.setViewportSize(size);
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.keyboard.press('m');
  await page.waitForTimeout(700);
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth <= window.innerWidth + 2,
    // Dead space: the cards must reach the right edge of the grid's content
    // box. The container's own padding is not dead space, so exclude it.
    gap: (() => {
      const grid = document.querySelector('.dashboard-grid');
      if (!grid) return 999;
      const pad = parseFloat(getComputedStyle(grid).paddingRight) || 0;
      const contentRight = grid.getBoundingClientRect().right - pad;
      const cards = Array.from(grid.children).map((c) => c.getBoundingClientRect().right);
      return Math.round(contentRight - Math.max(...cards));
    })(),
  }));
  check(`Dashboard fits at ${size.width}x${size.height}`, layout.overflow && layout.gap < 24, `dead space ${layout.gap}px`);
  await page.screenshot({ path: `${OUT}/mc-16-size-${size.width}.png` });
}

/* Report ---------------------------------------------------------------- */
console.log('\n=== SUMMARY ===');
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log('\nFAILURES:');
  for (const f of failed) console.log(`  ${f.step}. ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
}
console.log('\n=== CONSOLE ERRORS ===');
console.log(errors.length ? errors.slice(0, 10).join('\n') : 'none');

await browser.close();
process.exit(failed.length > 0 || errors.length > 0 ? 1 : 0);
