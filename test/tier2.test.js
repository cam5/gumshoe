import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { runAgent } from "./lib/run-agent.js";
import { recordRun } from "./lib/record-run.js";
import { screenshotUrl, diffScreenshots } from "./lib/screenshot.js";
import { runJudge } from "./lib/judge.js";
import { runPool } from "./lib/pool.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "..", "fixtures");
const MAX_BUDGET_USD = Number(process.env.GUMSHOE_MAX_BUDGET_USD ?? 1.0);
// How many independent runs per condition per fixture. Issue #3 calls for
// >=3 to average out model/judge variance; default to 1 here so a first
// pass (and any re-run of this file) stays cheap while the mechanism is
// still being validated. Override with GUMSHOE_TIER2_REPEATS=3 for a real
// tooled-vs-baseline comparison run.
const REPEATS = Number(process.env.GUMSHOE_TIER2_REPEATS ?? 1);
// How many `claude` agent runs to have in flight at once. Each run is already isolated in its
// own tmpdir (see run-agent.js), and the underlying exec calls are async (not execFileSync), so
// nothing about running them concurrently is unsafe -- the only real ceiling is your account's
// API concurrency/rate limit, which is why this defaults conservatively rather than firing all
// 8 fixtures x 2 conditions x REPEATS at once. A full 3-repeat run went from ~2 hours sequential
// to a fraction of that at concurrency 4-6. Override with GUMSHOE_TIER2_CONCURRENCY.
const CONCURRENCY = Number(process.env.GUMSHOE_TIER2_CONCURRENCY ?? 4);
// All fixtures now spend money unconditionally before any node:test `test()` even registers (see
// the flat task list below), so `--test-name-pattern` can no longer cheaply skip fixtures the way
// it could when each fixture's agent runs happened inside its own test() callback. Use this
// instead for a one-fixture smoke test, e.g. GUMSHOE_TIER2_FIXTURE=card-grid-semantic.
const FIXTURE_FILTER = process.env.GUMSHOE_TIER2_FIXTURE;

const QUALITY_JSON_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number", description: "1-10, overall Tailwind/code quality" },
    reasoning: { type: "string" },
  },
  required: ["score", "reasoning"],
};

function qualityJudgePrompt(cloneHtml) {
  return `You are grading a single HTML file produced by an agent asked to clone a web page using Tailwind CSS (loaded via CDN, with a dynamically configured theme for off-scale values).

Grade ONLY code quality, on a 1-10 scale:
- Is repeated markup pulled into a named, reusable pattern (a component class or a consistent recipe), rather than the same long utility-class string copy-pasted many times?
- Is the Tailwind theme config (if present) minimal and non-redundant — no two near-duplicate custom values that should have been one token?
- Is the file otherwise clean, readable HTML?

Do NOT grade visual fidelity to any original page — you have not been shown one, and it is out of scope for this rating.

Respond with the required JSON shape only.

--- FILE TO GRADE ---
${cloneHtml}
--- END FILE ---`;
}

const fixtureNames = fs
  .readdirSync(FIXTURES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

// Build the full flat task list up front, across every fixture/condition/repeat, so all of it can
// run through one bounded concurrency pool instead of one fixture's queue at a time -- running 48
// sequential multi-minute `claude` calls one at a time is why a full 3-repeat run used to take
// ~2 hours. Every task for a given fixture shares that fixture's runGroup, same as before, so the
// report still clusters them as one batch.
const tasks = [];
for (const name of fixtureNames) {
  if (FIXTURE_FILTER && name !== FIXTURE_FILTER) continue;
  const fixtureDir = path.join(FIXTURES_DIR, name);
  const manifestPath = path.join(fixtureDir, "manifest.yaml");
  if (!fs.existsSync(manifestPath)) continue;
  // Live fixtures (a real URL, no local page.html) run only via
  // `npm run test:live` — this suite stays fast/reproducible against local fixtures.
  const manifest = yaml.load(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.tier1?.live) continue;

  const runGroup = crypto.randomUUID().slice(0, 8);
  for (const agentName of ["cloner", "cloner-baseline"]) {
    const label = agentName === "cloner" ? "tooled" : "baseline";
    for (let i = 0; i < REPEATS; i++) {
      tasks.push({ fixture: name, fixtureDir, agentName, label, i, runGroup });
    }
  }
}

// Screenshotting the original is cheap and purely local (no network, no model call), so it isn't
// worth pooling — do it once per fixture up front and let every task for that fixture share it.
const originalPngByFixture = new Map();
for (const name of new Set(tasks.map((t) => t.fixture))) {
  const fixtureDir = path.join(FIXTURES_DIR, name);
  originalPngByFixture.set(name, await screenshotUrl(`file://${path.join(fixtureDir, "page.html")}`));
}

async function runOneTask(task) {
  const { fixture, fixtureDir, agentName, label, i, runGroup } = task;
  const run = await runAgent(fixtureDir, { agentName, maxBudgetUsd: MAX_BUDGET_USD });

  if (run.isError || !run.cloneHtml) {
    const error = run.isError ? `agent errored: ${run.resultText}` : "no clone.html produced";
    console.log(`[${fixture}/${label} run ${i}] FAILED: ${error}`);
    return { task, run, error };
  }

  const cloneHtmlPath = path.join(run.workDir, "clone.html");
  const clonePng = await screenshotUrl(`file://${cloneHtmlPath}`);
  const diff = await diffScreenshots(originalPngByFixture.get(fixture), clonePng);

  let quality;
  try {
    quality = await runJudge({ prompt: qualityJudgePrompt(run.cloneHtml), jsonSchema: QUALITY_JSON_SCHEMA });
  } catch (err) {
    quality = { score: null, reasoning: `judge call failed: ${err.message}` };
  }

  // blankMatch alone fires on almost any real page -- most fixtures are >97% background color
  // even when correctly rendered. The actually-suspicious combination is a near-zero diffRatio
  // *together* with blankMatch: two near-blank screenshots pixel-matching "perfectly" regardless
  // of whether the clone has any real content at all (this is exactly what Tier 2's first real
  // run surfaced on every single "tooled" run, across all 8 fixtures).
  const suspiciouslyBlank = diff.comparable && diff.blankMatch && diff.diffRatio < 0.02;

  console.log(
    `[${fixture}/${label} run ${i}] cost=$${run.totalCostUsd} diffRatio=${diff.comparable ? diff.diffRatio.toFixed(4) : "n/a"} ` +
      `qualityScore=${quality.score}/10${suspiciouslyBlank ? " [SUSPICIOUSLY BLANK]" : ""}`,
  );

  run.screenshots = [...run.screenshots, cloneHtmlPath.replace(/clone\.html$/, "clone.png")];
  fs.writeFileSync(cloneHtmlPath.replace(/clone\.html$/, "clone.png"), clonePng);
  if (diff.diffPng) {
    fs.writeFileSync(cloneHtmlPath.replace(/clone\.html$/, "diff.png"), diff.diffPng);
    run.screenshots.push(cloneHtmlPath.replace(/clone\.html$/, "diff.png"));
  }

  recordRun(run, {
    fixture,
    condition: label,
    runGroup,
    metrics: {
      diffRatio: diff.comparable ? diff.diffRatio : null,
      diffComparable: diff.comparable,
      diffBoundingBox: diff.diffBoundingBox ?? null,
      blankMatch: suspiciouslyBlank,
      qualityScore: quality.score,
      qualityReasoning: quality.reasoning,
    },
  });

  return { task, run, diff, quality };
}

console.log(`tier2: running ${tasks.length} task(s) across ${new Set(tasks.map((t) => t.fixture)).size} fixture(s) at concurrency ${CONCURRENCY}...`);
const results = await runPool(tasks, CONCURRENCY, runOneTask);

// One node:test case per fixture, asserting against already-gathered results -- keeps the
// familiar per-fixture pass/fail reporting without re-running anything a second time.
for (const name of new Set(tasks.map((t) => t.fixture))) {
  test(`tier2: ${name}`, () => {
    const fixtureResults = results.filter((r) => r.task.fixture === name);
    for (const r of fixtureResults) {
      const { label, i } = r.task;
      assert.ok(!r.error, `[${label} run ${i}] ${r.error}`);
      assert.ok(r.diff.comparable, `[${label} run ${i}] screenshot render/compare failed: ${r.diff.note ?? ""}`);
    }
  });
}
