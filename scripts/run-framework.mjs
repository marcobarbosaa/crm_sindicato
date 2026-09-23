import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

await import("./load-env.mjs");

const [command, ...args] = process.argv.slice(2);

if (!["dev", "build"].includes(command)) {
  throw new Error("Expected dev or build.");
}

const vinextCli = fileURLToPath(
  new URL("../node_modules/vinext/dist/cli.js", import.meta.url)
);

const finalArgs = [
  vinextCli,
  command,
  ...(command === "dev" ? ["--port", "5173"] : []),
  ...args,
];

console.log(`Executando Vinext: node ${finalArgs.slice(1).join(" ")}`);

const result = spawnSync(process.execPath, finalArgs, {
  stdio: "inherit",
  shell: false,
  env: process.env,
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}