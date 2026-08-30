import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";

/**
 * Jest-style snapshot assertion. Writes the snapshot on first run (or when
 * UPDATE_SNAPSHOTS=1), otherwise asserts the value matches what's on disk.
 * A missing-then-created snapshot does not fail the test that created it —
 * re-run once to confirm it now passes, the same way Jest behaves.
 */
export function matchSnapshot(snapshotPath, value) {
  const serialized = JSON.stringify(value, null, 2) + "\n";

  if (UPDATE || !fs.existsSync(snapshotPath)) {
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, serialized);
    return;
  }

  const existing = fs.readFileSync(snapshotPath, "utf8");
  assert.equal(
    serialized,
    existing,
    `Snapshot mismatch for ${snapshotPath}. If this change is expected (the tool's real behavior changed on purpose), re-run with UPDATE_SNAPSHOTS=1.`,
  );
}
