import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
export const RUNS_DIR = path.join(REPO_ROOT, "runs");

function slugify(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

/**
 * Copies one agent run's transcript, summary, output, and screenshots into a persistent,
 * committed runs/<id>/ directory — a run-agent.js result's workDir is an os.tmpdir() scratch
 * space that can vanish at any time, so this is the only durable record of what actually
 * happened. Meant to accumulate in git history across commits as a real audit trail, not to be
 * squashed or gitignored — a run here isn't gospel, but it's a real data point.
 *
 * `runGroup` is an opaque id shared by every run dispatched together in one batch (e.g. the
 * tooled/baseline pair for one fixture) so the report can render them side by side as a unit
 * instead of just by recency. Omit it for a standalone run — the report falls back to treating
 * the run as its own singleton group.
 */
export function recordRun(run, { fixture, condition, runGroup }) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dirName = `${timestamp}_${slugify(fixture)}_${run.model}_${condition}`;
  const runDir = path.join(RUNS_DIR, dirName);
  fs.mkdirSync(runDir, { recursive: true });

  // Identifies which exact prompt text produced this run without opening prompt.md — the prompt
  // files keep changing as we iterate, so a bare agent name doesn't tell you what it said at the
  // time. Two runs sharing this hash used the byte-identical system prompt; a differing hash is
  // the fast way to notice a prompt edit landed between two otherwise-comparable runs.
  const promptHash = run.systemPrompt
    ? crypto.createHash("sha256").update(run.systemPrompt).digest("hex").slice(0, 8)
    : null;

  const meta = {
    fixture,
    condition,
    runGroup: runGroup ?? null,
    agentName: run.agentName,
    model: run.model,
    totalCostUsd: run.totalCostUsd,
    isError: run.isError,
    toolCallCount: run.toolCalls.length,
    screenshotCount: run.screenshots?.length ?? 0,
    promptHash,
    recordedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(runDir, "meta.json"), JSON.stringify(meta, null, 2));

  const transcript = {
    toolCalls: run.toolCalls,
    resultText: run.resultText,
  };
  fs.writeFileSync(path.join(runDir, "transcript.json"), JSON.stringify(transcript, null, 2));

  if (run.systemPrompt) {
    fs.writeFileSync(path.join(runDir, "prompt.md"), run.systemPrompt);
  }

  if (run.cloneHtml) {
    fs.writeFileSync(path.join(runDir, "clone.html"), run.cloneHtml);
  }

  if (run.screenshots?.length) {
    const shotsDir = path.join(runDir, "screenshots");
    fs.mkdirSync(shotsDir, { recursive: true });
    for (const srcPath of run.screenshots) {
      fs.copyFileSync(srcPath, path.join(shotsDir, path.basename(srcPath)));
    }
  }

  return runDir;
}
