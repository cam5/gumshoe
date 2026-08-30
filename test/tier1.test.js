import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { runAgent } from "./lib/run-agent.js";
import { scoreTrajectory } from "./lib/score-trajectory.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "..", "fixtures");
const MAX_BUDGET_USD = Number(process.env.GUMSHOE_MAX_BUDGET_USD ?? 1.0);

const fixtureNames = fs
  .readdirSync(FIXTURES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

for (const name of fixtureNames) {
  const fixtureDir = path.join(FIXTURES_DIR, name);
  const manifestPath = path.join(fixtureDir, "manifest.yaml");
  if (!fs.existsSync(manifestPath)) continue;

  const manifest = yaml.load(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest.tier1) continue;

  test(`tier1: ${name}`, { timeout: 10 * 60 * 1000 }, (t) => {
    const run = runAgent(fixtureDir, { maxBudgetUsd: MAX_BUDGET_USD });
    t.diagnostic(`cost: $${run.totalCostUsd} — workDir: ${run.workDir}`);

    const calls = run.toolCalls.map((c) => `${c.name} ${c.input?.command ?? c.input?.file_path ?? ""}`);
    t.diagnostic(`tool calls:\n  ${calls.join("\n  ")}`);

    const score = scoreTrajectory(run.toolCalls, manifest.tier1);

    if (score.judge) {
      t.diagnostic(`NEEDS JUDGE REVIEW — not scored deterministically. Agent's own summary:\n${run.resultText}`);
      return;
    }

    for (const check of score.checks) {
      t.assert.ok(check.pass, `[${check.kind}] ${check.tool}: ${check.detail}`);
    }
  });
}
