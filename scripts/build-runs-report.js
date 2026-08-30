#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { RUNS_DIR } from "../test/lib/record-run.js";

const REPORT_PATH = path.join(RUNS_DIR, "report.html");

function loadRuns() {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs
    .readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = path.join(RUNS_DIR, d.name);
      const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
      const transcript = JSON.parse(fs.readFileSync(path.join(dir, "transcript.json"), "utf8"));
      const screenshotsDir = path.join(dir, "screenshots");
      const screenshots = fs.existsSync(screenshotsDir)
        ? fs
            .readdirSync(screenshotsDir)
            .sort((a, b) => fs.statSync(path.join(screenshotsDir, a)).mtimeMs - fs.statSync(path.join(screenshotsDir, b)).mtimeMs)
            .map((f) => `${d.name}/screenshots/${f}`)
        : [];
      const hasClone = fs.existsSync(path.join(dir, "clone.html"));
      return { id: d.name, meta, transcript, screenshots, clonePath: hasClone ? `${d.name}/clone.html` : null };
    })
    .sort((a, b) => (a.meta.recordedAt < b.meta.recordedAt ? 1 : -1));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** A single readable line for one tool call — not the full input, just enough to scan the sequence at a glance. */
function toolCallLine(call) {
  const detail = call.input?.command ?? call.input?.file_path ?? call.input?.url ?? call.input?.selector ?? "";
  return detail ? `${call.name} — ${detail}` : call.name;
}

function renderRunCard(run) {
  const { meta, transcript, screenshots, clonePath, id } = run;
  const costLabel = meta.totalCostUsd != null ? `$${meta.totalCostUsd.toFixed(3)}` : "—";
  const statusLabel = meta.isError ? "ERRORED" : "ok";
  const statusClass = meta.isError ? "status-error" : "status-ok";

  const screenshotsHtml = screenshots.length
    ? screenshots
        .map(
          (src) => `
        <figure class="shot">
          <img src="${escapeHtml(src)}" loading="lazy" alt="${escapeHtml(path.basename(src))}">
          <figcaption>${escapeHtml(path.basename(src))}</figcaption>
        </figure>`,
        )
        .join("\n")
    : `<p class="empty">No screenshots recorded.</p>`;

  const transcriptLines = transcript.toolCalls.map((c) => `<li>${escapeHtml(toolCallLine(c))}</li>`).join("\n");

  const rawJson = JSON.stringify(transcript.toolCalls, null, 2);

  return `
  <article class="run-card" data-run-id="${escapeHtml(id)}">
    <header class="run-header">
      <h2>${escapeHtml(meta.fixture)}</h2>
      <div class="run-tags">
        <span class="tag tag-condition">${escapeHtml(meta.condition)}</span>
        <span class="tag">${escapeHtml(meta.model)}</span>
        <span class="tag ${statusClass}">${statusLabel}</span>
      </div>
      <div class="run-stats">
        <span>${costLabel}</span>
        <span>${meta.toolCallCount} tool call${meta.toolCallCount === 1 ? "" : "s"}</span>
        <span>${escapeHtml(meta.recordedAt.slice(0, 19).replace("T", " "))}</span>
      </div>
    </header>

    <section class="run-section">
      <h3>Screenshots</h3>
      <div class="shots">${screenshotsHtml}</div>
    </section>

    <section class="run-section">
      <h3>Tool calls</h3>
      <ol class="transcript">${transcriptLines}</ol>
      <details class="raw-json">
        <summary>Raw JSON</summary>
        <pre>${escapeHtml(rawJson)}</pre>
      </details>
    </section>

    <section class="run-section">
      <h3>Agent's summary</h3>
      <pre class="summary">${escapeHtml(transcript.resultText ?? "(no summary)")}</pre>
    </section>

    ${clonePath ? `<footer class="run-footer"><a href="${escapeHtml(clonePath)}" target="_blank" rel="noopener">Open clone.html</a></footer>` : ""}
  </article>`;
}

function renderFilterPanel(runs) {
  const items = runs
    .map(
      (r) => `
      <label>
        <input type="checkbox" class="run-toggle" data-run-id="${escapeHtml(r.id)}" checked>
        ${escapeHtml(r.meta.fixture)} — ${escapeHtml(r.meta.condition)}/${escapeHtml(r.meta.model)}
        <span class="filter-meta">${escapeHtml(r.meta.recordedAt.slice(0, 19).replace("T", " "))}</span>
      </label>`,
    )
    .join("\n");
  return `
  <div class="filter-panel">
    <div class="filter-actions">
      <button id="select-all">All</button>
      <button id="select-none">None</button>
      <button id="select-latest">Latest 2</button>
    </div>
    <div class="filter-list">${items}</div>
  </div>`;
}

function renderPage(runs) {
  const cards = runs.map(renderRunCard).join("\n");
  const filterPanel = renderFilterPanel(runs);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>gumshoe run report</title>
<style>
  :root {
    --bg: #f7f6f3;
    --panel: #ffffff;
    --border: #ddd8ce;
    --ink: #2b2924;
    --ink-dim: #6b6659;
    --accent: #9c5b2e;
    --ok: #2e7d4f;
    --error: #b3402c;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: var(--bg);
    color: var(--ink);
  }
  h1 {
    font-size: 1.1rem;
    margin: 0;
    padding: 14px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    position: sticky;
    top: 0;
    z-index: 5;
  }
  .layout {
    display: flex;
  }
  .filter-panel {
    width: 260px;
    flex: 0 0 260px;
    border-right: 1px solid var(--border);
    padding: 14px;
    height: calc(100vh - 49px);
    overflow-y: auto;
    position: sticky;
    top: 49px;
    background: var(--panel);
  }
  .filter-actions { display: flex; gap: 6px; margin-bottom: 10px; }
  .filter-actions button {
    font-size: 0.75rem;
    padding: 4px 8px;
    border: 1px solid var(--border);
    background: var(--bg);
    border-radius: 4px;
    cursor: pointer;
  }
  .filter-list label {
    display: block;
    font-size: 0.8rem;
    padding: 6px 4px;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
  }
  .filter-meta { display: block; color: var(--ink-dim); font-size: 0.7rem; }
  .cards {
    flex: 1;
    display: flex;
    gap: 16px;
    padding: 16px;
    overflow-x: auto;
    align-items: flex-start;
  }
  .run-card {
    flex: 0 0 420px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .run-card[hidden] { display: none; }
  .run-header h2 { margin: 0 0 6px; font-size: 1rem; }
  .run-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
  .tag {
    font-size: 0.7rem;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--ink-dim);
  }
  .tag-condition { color: var(--accent); border-color: var(--accent); }
  .status-ok { color: var(--ok); border-color: var(--ok); }
  .status-error { color: var(--error); border-color: var(--error); }
  .run-stats {
    display: flex;
    gap: 10px;
    font-size: 0.75rem;
    color: var(--ink-dim);
    font-variant-numeric: tabular-nums;
  }
  .run-section h3 {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-dim);
    margin: 0 0 6px;
  }
  .shots { display: flex; flex-direction: column; gap: 10px; max-height: 480px; overflow-y: auto; }
  .shot { margin: 0; }
  .shot img { width: 100%; border: 1px solid var(--border); border-radius: 4px; display: block; }
  .shot figcaption { font-size: 0.7rem; color: var(--ink-dim); margin-top: 2px; }
  .empty { color: var(--ink-dim); font-size: 0.8rem; font-style: italic; }
  .transcript {
    margin: 0;
    padding-left: 18px;
    font-size: 0.78rem;
    max-height: 220px;
    overflow-y: auto;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
  }
  .transcript li { margin-bottom: 3px; word-break: break-all; }
  .raw-json summary { font-size: 0.75rem; color: var(--ink-dim); cursor: pointer; margin-top: 6px; }
  .raw-json pre {
    max-height: 300px;
    overflow: auto;
    background: var(--bg);
    padding: 8px;
    border-radius: 4px;
    font-size: 0.7rem;
  }
  .summary {
    white-space: pre-wrap;
    font-size: 0.8rem;
    max-height: 260px;
    overflow-y: auto;
    margin: 0;
    font-family: inherit;
  }
  .run-footer a { font-size: 0.8rem; }
</style>
</head>
<body>
<h1>gumshoe run report — ${runs.length} run${runs.length === 1 ? "" : "s"}</h1>
<div class="layout">
  ${filterPanel}
  <div class="cards" id="cards">
    ${cards || '<p class="empty">No runs recorded yet — run `npm run test:live` to produce some.</p>'}
  </div>
</div>
<script>
  const toggles = document.querySelectorAll(".run-toggle");
  function apply() {
    toggles.forEach((t) => {
      const card = document.querySelector('.run-card[data-run-id="' + CSS.escape(t.dataset.runId) + '"]');
      if (card) card.hidden = !t.checked;
    });
  }
  toggles.forEach((t) => t.addEventListener("change", apply));
  document.getElementById("select-all")?.addEventListener("click", () => { toggles.forEach((t) => (t.checked = true)); apply(); });
  document.getElementById("select-none")?.addEventListener("click", () => { toggles.forEach((t) => (t.checked = false)); apply(); });
  document.getElementById("select-latest")?.addEventListener("click", () => { toggles.forEach((t, i) => (t.checked = i < 2)); apply(); });
  apply();
</script>
</body>
</html>`;
}

const runs = loadRuns();
fs.mkdirSync(RUNS_DIR, { recursive: true });
fs.writeFileSync(REPORT_PATH, renderPage(runs));
console.log(`Wrote ${runs.length} run(s) to ${REPORT_PATH}`);
