import { spawnSync } from "node:child_process";

await import("./load-env.mjs");

const [command, ...args] = process.argv.slice(2);

if (!["dev", "build"].includes(command)) {
  throw new Error("Expected dev or build.");
}

console.log(`[run-framework] comando recebido: ${command}`);
console.log(`[run-framework] iniciando vinext ${command}`);

const vinextArgs = [
  "exec",
  "vinext",
  command,
  ...(command === "dev" ? ["--port", "5173"] : []),
  ...args,
];

const result = spawnSync("pnpm", vinextArgs, {
  stdio: "inherit",
  shell: false,
  env: process.env,
});

if (result.error) {
  console.error("[run-framework] erro ao iniciar Vinext:");
  throw result.error;
}

console.log(
  `[run-framework] Vinext finalizado com código: ${result.status}`
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}