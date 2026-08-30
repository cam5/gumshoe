import puppeteer from "puppeteer-core";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

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
 * Pixel-diffs two same-size PNG buffers. Not a pixel-perfection gate (that's
 * an explicit non-goal for this project) — a rough, directional similarity
 * signal: what fraction of pixels differ, and a visual diff image to look at
 * for anything worth a human glance.
 */
export function diffScreenshots(bufA, bufB) {
  const a = PNG.sync.read(bufA);
  const b = PNG.sync.read(bufB);
  const { width, height } = a;

  if (b.width !== width || b.height !== height) {
    return { diffRatio: 1, comparable: false, note: `size mismatch: ${width}x${height} vs ${b.width}x${b.height}` };
  }

  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(a.data, b.data, diff.data, width, height, { threshold: 0.1 });

  return {
    diffRatio: diffPixels / (width * height),
    comparable: true,
    diffPng: PNG.sync.write(diff),
  };
}
