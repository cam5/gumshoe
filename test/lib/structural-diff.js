import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Runs crow-nester against a URL (http(s):// or file://) and returns its parsed JSON outline. */
export async function getOutline(url) {
  const { stdout } = await execFileAsync("npx", ["github:cam5/crow-nester", url, "--sort-by", "document"], {
    maxBuffer: 1024 * 1024 * 64,
  });
  return JSON.parse(stdout);
}

function normalizeText(text) {
  return (text || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Groups nodes by normalized own-text, dropping anything shorter than minLen -- too short to be
 * a meaningful anchor (icon-only labels, stray whitespace) and prone to spurious matches. */
function groupByText(nodes, minLen = 2) {
  const map = new Map();
  for (const node of nodes) {
    const norm = normalizeText(node.text);
    if (norm.length < minLen) continue;
    if (!map.has(norm)) map.set(norm, []);
    map.get(norm).push(node);
  }
  return map;
}

/**
 * Compares two crow-nester outlines structurally instead of two screenshots pixel-by-pixel.
 * Matches nodes by their own real text (mandated as verbatim by cloner.md, so it's a much more
 * reliable anchor across two independently-built implementations than DOM position or class
 * names, which have no reason to align) rather than diffing raw markup or rendered pixels — this
 * is deliberately blind to a flaky hotlinked photo or a few pixels of font-rendering noise, the
 * exact things a pixel diff can't tell apart from a real layout difference.
 *
 * Duplicate text (e.g. "About Us" in both the nav and the footer) is paired positionally within
 * each group rather than collapsed, so repeated labels don't just match the first occurrence.
 *
 * Returns interrogable sub-metrics rather than one collapsed score, on purpose: a single "X%
 * structural similarity" number would hide exactly the kind of nuance (missing sections vs.
 * misplaced sections vs. mis-sized sections) this exists to surface.
 */
export function structuralDiff(outlineA, outlineB) {
  const groupsA = groupByText(outlineA.nodes);
  const groupsB = groupByText(outlineB.nodes);

  const matched = [];
  const onlyInA = [];
  const onlyInB = [];

  const allTexts = new Set([...groupsA.keys(), ...groupsB.keys()]);
  for (const text of allTexts) {
    const listA = groupsA.get(text) ?? [];
    const listB = groupsB.get(text) ?? [];
    const pairCount = Math.min(listA.length, listB.length);
    for (let i = 0; i < pairCount; i++) matched.push({ text, a: listA[i], b: listB[i] });
    for (let i = pairCount; i < listA.length; i++) onlyInA.push(text);
    for (let i = pairCount; i < listB.length; i++) onlyInB.push(text);
  }

  // Normalize each side's positions by its OWN page dimensions, so a candidate that renders
  // slightly taller/wider overall doesn't get penalized on every single matched node for that
  // one global difference.
  const pageWidth = (outline) => Math.max(...outline.nodes.map((n) => n.rendered.left + n.rendered.width), 1);
  const pageHeight = (outline) => Math.max(...outline.nodes.map((n) => n.rendered.top + n.rendered.height), 1);
  const [wA, hA, wB, hB] = [pageWidth(outlineA), pageHeight(outlineA), pageWidth(outlineB), pageHeight(outlineB)];

  // A hidden element (a closed dropdown panel, an unopened mobile drawer) collapses to a
  // degenerate box -- zero area, or an implementation-dependent non-zero one depending on
  // whether display:none/visibility:hidden/opacity:0 was used to hide it. Comparing those boxes
  // is noise, not signal: two implementations correctly agreeing that a menu is closed by default
  // can still show up as a wild size/position "mismatch" purely from how each one collapses.
  // Count hidden-on-both-sides matches as real structural agreement (matchedCount includes them),
  // but exclude them from the position/size deltas, which are only meaningful for visible content.
  const visibleMatched = matched.filter(({ a, b }) => a.rendered.visible && b.rendered.visible);

  const deltas = visibleMatched.map(({ a, b }) => ({
    topDeltaPct: Math.abs(a.rendered.top / hA - b.rendered.top / hB) * 100,
    leftDeltaPct: Math.abs(a.rendered.left / wA - b.rendered.left / wB) * 100,
    // log-scale so a section rendering 2x too big and one rendering half-size score the same
    // magnitude of "wrong" instead of size mismatches in one direction dominating the average.
    sizeLogDelta: Math.abs(Math.log((a.rendered.area || 1) / (b.rendered.area || 1))),
  }));

  const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);
  const totalA = [...groupsA.values()].reduce((s, l) => s + l.length, 0);
  const totalB = [...groupsB.values()].reduce((s, l) => s + l.length, 0);

  return {
    totalTextNodesA: totalA,
    totalTextNodesB: totalB,
    matchedCount: matched.length,
    visibleMatchedCount: visibleMatched.length,
    textCoverage: matched.length / Math.max(1, Math.max(totalA, totalB)),
    avgTopDeltaPct: avg(deltas.map((d) => d.topDeltaPct)),
    avgLeftDeltaPct: avg(deltas.map((d) => d.leftDeltaPct)),
    avgSizeLogDelta: avg(deltas.map((d) => d.sizeLogDelta)),
    onlyInA,
    onlyInB,
  };
}
