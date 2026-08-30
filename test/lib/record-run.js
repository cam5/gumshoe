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
 */
export function recordRun(run, { fixture, condition }) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dirName = `${timestamp}_${slugify(fixture)}_${run.model}_${condition}`;
  const runDir = path.join(RUNS_DIR, dirName);
  fs.mkdirSync(runDir, { recursive: true });

  const meta = {
    fixture,
    condition,
    agentName: run.agentName,
    model: run.model,
    totalCostUsd: run.totalCostUsd,
    isError: run.isError,
    toolCallCount: run.toolCalls.length,
    screenshotCount: run.screenshots?.length ?? 0,
    recordedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(runDir, "meta.json"), JSON.stringify(meta, null, 2));

  const transcript = {
    toolCalls: run.toolCalls,
    resultText: run.resultText,
  };
  fs.writeFileSync(path.join(runDir, "transcript.json"), JSON.stringify(transcript, null, 2));

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
