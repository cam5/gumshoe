import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { runAgent } from "./lib/run-agent.js";
import { screenshotUrl, diffScreenshots } from "./lib/screenshot.js";
import { runJudge } from "./lib/judge.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "..", "fixtures");
const MAX_BUDGET_USD = Number(process.env.GUMSHOE_MAX_BUDGET_USD ?? 1.0);
// How many independent runs per condition per fixture. Issue #3 calls for
// >=3 to average out model/judge variance; default to 1 here so a first
// pass (and any re-run of this file) stays cheap while the mechanism is
// still being validated. Override with GUMSHOE_TIER2_REPEATS=3 for a real
// tooled-vs-baseline comparison run.
const REPEATS = Number(process.env.GUMSHOE_TIER2_REPEATS ?? 1);

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

for (const name of fixtureNames) {
  const fixtureDir = path.join(FIXTURES_DIR, name);
  const manifestPath = path.join(fixtureDir, "manifest.yaml");
  if (!fs.existsSync(manifestPath)) continue;
  // Live fixtures (a real URL, no local page.html) run only via
  // `npm run test:live` — this suite stays fast/reproducible against local fixtures.
  const manifest = yaml.load(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.tier1?.live) continue;

  test(`tier2: ${name}`, { timeout: 20 * 60 * 1000 }, async (t) => {
    const originalUrl = `file://${path.join(fixtureDir, "page.html")}`;
    const originalPng = await screenshotUrl(originalUrl);

    for (const agentName of ["cloner", "cloner-baseline"]) {
      const label = agentName === "cloner" ? "tooled" : "baseline";

      for (let i = 0; i < REPEATS; i++) {
        const run = runAgent(fixtureDir, { agentName, maxBudgetUsd: MAX_BUDGET_USD });
        t.assert.ok(!run.isError, `[${label} run ${i}] agent errored: ${run.resultText}`);
        t.assert.ok(run.cloneHtml, `[${label} run ${i}] no clone.html produced`);
        if (!run.cloneHtml) continue;

        const cloneHtmlPath = path.join(run.workDir, "clone.html");
        const clonePng = await screenshotUrl(`file://${cloneHtmlPath}`);
        const diff = diffScreenshots(originalPng, clonePng);
        t.assert.ok(diff.comparable, `[${label} run ${i}] screenshot render/compare failed: ${diff.note ?? ""}`);

        const quality = runJudge({ prompt: qualityJudgePrompt(run.cloneHtml), jsonSchema: QUALITY_JSON_SCHEMA });

        t.diagnostic(
          `[${label} run ${i}] cost=$${run.totalCostUsd} diffRatio=${diff.diffRatio.toFixed(4)} ` +
            `qualityScore=${quality.score}/10 (${quality.reasoning})`,
        );
      }
    }
  });
}
