import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const AGENTS_DIR = path.join(REPO_ROOT, ".claude", "agents");

function harnessAddendum(live) {
  const pageDescription = live
    ? "the page to clone is a real, live URL"
    : "the page to clone is at a local file:// URL, not a live site";
  return `
For this test run: ${pageDescription}. You do not have Playwright, Kitesurf,
or any screenshot tool available in this environment — skip the
visual-comparison-and-iterate step entirely regardless. Do your best
single-pass build instead: investigate the page, make your
componentization/tooling decisions, and write the reconciled output to
clone.html in the current directory. Finish with a short plain-text summary
of the key decisions you made (what you componentized, what needed special
handling, anything you flagged as unrecreatable) — this is what will be
graded, not visual fidelity.
`.trim();
}

/** Splits a Claude Code agent file into its YAML frontmatter and prompt body. */
function loadAgentDefinition(agentFile) {
  const raw = fs.readFileSync(agentFile, "utf8");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${agentFile} has no YAML frontmatter`);
  const frontmatter = yaml.load(match[1]);
  return { frontmatter, body: match[2].trim() };
}

/**
 * Runs an agent, headless, against a page URL. Invoked exactly the way a
 * non-interactive CI job would call it (no session state, no ambient config
 * beyond what's passed explicitly) — running it as a local subprocess for
 * now is a stand-in for that CI job, not a different code path.
 *
 * Does NOT use `--agent <name>` project discovery: the agent gets the
 * prompt body via --system-prompt instead, so the workDir it runs from
 * never needs a path back into this repo at all.
 *
 * `agentName` selects which .claude/agents/<agentName>.md definition to run
 * — "cloner" (the tooled agent) or "cloner-baseline" (the control condition,
 * same deliverable spec, no red-twine/windtailor/slowcure).
 */
export function runAgentAgainstUrl(pageUrl, { agentName = "cloner", maxBudgetUsd = 1.0, live = false, model } = {}) {
  const { frontmatter, body } = loadAgentDefinition(path.join(AGENTS_DIR, `${agentName}.md`));
  const resolvedModel = model ?? frontmatter.model ?? "sonnet";

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "gumshoe-agent-run-"));
  const prompt = `Clone this page into a single self-contained HTML file: ${pageUrl}`;
  const systemPrompt = `${body}\n\n${harnessAddendum(live)}`;

  const args = [
    "-p",
    prompt,
    "--system-prompt",
    systemPrompt,
    "--model",
    resolvedModel,
    "--output-format",
    "json",
    "--permission-mode",
    "bypassPermissions",
    "--allowedTools",
    "Bash,Read,Write,Edit",
    "--max-budget-usd",
    String(maxBudgetUsd),
    "--no-session-persistence",
  ];

  const raw = execFileSync("claude", args, {
    cwd: workDir,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 256,
  });

  const messages = JSON.parse(raw);
  const toolCalls = [];
  for (const msg of messages) {
    if (msg.type !== "assistant") continue;
    for (const block of msg.message?.content ?? []) {
      if (block.type === "tool_use") {
        toolCalls.push({ name: block.name, input: block.input });
      }
    }
  }

  const result = messages.find((m) => m.type === "result");
  const clonePath = path.join(workDir, "clone.html");

  return {
    agentName,
    model: resolvedModel,
    workDir,
    toolCalls,
    resultText: result?.result ?? null,
    totalCostUsd: result?.total_cost_usd ?? null,
    isError: result?.is_error ?? false,
    cloneHtml: fs.existsSync(clonePath) ? fs.readFileSync(clonePath, "utf8") : null,
  };
}

/**
 * Runs an agent against one of our own local fixtures. Copies only
 * page.html into an anonymous scratch directory first — it must never have
 * a filesystem path back to its own fixture's manifest.yaml/__snapshots__
 * (which state the expected answer) or to any other fixture's, the same way
 * a real live site never ships its own answer key next to it.
 */
export function runAgent(fixtureDir, { agentName = "cloner", maxBudgetUsd = 1.0, model } = {}) {
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "gumshoe-fixture-stage-"));
  fs.copyFileSync(path.join(fixtureDir, "page.html"), path.join(stagingDir, "page.html"));
  const pageUrl = `file://${path.join(stagingDir, "page.html")}`;
  return runAgentAgainstUrl(pageUrl, { agentName, maxBudgetUsd, live: false, model });
}
