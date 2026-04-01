import { App, LogLevel } from "@slack/bolt";
import { parseApprovalMessage } from "./approval-parser.js";
import { buildApprovalBlocks, buildResolvedBlocks } from "./blocks.js";

interface BoltAppParams {
  accountId: string;
  botToken: string;
  appToken: string;
  gatewayPort: number;
  gatewayAuthToken?: string;
}

export function createBoltApp(params: BoltAppParams) {
  const app = new App({
    token: params.botToken,
    appToken: params.appToken,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  const processedMessages = new Set<string>();

  // Watch for messages from OTHER bots that contain approval patterns.
  // Bot A can see Bot B's messages. Each bridge instance watches for
  // approval messages NOT from itself.
  app.event("message", async ({ event, client }) => {
    const msg = event as any;
    const text: string = msg.text ?? "";
    const ts: string | undefined = msg.ts;
    const channel: string | undefined = msg.channel;
    const threadTs: string | undefined = msg.thread_ts;

    if (!ts || !channel || processedMessages.has(ts)) return;

    const parsed = parseApprovalMessage(text);
    if (!parsed) return;

    processedMessages.add(ts);

    // Post a NEW message with buttons in the same thread (or channel)
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
        `[OASIS Bridge] ${params.accountId}: Posted buttons for ${parsed.approvalId.slice(0, 12)}`
      );
    } catch (err) {
      console.error(
        `[OASIS Bridge] ${params.accountId}: Failed to post buttons: ${err}`
      );
      processedMessages.delete(ts);
    }

    // Prune old entries
    if (processedMessages.size > 1000) {
      const entries = [...processedMessages];
      for (let i = 0; i < entries.length - 500; i++) {
        processedMessages.delete(entries[i]);
      }
    }
  });

  // Handle Allow button click
  app.action("oasis_approve", async ({ ack, body, client }) => {
    await ack();
    const action = (body as any).actions?.[0];
    if (!action?.value) return;

    const { id, decision } = JSON.parse(action.value);
    try {
      // Post /approve command as a message in the channel
      // OpenClaw processes commands from chat messages
      const channel = (body as any).channel?.id;
      if (channel) {
        await client.chat.postMessage({
          channel,
          thread_ts: (body as any).message?.thread_ts,
          text: `/approve ${id} ${decision}`,
        });
      }

      await client.chat.update({
        channel,
        ts: (body as any).message.ts,
        text: `✅ Approved`,
        blocks: buildResolvedBlocks({
          decision,
          resolvedBy: body.user.id,
        }) as any,
      });
      console.log(`[OASIS Bridge] ${params.accountId}: Approved ${id.slice(0, 12)}`);
    } catch (err) {
      console.error(`[OASIS Bridge] ${params.accountId}: Approval failed: ${err}`);
    }
  });

  // Handle Deny button click
  app.action("oasis_deny", async ({ ack, body, client }) => {
    await ack();
    const action = (body as any).actions?.[0];
    if (!action?.value) return;

    const { id, decision } = JSON.parse(action.value);
    try {
      const channel = (body as any).channel?.id;
      if (channel) {
        await client.chat.postMessage({
          channel,
          thread_ts: (body as any).message?.thread_ts,
          text: `/approve ${id} ${decision}`,
        });
      }

      await client.chat.update({
        channel,
        ts: (body as any).message.ts,
        text: `❌ Denied`,
        blocks: buildResolvedBlocks({
          decision,
          resolvedBy: body.user.id,
        }) as any,
      });
      console.log(`[OASIS Bridge] ${params.accountId}: Denied ${id.slice(0, 12)}`);
    } catch (err) {
      console.error(`[OASIS Bridge] ${params.accountId}: Denial failed: ${err}`);
    }
  });

  return { app, accountId: params.accountId };
}
