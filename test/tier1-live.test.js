import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { runAgentAgainstUrl } from "./lib/run-agent.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "..", "fixtures");
// Real pages are heavier than our synthetic fixtures — more investigation,
// more tool calls, longer runs. Default budget/timeout are both higher than
// the local-fixture suites.
const MAX_BUDGET_USD = Number(process.env.GUMSHOE_LIVE_MAX_BUDGET_USD ?? 3.0);
// Override both agents' model (default: whatever each .claude/agents/*.md
// frontmatter declares, currently sonnet for both) — e.g. GUMSHOE_MODEL=haiku
// to see whether tool access matters more or less for a smaller model.
const MODEL = process.env.GUMSHOE_MODEL || undefined;

const fixtureNames = fs
  .readdirSync(FIXTURES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

for (const name of fixtureNames) {
  const manifestPath = path.join(FIXTURES_DIR, name, "manifest.yaml");
  if (!fs.existsSync(manifestPath)) continue;

  const manifest = yaml.load(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest.tier1?.live) continue;

  test(`tier1-live: ${name}`, { timeout: 20 * 60 * 1000 }, (t) => {
    t.diagnostic(`Live fixture, purely observational — no pass/fail against a known answer: ${manifest.url}`);

    for (const agentName of ["cloner", "cloner-baseline"]) {
      const label = agentName === "cloner" ? "tooled" : "baseline";
      const run = runAgentAgainstUrl(manifest.url, { agentName, maxBudgetUsd: MAX_BUDGET_USD, live: true, model: MODEL });

      t.diagnostic(`[${label}] model: ${run.model} — cost: $${run.totalCostUsd} — isError: ${run.isError} — workDir: ${run.workDir}`);

      const calls = run.toolCalls.map((c) => `${c.name} ${c.input?.command ?? c.input?.file_path ?? ""}`);
      t.diagnostic(`[${label}] tool calls (${run.toolCalls.length}):\n  ${calls.join("\n  ")}`);

      t.diagnostic(`[${label}] clone.html produced: ${!!run.cloneHtml}${run.cloneHtml ? ` (${run.cloneHtml.length} chars)` : ""}`);
      t.diagnostic(`[${label}] agent's own summary:\n${run.resultText}`);

      t.assert.ok(!run.isError, `[${label}] agent errored out entirely: ${run.resultText}`);
    }
  });
}
