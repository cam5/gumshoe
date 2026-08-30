const LOGICAL_TOOLS = ["red-twine", "windtailor", "slowcure"];

/** Indices (in call order) of Bash tool_use calls whose command mentions the given logical tool name. */
function callIndicesFor(toolCalls, toolName) {
  const indices = [];
  toolCalls.forEach((call, i) => {
    if (call.name !== "Bash") return;
    const command = call.input?.command ?? "";
    if (command.includes(toolName)) indices.push(i);
  });
  return indices;
}

/**
 * Scores an agent's tool-call trajectory against a fixture's tier1 manifest.
 * Deterministic only — fixtures marked judge:true are reported, not graded,
 * since there's no single correct answer to check against.
 */
export function scoreTrajectory(toolCalls, tier1) {
  if (tier1.judge) {
    return { judge: true, pass: null, checks: [], notes: "Marked for LLM/human judge review, not scored deterministically." };
  }

  const checks = [];

  for (const tool of tier1.mustCall ?? []) {
    const indices = callIndicesFor(toolCalls, tool);
    checks.push({
      kind: "mustCall",
      tool,
      pass: indices.length > 0,
      detail: indices.length > 0 ? `called at step(s) ${indices.join(", ")}` : "never called",
    });
  }

  for (const tool of tier1.mustNotCall ?? []) {
    const indices = callIndicesFor(toolCalls, tool);
    checks.push({
      kind: "mustNotCall",
      tool,
      pass: indices.length === 0,
      detail: indices.length === 0 ? "correctly not called" : `called at step(s) ${indices.join(", ")}`,
    });
  }

  for (const [first, second] of tier1.order ?? []) {
    const firstIndices = callIndicesFor(toolCalls, first);
    const secondIndices = callIndicesFor(toolCalls, second);
    const pass =
      firstIndices.length > 0 && secondIndices.length > 0 && Math.min(...firstIndices) < Math.min(...secondIndices);
    checks.push({
      kind: "order",
      tool: `${first} -> ${second}`,
      pass,
      detail: pass
        ? `${first} (step ${Math.min(...firstIndices)}) preceded ${second} (step ${Math.min(...secondIndices)})`
        : `expected ${first} before ${second}`,
    });
  }

  return { judge: false, pass: checks.every((c) => c.pass), checks };
}

export { LOGICAL_TOOLS };
