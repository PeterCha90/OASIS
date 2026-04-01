import { App, LogLevel } from "@slack/bolt";
import { parseApprovalMessage } from "./approval-parser.js";
import { buildApprovalBlocks, buildResolvedBlocks } from "./blocks.js";
import { resolveApprovalOneShot } from "./gateway-client.js";

interface BoltAppParams {
  accountId: string;
  botToken: string;
  appToken: string;
  gatewayPort: number;
  gatewayAuthToken?: string;
  /** Shared across all bot instances — prevents duplicate button posts */
  processedMessages: Set<string>;
}

export function createBoltApp(params: BoltAppParams) {
  const app = new App({
    token: params.botToken,
    appToken: params.appToken,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  // Watch for approval messages from OTHER bots
  app.event("message", async ({ event, client }) => {
    const msg = event as any;
    const text: string = msg.text ?? "";
    const ts: string | undefined = msg.ts;
    const channel: string | undefined = msg.channel;
    const threadTs: string | undefined = msg.thread_ts;

    if (!ts || !channel) return;

    // Shared set — if ANY bot already handled this message, skip
    if (params.processedMessages.has(ts)) return;

    const parsed = parseApprovalMessage(text);
    if (!parsed) return;

    // Claim this message — other bots will see the Set and skip
    params.processedMessages.add(ts);

    try {
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs ?? ts,
        text: `🏝️ OASIS: Approve or Deny?`,
        blocks: buildApprovalBlocks({
          approvalId: parsed.approvalId,
          title: parsed.title,
          toolName: parsed.toolName,
          description: parsed.description,
        }) as any,
      });
      console.log(
        `[OASIS Bridge] ${params.accountId}: Buttons posted for ${parsed.approvalId.slice(0, 12)}`
      );
    } catch (err) {
      console.error(
        `[OASIS Bridge] ${params.accountId}: Failed: ${err}`
      );
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
    await ack();
    const action = (body as any).actions?.[0];
    if (!action?.value) return;

    const { id, decision } = JSON.parse(action.value);
    try {
      await resolveApprovalOneShot(params.gatewayPort, params.gatewayAuthToken, {
        id,
        decision,
      });
      await client.chat.update({
        channel: (body as any).channel.id,
        ts: (body as any).message.ts,
        text: `✅ Approved`,
        blocks: buildResolvedBlocks({ decision, resolvedBy: body.user.id }) as any,
      });
      console.log(`[OASIS Bridge] Approved ${id.slice(0, 12)}`);
    } catch (err) {
      console.error(`[OASIS Bridge] Approval failed: ${err}`);
    }
  });

  // Handle Deny button
  app.action("oasis_deny", async ({ ack, body, client }) => {
    await ack();
    const action = (body as any).actions?.[0];
    if (!action?.value) return;

    const { id, decision } = JSON.parse(action.value);
    try {
      await resolveApprovalOneShot(params.gatewayPort, params.gatewayAuthToken, {
        id,
        decision,
      });
      await client.chat.update({
        channel: (body as any).channel.id,
        ts: (body as any).message.ts,
        text: `❌ Denied`,
        blocks: buildResolvedBlocks({ decision, resolvedBy: body.user.id }) as any,
      });
      console.log(`[OASIS Bridge] Denied ${id.slice(0, 12)}`);
    } catch (err) {
      console.error(`[OASIS Bridge] Denial failed: ${err}`);
    }
  });

  return { app, accountId: params.accountId };
}
