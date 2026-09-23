import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

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

const wranglerConfigs = [];
console.log("Estrutura gerada pelo build em dist/:");

function inspectDirectory(directory) {
  const entries = readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    console.log(`  ${entryPath}${entry.isDirectory() ? "/" : ""}`);
    if (entry.isDirectory()) {
      inspectDirectory(entryPath);
    } else if (entry.isFile() && entry.name === "wrangler.json") {
      wranglerConfigs.push(entryPath);
    }
  }
}

if (existsSync("dist")) {
  console.log("  dist/");
  inspectDirectory("dist");
} else {
  console.log("  (diretório dist/ não encontrado)");
}

if (wranglerConfigs.length === 0) {
  throw new Error(
    "O build não gerou nenhum wrangler.json dentro de dist/. " +
    "Consulte a estrutura encontrada no log acima. O deploy foi interrompido.",
  );
}
if (wranglerConfigs.length > 1) {
  throw new Error(
    "O build gerou mais de um wrangler.json dentro de dist/. " +
    "O deploy foi interrompido para evitar uma seleção arbitrária:\n" +
    wranglerConfigs.map((config) => `  ${config}`).join("\n"),
  );
}

console.log(`Configuração selecionada para deploy: ${wranglerConfigs[0]}`);
run(process.execPath, [
  "node_modules/wrangler/bin/wrangler.js",
  "deploy",
  "--config",
  wranglerConfigs[0],
]);
