import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = ts.transpileModule(readFileSync(new URL("../lib/settings.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { sendingDayWindow } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
for (const [zone, now, expected] of [
  ["America/Sao_Paulo", "2026-09-29T02:59:59Z", "2026-09-28T03:00:00.000Z"],
  ["America/Sao_Paulo", "2026-09-29T03:00:00Z", "2026-09-29T03:00:00.000Z"],
  ["America/Sao_Paulo", "2026-01-01T01:00:00Z", "2025-12-31T03:00:00.000Z"],
  ["UTC", "2026-09-29T00:00:00Z", "2026-09-29T00:00:00.000Z"],
  ["UTC", "2026-09-29T23:59:59Z", "2026-09-29T00:00:00.000Z"],
]) {
  const { start, next } = sendingDayWindow(zone, new Date(now));
  assert.equal(start.toISOString(), expected);
  assert.equal(next.getTime() - start.getTime(), 86400000);
  assert.ok(start <= new Date(now) && next > new Date(now));
}
console.log("5 sending-day boundary tests passed.");
