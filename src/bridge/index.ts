import { loadBridgeConfig } from "./config-loader.js";
import { createBoltApp } from "./bolt-app.js";

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

    const boltApp = createBoltApp({
      accountId: account.id,
      botToken,
      appToken,
      gatewayPort: config.gatewayPort,
      gatewayAuthToken: config.gatewayAuthToken,
    });

    try {
      await boltApp.app.start();
      console.log(`  ✅ ${account.id}: connected`);
      connectedCount++;
    } catch (err) {
      console.error(
        `  ❌ ${account.id}: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  if (connectedCount === 0) {
    console.error("\n❌ No bots connected. Check your tokens.");
    process.exit(1);
  }

  console.log("");
  console.log(`🏝️  Bridge running — ${connectedCount} bot(s)`);
  console.log("   Watching for approval messages...");
  console.log("   Press Ctrl+C to stop");
  console.log("");
}
