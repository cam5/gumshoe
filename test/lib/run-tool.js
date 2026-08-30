import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const BIN_DIR = path.resolve(import.meta.dirname, "..", "..", "node_modules", ".bin");

function runRaw(bin, args, options) {
  return execFileSync(path.join(BIN_DIR, bin), args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
    ...options,
  });
}

/** red-twine and slowcure print their JSON report straight to stdout. */
function runJson(bin, args, options) {
  return JSON.parse(runRaw(bin, args, options));
}

/** Runs red-twine against page.html with fixtureDir as cwd, so reported sources are stable ("page.html"), not machine-dependent absolute paths. */
export function runRedTwine(fixtureDir) {
  const report = runJson("red-twine", ["page.html"], { cwd: fixtureDir });
  const { totalElements, totalDocuments, options, groups } = report;
  return { totalElements, totalDocuments, options, groups };
}

/** Runs windtailor against page.html (as a file:// URL) with the given selector. windtailor writes its report to a file rather than stdout, so we read it back from a scratch output dir. Snapshots only the stable, meaningful fields. */
export function runWindtailor(fixtureDir, selector) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "gumshoe-windtailor-"));
  try {
    const url = `file://${path.join(fixtureDir, "page.html")}`;
    runRaw("windtailor", ["--selector", selector, "--out", outDir, url]);
    const report = JSON.parse(fs.readFileSync(path.join(outDir, "report.json"), "utf8"));
    const { selector: sel, classes, tokens, suggestions } = report;
    return { selector: sel, classes, tokens, suggestions };
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

/** Runs slowcure against page.html (as a file:// URL). Drops timing-sensitive fields (elapsedMs, mutationCount) so the snapshot reflects behavior, not incidental timing. */
export function runSlowcure(fixtureDir) {
  const url = `file://${path.join(fixtureDir, "page.html")}`;
  const report = runJson("slowcure", [url]);
  return { settledBy: report.capture.settledBy, drift: report.drift };
}
