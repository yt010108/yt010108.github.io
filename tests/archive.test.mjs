import assert from "node:assert/strict";
import test from "node:test";
import { archiveCategoryCounts } from "../shared/taxonomy.js";

test("archive counts include direct posts and every descendant exactly once", () => {
  const items = ["AI", "AI / hermes", "AI / hermes / Setup", "AI Tools", ""].map(category => ({ category }));
  assert.deepEqual(archiveCategoryCounts(items), new Map([
    ["", 5], ["AI", 3], ["AI / hermes", 2], ["AI / hermes / Setup", 1], ["AI Tools", 1], ["@uncategorized", 1]
  ]));
  assert.deepEqual(archiveCategoryCounts([]), new Map([["", 0]]));
});
