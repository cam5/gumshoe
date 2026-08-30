import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Runs an LLM judge call: pure text in, structured verdict out. Unlike
 * runAgent (test/lib/run-agent.js), the judge is deliberately given no tool
 * access at all (--tools "") — everything it needs is embedded directly in
 * the prompt, so there's no filesystem to wander and nothing to isolate it
 * from. It's fine, expected even, for the judge to see a fixture's
 * expectedOutcome/rubric text — grading against it is the whole job, unlike
 * the agent-under-test, which must never see it.
 */
export async function runJudge({ prompt, jsonSchema, model = "sonnet", maxBudgetUsd = 0.5 }) {
  const args = [
    "-p",
    prompt,
    "--model",
    model,
    "--tools",
    "",
    "--output-format",
    "json",
    "--permission-mode",
    "bypassPermissions",
    "--json-schema",
    JSON.stringify(jsonSchema),
    "--max-budget-usd",
    String(maxBudgetUsd),
    "--no-session-persistence",
  ];

  // Async, not execFileSync: this runs inside tier2's concurrent worker pool alongside many
  // agent runs at once -- a synchronous call here would stall every other in-flight run too.
  const { stdout: raw } = await execFileAsync("claude", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
  });

  const messages = JSON.parse(raw);
  const result = messages.find((m) => m.type === "result");
  if (result?.is_error) {
    throw new Error(`Judge call failed: ${result.result}`);
  }

  return JSON.parse(result.result);
}
