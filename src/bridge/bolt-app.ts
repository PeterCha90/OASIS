import { App, LogLevel } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import { parseApprovalMessage } from "./approval-parser.js";
import { buildApprovalBlocks, buildResolvedBlocks } from "./blocks.js";
// Gateway WS removed — use bot message for /approve command instead

interface BoltAppParams {
  accountId: string;
  botToken: string;
  appToken: string;
  gatewayPort: number;
  gatewayAuthToken?: string;
  /** Shared across all bot instances — prevents duplicate handling */
  processedMessages: Set<string>;
  /** Map of all bot tokens by accountId — for updating other bots' messages */
  allBotTokens: Map<string, string>;
}

export function createBoltApp(params: BoltAppParams) {
  const app = new App({
    token: params.botToken,
    appToken: params.appToken,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  // Watch for approval messages from OTHER bots
  app.event("message", async ({ event }) => {
    const msg = event as any;
    const text: string = msg.text ?? "";
    const ts: string | undefined = msg.ts;
    const channel: string | undefined = msg.channel;

    if (!ts || !channel) return;
    if (params.processedMessages.has(ts)) return;

    const parsed = parseApprovalMessage(text);
    if (!parsed) return;

    // Claim — other bots skip
    params.processedMessages.add(ts);

    // Figure out which bot posted the approval message
    // Use that bot's token to update ITS OWN message with buttons
    const botId = msg.bot_id;
    let updateClient: WebClient | null = null;

    // Try to find the right bot token by checking each one
    for (const [, token] of params.allBotTokens) {
      try {
        const testClient = new WebClient(token);
        const authInfo = await testClient.auth.test();
        if (authInfo.bot_id === botId) {
          updateClient = testClient;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!updateClient) {
      // Fallback: use first available token
      const firstToken = [...params.allBotTokens.values()][0];
      if (firstToken) updateClient = new WebClient(firstToken);
    }

    if (!updateClient) {
      console.error(`[OASIS Bridge] No client found to update message`);
      params.processedMessages.delete(ts);
      return;
    }

    // Update the ORIGINAL message to add Block Kit buttons
    try {
      await updateClient.chat.update({
        channel,
        ts,
        text: `🏝️ ${parsed.title}`,
        blocks: buildApprovalBlocks({
          approvalId: parsed.approvalId,
          title: parsed.title,
          toolName: parsed.toolName,
          riskScore: parsed.riskScore,
          detected: parsed.detected,
          parameters: parsed.parameters,
        }) as any,
      });
      console.log(
        `[OASIS Bridge] Buttons added to ${parsed.approvalId.slice(0, 12)}`
      );
    } catch (err) {
      console.error(`[OASIS Bridge] Failed to update message: ${err}`);
      params.processedMessages.delete(ts);
    }

    // Prune
    if (params.processedMessages.size > 1000) {
      const entries = [...params.processedMessages];
      for (let i = 0; i < entries.length - 500; i++) {
        params.processedMessages.delete(entries[i]);
      }
    }
  });

  // Handle Allow button
  app.action("oasis_approve", async ({ ack, body, client }) => {
    console.log(`[OASIS Bridge] ${params.accountId}: Allow clicked`);
    await ack();
    const action = (body as any).actions?.[0];
    if (!action?.value) return;

    const { id, decision } = JSON.parse(action.value);
    const channel = (body as any).channel?.id;
    const threadTs = (body as any).message?.thread_ts;

    try {
      // Bot posts /approve as a regular message — Slack won't intercept bot messages as slash commands
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: `/approve ${id} ${decision}`,
      });
      await client.chat.update({
        channel,
        ts: (body as any).message.ts,
        text: `✅ Allowed`,
        blocks: buildResolvedBlocks({ decision, resolvedBy: body.user.id }) as any,
      });
      console.log(`[OASIS Bridge] Approved ${id.slice(0, 12)}`);
    } catch (err) {
      console.error(`[OASIS Bridge] Approve failed: ${err}`);
    }
  });

  // Handle Deny button
  app.action("oasis_deny", async ({ ack, body, client }) => {
    console.log(`[OASIS Bridge] ${params.accountId}: Deny clicked`);
    await ack();
    const action = (body as any).actions?.[0];
    if (!action?.value) return;

    const { id, decision } = JSON.parse(action.value);
    const channel = (body as any).channel?.id;
    const threadTs = (body as any).message?.thread_ts;

    try {
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: `/approve ${id} ${decision}`,
      });
      await client.chat.update({
        channel,
        ts: (body as any).message.ts,
        text: `❌ Denied`,
        blocks: buildResolvedBlocks({ decision, resolvedBy: body.user.id }) as any,
      });
      console.log(`[OASIS Bridge] Denied ${id.slice(0, 12)}`);
    } catch (err) {
      console.error(`[OASIS Bridge] Deny failed: ${err}`);
    }
  });

  // Catch any unhandled actions
  app.action(/.*/, async ({ ack, body }) => {
    console.log(`[OASIS Bridge] ${params.accountId}: Unhandled action: ${(body as any).actions?.[0]?.action_id}`);
    await ack();
  });

  // Log any errors
  app.error(async (error) => {
    console.error(`[OASIS Bridge] ${params.accountId}: Bolt error:`, error);
  });

  return { app, accountId: params.accountId };
}
