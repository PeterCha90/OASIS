// src/bridge/index.ts
import { loadBridgeConfig } from "./config-loader.js";
import { createBoltApp } from "./bolt-app.js";
import { GatewayClient } from "./gateway-client.js";

export async function startBridge() {
  console.log("");
  console.log("🏝️  OASIS Slack Bridge");
  console.log("═".repeat(40));
  console.log("");

  let config;
  try {
    config = loadBridgeConfig();
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  if (config.accounts.length === 0) {
    console.error("❌ No Slack accounts found in ~/.openclaw/openclaw.json");
    process.exit(1);
  }

  const gateway = new GatewayClient(config.gatewayPort);
  console.log(`  Gateway: ws://127.0.0.1:${config.gatewayPort}`);
  console.log("");

  let connectedCount = 0;

  for (const account of config.accounts) {
    const botToken = config.tokens[account.botTokenEnvKey];
    const appToken = config.tokens[account.appTokenEnvKey];

    if (!botToken || !appToken) {
      console.warn(
        `  ⚠️  ${account.id}: skipped (missing ${!botToken ? account.botTokenEnvKey : account.appTokenEnvKey})`
      );
      continue;
    }

    const app = createBoltApp({
      accountId: account.id,
      botToken,
      appToken,
      gateway,
    });

    try {
      await app.start();
      console.log(`  ✅ ${account.id}: connected`);
      connectedCount++;
    } catch (err) {
      console.error(`  ❌ ${account.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log("");

  if (connectedCount === 0) {
    console.error("❌ No bots connected. Check your tokens.");
    process.exit(1);
  }

  console.log(`🏝️  Bridge running — ${connectedCount} bot(s) connected`);
  console.log("   Press Ctrl+C to stop");
  console.log("");
}
