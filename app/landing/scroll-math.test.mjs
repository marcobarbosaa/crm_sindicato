import assert from "node:assert/strict";
import { panelWeight, storyPosition } from "./scroll-math.ts";
const starts = [1000, 1800, 2600, 3400];
for (const [i, start] of starts.entries()) {
  assert.equal(storyPosition(starts, start), i);
  assert.equal(panelWeight(i, i), 1);
}
const positions = [];
for (let focus = 500; focus <= 4000; focus += 7) {
  const p = storyPosition(starts, focus);
  assert.ok(p >= 0 && p <= 3);
  const sum = starts.reduce((total, _, i) => total + panelWeight(p, i), 0);
  assert.ok(Math.abs(sum - 1) < 1e-10, "Crossfades must never leave the stage blank");
  if (positions.length) assert.ok(p >= positions.at(-1).p, "Forward scroll must remain monotonic");
  positions.push({ focus, p });
}
for (const { focus, p } of positions.reverse()) assert.equal(storyPosition(starts, focus), p, "Reverse scroll must produce the exact same composition");
assert.equal(storyPosition(starts, 1730), 0.5);
console.log("PASS: anchors, boundaries, monotonic progress, reversible composition and nonempty crossfades");
