import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function run(command, args) {
  console.log(`\n> ${command} ${args.join(" ")}\n`);

  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      CLOUDFLARE_DEPLOY: "1",
    },
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// 1. Executa o build Vinext diretamente, sem depender do binário "pnpm" no PATH
const vinextCli = fileURLToPath(
  new URL("../node_modules/vinext/dist/cli.js", import.meta.url),
);
run(process.execPath, [vinextCli, "build"]);

// 2. Verifica o que realmente foi gerado
if (!existsSync("dist")) {
  throw new Error(
    "O build terminou, mas o diretório dist/ não foi criado. " +
    "O deploy foi interrompido."
  );
}

const wranglerConfigs = [];

console.log("\nEstrutura gerada pelo build em dist/:\n");
console.log("dist/");

function inspectDirectory(directory, depth = 1) {
  const entries = readdirSync(directory, {
    withFileTypes: true,
  }).sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    console.log(
      `${"  ".repeat(depth)}${entry.name}${entry.isDirectory() ? "/" : ""}`
    );

    if (entry.isDirectory()) {
      inspectDirectory(entryPath, depth + 1);
      continue;
    }

    if (entry.isFile() && entry.name === "wrangler.json") {
      wranglerConfigs.push(entryPath);
    }
  }
}

// 3. Procura wrangler.json recursivamente
inspectDirectory("dist");

console.log("\nWrangler configs encontradas:");

if (wranglerConfigs.length === 0) {
  console.log("  nenhuma");

  throw new Error(
    "O build não gerou nenhum wrangler.json dentro de dist/. " +
    "Veja a estrutura de dist/ impressa acima."
  );
}

for (const config of wranglerConfigs) {
  console.log(`  ${config}`);
}

if (wranglerConfigs.length > 1) {
  throw new Error(
    "O build gerou mais de um wrangler.json. " +
    "O deploy foi interrompido para evitar selecionar uma configuração incorreta.\n\n" +
    wranglerConfigs.map((config) => `- ${config}`).join("\n")
  );
}

// 4. Usa exatamente o wrangler.json produzido pelo build
const wranglerConfig = wranglerConfigs[0];

console.log(`\nUsando configuração: ${wranglerConfig}\n`);

// 5. Faz o deploy sempre no Worker de produção correto.
// O "name" gravado em wrangler.json vem de package.json e pode divergir do
// Worker realmente publicado; --name evita criar/atualizar um Worker errado.
const PRODUCTION_WORKER_NAME = "crm-sindicato";

console.log(`Publicando explicitamente no Worker "${PRODUCTION_WORKER_NAME}".`);

run(process.execPath, [
  "node_modules/wrangler/bin/wrangler.js",
  "deploy",
  "--config",
  wranglerConfig,
  "--name",
  PRODUCTION_WORKER_NAME,
]);