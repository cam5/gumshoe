import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const AGENT_FILE = path.join(REPO_ROOT, ".claude", "agents", "cloner.md");

const HARNESS_ADDENDUM = `
For this test run: the page to clone is at a local file:// URL, not a live
site. You do not have Playwright, Kitesurf, or any screenshot tool available
in this environment — skip the visual-comparison-and-iterate step entirely.
Do your best single-pass build instead: investigate the page, make your
componentization/tooling decisions, and write the reconciled output to
clone.html in the current directory. Finish with a short plain-text summary
of the key decisions you made (what you componentized, what you called
slowcure on, anything you flagged as unrecreatable) — this is what will be
graded, not visual fidelity.
`.trim();

/** Splits a Claude Code agent file into its YAML frontmatter and prompt body. */
function loadAgentDefinition(agentFile) {
  const raw = fs.readFileSync(agentFile, "utf8");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${agentFile} has no YAML frontmatter`);
  const frontmatter = yaml.load(match[1]);
  return { frontmatter, body: match[2].trim() };
}

/**
 * Runs the cloner agent, headless, against one fixture. Invoked exactly the
 * way a non-interactive CI job would call it (no session state, no ambient
 * config beyond what's passed explicitly) — running it as a local subprocess
 * for now is a stand-in for that CI job, not a different code path.
 *
 * Deliberately does NOT run from inside this repo, and does NOT use
 * `--agent cloner` project discovery: the agent gets the prompt body via
 * --system-prompt instead, in an anonymous scratch directory containing only
 * a copy of page.html. It must never have a filesystem path back to its own
 * fixture's manifest.yaml/__snapshots__ (which state the expected answer) or
 * to any other fixture's — those must stay invisible to the run, the same
 * way a real live site's answer key would never sit next to it.
 */
export function runAgent(fixtureDir, { maxBudgetUsd = 1.0 } = {}) {
  const { frontmatter, body } = loadAgentDefinition(AGENT_FILE);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "gumshoe-agent-run-"));
  fs.copyFileSync(path.join(fixtureDir, "page.html"), path.join(workDir, "page.html"));
  const pageUrl = `file://${path.join(workDir, "page.html")}`;
  const prompt = `Clone this page into a single self-contained HTML file: ${pageUrl}`;
  const systemPrompt = `${body}\n\n${HARNESS_ADDENDUM}`;

  const args = [
    "-p",
    prompt,
    "--system-prompt",
    systemPrompt,
    "--model",
    frontmatter.model ?? "sonnet",
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
    workDir,
    toolCalls,
    resultText: result?.result ?? null,
    totalCostUsd: result?.total_cost_usd ?? null,
    isError: result?.is_error ?? false,
    cloneHtml: fs.existsSync(clonePath) ? fs.readFileSync(clonePath, "utf8") : null,
  };
}
