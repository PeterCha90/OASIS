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

  // Build a map of accountId → postApprovalButtons function
  const boltApps: Map<
    string,
    ReturnType<typeof createBoltApp>
  > = new Map();

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
      gateway,
    });

    boltApps.set(account.id, boltApp);

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

  // Listen for Gateway approval events and route to the right Bolt app
  gateway.onApprovalRequested((approval) => {
    const accountId = approval.request.turnSourceAccountId;
    const channel = approval.request.turnSourceTo;

    if (!channel) {
      console.warn(
        `[OASIS Bridge] Approval ${approval.id.slice(0, 12)} has no channel target, skipping`
      );
      return;
    }

    // Find the right Bolt app for this account
    let targetApp = accountId ? boltApps.get(accountId) : undefined;

    // Fallback: use the first connected app
    if (!targetApp) {
      targetApp = [...boltApps.values()][0];
    }

    if (!targetApp) return;

    targetApp.postApprovalButtons({
      id: approval.id,
      title: approval.request.title,
      description: approval.request.description,
      toolName: approval.request.toolName ?? "unknown",
      channel,
      threadTs: approval.request.turnSourceThreadId?.toString(),
    });
  });

  // Connect to Gateway for real-time approval events
  gateway.connect();

  console.log("");
  console.log(`🏝️  Bridge running — ${connectedCount} bot(s), Gateway :${config.gatewayPort}`);
  console.log("   Press Ctrl+C to stop");
  console.log("");
}
