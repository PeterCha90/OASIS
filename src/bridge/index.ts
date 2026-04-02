import { WebClient } from "@slack/web-api";
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

  const resolvedApprovals = new Set<string>();
  const botUserIds = new Set<string>();

  // Collect all bot tokens
  const allBotTokens = new Map<string, string>();
  for (const account of config.accounts) {
    const botToken = config.tokens[account.botTokenEnvKey];
    if (botToken) allBotTokens.set(account.id, botToken);
  }

  // Resolve all bot user IDs upfront
  for (const [accountId, token] of allBotTokens) {
    try {
      const client = new WebClient(token);
      const auth = await client.auth.test();
      if (auth.user_id) botUserIds.add(auth.user_id as string);
    } catch {
      console.warn(`  ⚠️  ${accountId}: could not resolve bot user ID`);
    }
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
      resolvedApprovals,
      allBotTokens,
      botUserIds,
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
  console.log(`🏝️  Bridge running — ${connectedCount} bot(s), ${botUserIds.size} bot IDs filtered`);
  console.log("   Press Ctrl+C to stop");
  console.log("");
}
