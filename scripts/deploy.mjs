import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    env: { ...process.env, CLOUDFLARE_DEPLOY: "1" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, ["scripts/run-framework.mjs", "build"]);
if (!existsSync("dist/server/wrangler.json")) {
  throw new Error(
    "O build não gerou dist/server/wrangler.json. O deploy foi interrompido.",
  );
}
run(process.execPath, [
  "node_modules/wrangler/bin/wrangler.js",
  "deploy",
  "--config",
  "dist/server/wrangler.json",
]);