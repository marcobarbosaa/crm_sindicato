import vinext from "vinext";
import { defineConfig } from "vite";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";

const managedLinux = readExecutionProfile() === "managed-linux";
const isCloudflareDeploy = process.env.CLOUDFLARE_DEPLOY === "1";
const workerVars: Record<string, string> = isCloudflareDeploy
  ? {}
  : { DATABASE_URL: String(process.env.DATABASE_URL || "") };

const localBindingConfig = {
  main: "./worker.ts",
  triggers: { crons: ["*/5 * * * *"] },
  observability: { enabled: true },
  compatibility_flags: ["nodejs_compat"],
  vars: workerVars,
};

export default defineConfig(async () => {
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      ...(managedLinux ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] } : {}),
    },
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});
