import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { runRedTwine, runWindtailor, runSlowcure } from "./lib/run-tool.js";
import { matchSnapshot } from "./lib/snapshot.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "..", "fixtures");

const RUNNERS = {
  "red-twine": (fixtureDir) => runRedTwine(fixtureDir),
  windtailor: (fixtureDir, entry) => runWindtailor(fixtureDir, entry.selector),
  slowcure: (fixtureDir) => runSlowcure(fixtureDir),
};

const fixtureNames = fs
  .readdirSync(FIXTURES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

for (const name of fixtureNames) {
  const fixtureDir = path.join(FIXTURES_DIR, name);
  const manifestPath = path.join(fixtureDir, "manifest.yaml");
  if (!fs.existsSync(manifestPath)) continue;

  const manifest = yaml.load(fs.readFileSync(manifestPath, "utf8"));

  for (const entry of manifest.tier0 ?? []) {
    const runner = RUNNERS[entry.tool];
    if (!runner) {
      throw new Error(`Unknown tier0 tool "${entry.tool}" in ${manifestPath}`);
    }

    const snapshotName = entry.selector ? `${entry.tool}--${entry.selector}` : entry.tool;
    const safeName = snapshotName.replace(/[^a-z0-9._-]+/gi, "_");
    const snapshotPath = path.join(fixtureDir, "__snapshots__", `${safeName}.json`);

    test(`tier0: ${name} / ${entry.tool}`, () => {
      const result = runner(fixtureDir, entry);
      matchSnapshot(snapshotPath, result);
    });
  }
}
