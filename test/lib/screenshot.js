import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { PNG } from "pngjs";
// odiff-bin is CommonJS -- Node's ESM interop doesn't expose its named exports directly.
// It only exports `compare` (file-path based) and `ODiffServer` at the top level;
// `compareBuffers` is a method on ODiffServer, not a standalone function, so plain `compare()`
// against two temp files is simpler here than managing a persistent server's lifecycle.
import odiffPkg from "odiff-bin";
const { compare } = odiffPkg;

const VIEWPORT = { width: 1280, height: 900 };

/** Screenshots a file:// (or http(s)://) URL as a PNG buffer, at a fixed viewport, after the page settles. */
export async function screenshotUrl(url) {
  const browser = await puppeteer.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
    // Newer puppeteer-core returns a Uint8Array, not a Node Buffer; pngjs needs a real Buffer.
    return Buffer.from(await page.screenshot({ type: "png" }));
  } finally {
    await browser.close();
  }
}

/**
 * Fraction of pixels that are the single most common color, sampled every 7th pixel for speed.
 * A near-blank/mostly-whitespace screenshot scores close to 1 here regardless of what (if
 * anything) is actually rendered on it -- which is exactly the case a raw diff ratio can't see:
 * two near-blank screenshots pixel-match each other "perfectly" whether the underlying page is a
 * faithful clone or completely broken. This doesn't fix that on its own, but flags it so a 0%
 * (or otherwise suspiciously low) diffRatio can be treated with the skepticism it deserves instead
 * of taken at face value.
 */
function dominantColorFraction(buf) {
  const png = PNG.sync.read(buf);
  const counts = new Map();
  let sampled = 0;
  for (let i = 0; i < png.data.length; i += 7 * 4) {
    const key = (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
    sampled++;
  }
  const max = Math.max(...counts.values());
  return max / sampled;
}

const BLANK_THRESHOLD = 0.97;

/**
 * Diffs two same-size PNG buffers via odiff (https://github.com/dmtrKovalenko/odiff), not the
 * hand-rolled pixelmatch this used before. Not a pixel-perfection gate (that's an explicit
 * non-goal for this project) — a rough, directional similarity signal: what fraction of pixels
 * differ, plus a visual diff image and bounding box for anything worth a human glance.
 *
 * `antialiasing: true` ignores AA-only pixel noise, which is what was producing non-monotonic
 * diffRatio swings between otherwise-improving rounds. `blankMatch` flags when both images are
 * dominated by a single color (see dominantColorFraction) -- a real Tier 2 run surfaced every
 * "tooled" fixture run scoring a "perfect" 0.00% diff purely because both screenshots were
 * near-blank, regardless of whether the clone had any real content or styling at all.
 */
export async function diffScreenshots(bufA, bufB) {
  const blankMatch = dominantColorFraction(bufA) > BLANK_THRESHOLD && dominantColorFraction(bufB) > BLANK_THRESHOLD;

  const runId = crypto.randomUUID();
  const pathA = path.join(os.tmpdir(), `gumshoe-odiff-${runId}-a.png`);
  const pathB = path.join(os.tmpdir(), `gumshoe-odiff-${runId}-b.png`);
  const diffPath = path.join(os.tmpdir(), `gumshoe-odiff-${runId}-diff.png`);
  fs.writeFileSync(pathA, bufA);
  fs.writeFileSync(pathB, bufB);

  let result;
  try {
    result = await compare(pathA, pathB, diffPath, {
      antialiasing: true,
      captureDiffLines: true,
      captureDiffCols: true,
    });
  } catch (err) {
    return { diffRatio: 1, comparable: false, note: `odiff failed: ${err.message}`, blankMatch };
  } finally {
    fs.rmSync(pathA, { force: true });
    fs.rmSync(pathB, { force: true });
  }

  if (result.match) {
    return { diffRatio: 0, comparable: true, diffPng: null, blankMatch };
  }
  if (result.reason === "layout-diff") {
    return { diffRatio: 1, comparable: false, note: "layout mismatch (different image dimensions)", blankMatch };
  }
  if (result.reason === "file-not-exists") {
    return { diffRatio: 1, comparable: false, note: `odiff: missing file ${result.file}`, blankMatch };
  }

  const diffPng = fs.existsSync(diffPath) ? fs.readFileSync(diffPath) : null;
  fs.rmSync(diffPath, { force: true });

  const diffBoundingBox =
    result.diffLines?.length && result.diffCols?.length
      ? {
          top: result.diffLines[0],
          bottom: result.diffLines[result.diffLines.length - 1],
          left: result.diffCols[0],
          right: result.diffCols[result.diffCols.length - 1],
        }
      : null;

  return {
    diffRatio: result.diffPercentage / 100,
    comparable: true,
    diffPng,
    diffBoundingBox,
    blankMatch,
  };
}
