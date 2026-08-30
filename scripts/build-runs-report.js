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
      const hasPrompt = fs.existsSync(path.join(dir, "prompt.md"));
      return {
        id: d.name,
        // Older runs recorded before run-groups existed have no meta.runGroup — treat each as
        // its own singleton group rather than lumping them together under one falsy key.
        groupId: meta.runGroup || d.name,
        meta,
        transcript,
        screenshots,
        clonePath: hasClone ? `${d.name}/clone.html` : null,
        promptPath: hasPrompt ? `${d.name}/prompt.md` : null,
      };
    })
    .sort((a, b) => (a.meta.recordedAt < b.meta.recordedAt ? 1 : -1));
}

/** Clusters runs by the batch they were dispatched in, newest batch first. */
function groupRuns(runs) {
  const byGroup = new Map();
  for (const run of runs) {
    if (!byGroup.has(run.groupId)) byGroup.set(run.groupId, []);
    byGroup.get(run.groupId).push(run);
  }
  return [...byGroup.entries()]
    .map(([groupId, groupRuns]) => ({
      groupId,
      runs: groupRuns.sort((a, b) => (a.meta.recordedAt < b.meta.recordedAt ? -1 : 1)),
      latestRecordedAt: groupRuns.reduce((max, r) => (r.meta.recordedAt > max ? r.meta.recordedAt : max), ""),
    }))
    .sort((a, b) => (a.latestRecordedAt < b.latestRecordedAt ? 1 : -1));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** A single readable line for one tool call — not the full input, just enough to scan the sequence at a glance. */
function toolCallLine(call) {
  const detail = call.input?.command ?? call.input?.file_path ?? call.input?.url ?? call.input?.selector ?? "";
  return detail ? `${call.name} — ${detail}` : call.name;
}

/**
 * Renders the chronological events list — the agent's own reasoning text interleaved with its
 * tool calls — so a prompt instruction that asks for explicit reasoning ("state a priority list
 * before doing X") can actually be checked against what happened, not just assumed from the
 * final summary. Older recorded runs have no `events` (only `toolCalls`); those fall back to a
 * tool-calls-only list with no reasoning shown.
 */
function renderTranscript(transcript) {
  if (transcript.events?.length) {
    const items = transcript.events
      .map((e) =>
        e.type === "text"
          ? `<li class="event-text">${escapeHtml(e.text)}</li>`
          : `<li class="event-tool">${escapeHtml(toolCallLine(e))}</li>`,
      )
      .join("\n");
    return `<ol class="transcript">${items}</ol>`;
  }
  const items = transcript.toolCalls.map((c) => `<li class="event-tool">${escapeHtml(toolCallLine(c))}</li>`).join("\n");
  return `<ol class="transcript">${items}</ol>`;
}

function renderRunCard(run) {
  const { meta, transcript, screenshots, clonePath, promptPath, id } = run;
  const costLabel = meta.totalCostUsd != null ? `$${meta.totalCostUsd.toFixed(3)}` : "—";
  const statusLabel = meta.isError ? "ERRORED" : "ok";
  const statusClass = meta.isError ? "status-error" : "status-ok";
  const promptTag = meta.promptHash
    ? `<span class="tag tag-prompt" title="sha256 of the exact system prompt sent to the model — two runs sharing this mean byte-identical prompts">prompt ${escapeHtml(meta.promptHash)}</span>`
    : "";

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

  const rawJson = JSON.stringify(transcript.events?.length ? transcript.events : transcript.toolCalls, null, 2);

  const footerLinks = [
    clonePath ? `<a href="${escapeHtml(clonePath)}" target="_blank" rel="noopener">Open clone.html</a>` : "",
    promptPath ? `<a href="${escapeHtml(promptPath)}" target="_blank" rel="noopener">View system prompt</a>` : "",
  ].filter(Boolean);

  return `
  <article class="run-card" data-run-id="${escapeHtml(id)}">
    <header class="run-header">
      <h2>${escapeHtml(meta.fixture)}</h2>
      <div class="run-tags">
        <span class="tag tag-condition">${escapeHtml(meta.condition)}</span>
        <span class="tag">${escapeHtml(meta.model)}</span>
        <span class="tag ${statusClass}">${statusLabel}</span>
        ${promptTag}
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
      <h3>Transcript</h3>
      ${renderTranscript(transcript)}
      <details class="raw-json">
        <summary>Raw JSON</summary>
        <pre>${escapeHtml(rawJson)}</pre>
      </details>
    </section>

    <section class="run-section">
      <h3>Agent's summary</h3>
      <pre class="summary">${escapeHtml(transcript.resultText ?? "(no summary)")}</pre>
    </section>

    <section class="run-section">
      <h3>Annotations</h3>
      <ul class="annotations-list" data-run-id="${escapeHtml(id)}"><li class="empty">Loading…</li></ul>
    </section>

    ${footerLinks.length ? `<footer class="run-footer">${footerLinks.join("")}</footer>` : ""}
  </article>`;
}

function renderGroupSection(group) {
  const cards = group.runs.map(renderRunCard).join("\n");
  const label = group.runs[0]?.meta?.fixture ?? group.groupId;
  const timestamp = group.latestRecordedAt ? group.latestRecordedAt.slice(0, 19).replace("T", " ") : "";
  return `
  <section class="run-group" data-group-id="${escapeHtml(group.groupId)}">
    <div class="group-header">
      <h2>${escapeHtml(label)}</h2>
      <span class="group-meta">batch ${escapeHtml(group.groupId)} · ${group.runs.length} run${group.runs.length === 1 ? "" : "s"} · ${escapeHtml(timestamp)}</span>
    </div>
    <div class="group-cards">${cards}</div>
  </section>`;
}

function renderFilterPanel(runs) {
  const items = runs
    .map(
      (r) => `
      <label>
        <input type="checkbox" class="run-toggle" data-run-id="${escapeHtml(r.id)}" data-group-id="${escapeHtml(r.groupId)}" checked>
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
      <button id="select-latest">Latest batch</button>
    </div>
    <div class="filter-list">${items}</div>
  </div>`;
}

function renderPage(runs) {
  const groups = groupRuns(runs);
  const latestGroupId = groups[0]?.groupId ?? null;
  const groupSections = groups.map(renderGroupSection).join("\n");
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
    flex-direction: column;
    gap: 22px;
    padding: 16px;
    overflow-y: auto;
  }
  .run-group {
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px;
    background: rgba(0, 0, 0, 0.015);
  }
  .group-header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    padding: 0 2px 10px;
  }
  .group-header h2 { margin: 0; font-size: 0.95rem; }
  .group-meta {
    font-size: 0.7rem;
    color: var(--ink-dim);
    font-variant-numeric: tabular-nums;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
  }
  .group-cards {
    display: flex;
    gap: 16px;
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
  .tag-prompt { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
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
  .transcript li { margin-bottom: 6px; word-break: break-word; }
  .transcript .event-tool { word-break: break-all; }
  .transcript .event-text {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-style: italic;
    color: var(--ink-dim);
    white-space: pre-wrap;
  }
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
  .run-footer { display: flex; gap: 12px; font-size: 0.8rem; }
  .annotations-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; max-height: 260px; overflow-y: auto; }
  .annotation { border: 1px solid var(--border); border-radius: 6px; padding: 8px; background: var(--bg); }
  .annotation blockquote {
    margin: 0 0 4px;
    font-size: 0.78rem;
    font-style: italic;
    color: var(--ink-dim);
    border-left: 2px solid var(--accent);
    padding-left: 8px;
  }
  .annotation-note { margin: 0 0 4px; font-size: 0.82rem; white-space: pre-wrap; }
  .annotation-meta { font-size: 0.68rem; color: var(--ink-dim); display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .annotation-delete { font-size: 0.68rem; background: none; border: none; color: var(--error); cursor: pointer; padding: 0; }
  .annotations-list .empty { list-style: none; }
  #annotate-trigger {
    position: absolute;
    z-index: 20;
    font-size: 0.75rem;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--accent);
    background: var(--panel);
    color: var(--accent);
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  }
  #annotate-popover {
    position: absolute;
    z-index: 21;
    width: 280px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  }
  .annotate-excerpt {
    font-size: 0.75rem;
    font-style: italic;
    color: var(--ink-dim);
    border-left: 2px solid var(--accent);
    padding-left: 8px;
    margin-bottom: 6px;
    max-height: 80px;
    overflow-y: auto;
  }
  #annotate-popover textarea {
    width: 100%;
    min-height: 60px;
    font: inherit;
    font-size: 0.8rem;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    resize: vertical;
    box-sizing: border-box;
  }
  .annotate-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 6px; }
  .annotate-actions button {
    font-size: 0.75rem;
    padding: 4px 10px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--bg);
    cursor: pointer;
  }
  .annotate-save { border-color: var(--accent) !important; color: var(--accent); }
  .hint { font-size: 0.75rem; color: var(--ink-dim); padding: 0 20px; margin: 0; }
</style>
</head>
<body>
<h1>gumshoe run report — ${runs.length} run${runs.length === 1 ? "" : "s"} in ${groups.length} batch${groups.length === 1 ? "" : "es"}</h1>
<p class="hint">Select any text in a run card to annotate it. Annotations save to <code>runs/&lt;id&gt;/annotations.json</code> and need the report server (<code>npm run report:serve</code>) to load or save.</p>
<div class="layout">
  ${filterPanel}
  <div class="cards" id="cards">
    ${groupSections || '<p class="empty">No runs recorded yet — run `npm run test:live` to produce some.</p>'}
  </div>
</div>
<script>
  const toggles = document.querySelectorAll(".run-toggle");
  const latestGroupId = ${JSON.stringify(latestGroupId)};
  function apply() {
    toggles.forEach((t) => {
      const card = document.querySelector('.run-card[data-run-id="' + CSS.escape(t.dataset.runId) + '"]');
      if (card) card.hidden = !t.checked;
    });
  }
  toggles.forEach((t) => t.addEventListener("change", apply));
  document.getElementById("select-all")?.addEventListener("click", () => { toggles.forEach((t) => (t.checked = true)); apply(); });
  document.getElementById("select-none")?.addEventListener("click", () => { toggles.forEach((t) => (t.checked = false)); apply(); });
  document.getElementById("select-latest")?.addEventListener("click", () => { toggles.forEach((t) => (t.checked = latestGroupId !== null && t.dataset.groupId === latestGroupId)); apply(); });
  apply();

  // Annotations: select any text inside a run card, click "+ Annotate", write a note. Saved
  // server-side to runs/<id>/annotations.json — needs the report server, not just this static
  // file, since it round-trips through fetch().
  const isFileProtocol = location.protocol === "file:";

  function escapeHtmlClient(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function closestClass(node, className) {
    while (node && node !== document.body) {
      if (node.nodeType === 1 && node.classList?.contains(className)) return node;
      node = node.parentNode;
    }
    return null;
  }

  function renderAnnotationLi(runId, a) {
    const li = document.createElement("li");
    li.className = "annotation";
    li.dataset.id = a.id;
    li.innerHTML = \`
      <blockquote>\${escapeHtmlClient(a.excerpt)}</blockquote>
      <p class="annotation-note">\${escapeHtmlClient(a.note)}</p>
      <div class="annotation-meta">
        <span>\${a.section ? escapeHtmlClient(a.section) + " · " : ""}\${new Date(a.createdAt).toLocaleString()}</span>
        <button class="annotation-delete">Delete</button>
      </div>\`;
    li.querySelector(".annotation-delete").addEventListener("click", async () => {
      await fetch(\`/api/annotations/\${encodeURIComponent(runId)}/\${a.id}\`, { method: "DELETE" });
      li.remove();
    });
    return li;
  }

  function prependAnnotation(runId, annotation) {
    const list = document.querySelector(\`.annotations-list[data-run-id="\${CSS.escape(runId)}"]\`);
    if (!list) return;
    list.querySelector(".empty")?.remove();
    list.prepend(renderAnnotationLi(runId, annotation));
  }

  async function loadAnnotations() {
    for (const list of document.querySelectorAll(".annotations-list")) {
      const runId = list.dataset.runId;
      if (isFileProtocol) {
        list.innerHTML = '<li class="empty">Annotations need the report server — run <code>npm run report:serve</code>.</li>';
        continue;
      }
      try {
        const res = await fetch(\`/api/annotations/\${encodeURIComponent(runId)}\`);
        const annotations = await res.json();
        list.innerHTML = "";
        if (!annotations.length) {
          list.innerHTML = '<li class="empty">No annotations yet — select any text in this card to add one.</li>';
        } else {
          for (const a of annotations) list.appendChild(renderAnnotationLi(runId, a));
        }
      } catch (err) {
        list.innerHTML = \`<li class="empty">Could not load annotations: \${escapeHtmlClient(err.message)}</li>\`;
      }
    }
  }

  if (!isFileProtocol) {
    let pending = null;

    const trigger = document.createElement("button");
    trigger.id = "annotate-trigger";
    trigger.type = "button";
    trigger.textContent = "+ Annotate";
    trigger.hidden = true;
    document.body.appendChild(trigger);

    const popover = document.createElement("div");
    popover.id = "annotate-popover";
    popover.hidden = true;
    popover.innerHTML = \`
      <div class="annotate-excerpt"></div>
      <textarea placeholder="What's off, or worth noting, about this?"></textarea>
      <div class="annotate-actions">
        <button type="button" class="annotate-cancel">Cancel</button>
        <button type="button" class="annotate-save">Save</button>
      </div>\`;
    document.body.appendChild(popover);

    document.addEventListener("mouseup", (e) => {
      const selection = window.getSelection();
      const text = selection ? selection.toString().trim() : "";
      if (!text || e.target === trigger) return;
      const card = closestClass(selection.anchorNode, "run-card");
      if (!card) {
        trigger.hidden = true;
        return;
      }
      const section = closestClass(selection.anchorNode, "run-section")?.querySelector("h3")?.textContent ?? null;
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      pending = { runId: card.dataset.runId, section, excerpt: text };
      trigger.style.top = \`\${window.scrollY + rect.bottom + 6}px\`;
      trigger.style.left = \`\${window.scrollX + rect.left}px\`;
      trigger.hidden = false;
    });

    trigger.addEventListener("mousedown", (e) => {
      e.preventDefault();
      popover.querySelector(".annotate-excerpt").textContent = pending.excerpt;
      const textarea = popover.querySelector("textarea");
      textarea.value = "";
      popover.style.top = trigger.style.top;
      popover.style.left = trigger.style.left;
      popover.hidden = false;
      trigger.hidden = true;
      textarea.focus();
    });

    popover.querySelector(".annotate-cancel").addEventListener("click", () => {
      popover.hidden = true;
    });

    popover.querySelector(".annotate-save").addEventListener("click", async () => {
      const note = popover.querySelector("textarea").value.trim();
      if (!note || !pending) return;
      try {
        const res = await fetch(\`/api/annotations/\${encodeURIComponent(pending.runId)}\`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pending),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
        prependAnnotation(pending.runId, await res.json());
      } catch (err) {
        alert("Could not save annotation: " + err.message);
      }
      popover.hidden = true;
    });

    document.addEventListener("mousedown", (e) => {
      if (!popover.hidden && !popover.contains(e.target) && e.target !== trigger) popover.hidden = true;
    });
  }

  loadAnnotations();
</script>
</body>
</html>`;
}

const runs = loadRuns();
fs.mkdirSync(RUNS_DIR, { recursive: true });
fs.writeFileSync(REPORT_PATH, renderPage(runs));
console.log(`Wrote ${runs.length} run(s) to ${REPORT_PATH}`);
