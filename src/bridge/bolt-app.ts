import { App, LogLevel } from "@slack/bolt";
import { parseApprovalMessage } from "./approval-parser.js";
import { buildApprovalBlocks, buildResolvedBlocks } from "./blocks.js";
import { GatewayClient } from "./gateway-client.js";

interface BoltAppParams {
  accountId: string;
  botToken: string;
  appToken: string;
  gateway: GatewayClient;
}

export function createBoltApp(params: BoltAppParams): App {
  const app = new App({
    token: params.botToken,
    appToken: params.appToken,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  // Track messages we've already updated to avoid loops
  const processedMessages = new Set<string>();

  // Watch for ALL messages (including bot messages) for approval patterns.
  // Use event listener instead of app.message() to catch bot_message subtypes.
  app.event("message", async ({ event, client }) => {
    const msg = event as any;
    const text: string = msg.text ?? "";
    const ts: string | undefined = msg.ts;
    const channel: string | undefined = msg.channel;

    // Skip if already processed
    if (!ts || !channel || processedMessages.has(ts)) return;

    // Only process messages that contain approval patterns
    const parsed = parseApprovalMessage(text);
    if (!parsed) return;

    // Mark as processed before async work to prevent duplicate processing
    processedMessages.add(ts);

    // Update the message with Block Kit buttons
    try {
      await client.chat.update({
        channel,
        ts,
        text, // keep original text as fallback
        blocks: buildApprovalBlocks({
          approvalId: parsed.approvalId,
          title: parsed.title,
          toolName: parsed.toolName,
          description: parsed.description,
        }) as any,
      });
      console.log(
        `[OASIS Bridge] ${params.accountId}: Approval buttons added for ${parsed.approvalId.slice(0, 12)}`
      );
    } catch (err) {
      console.error(
        `[OASIS Bridge] ${params.accountId}: Failed to update message: ${err}`
      );
      // Remove from processed so a retry is possible
      processedMessages.delete(ts);
    }

    // Clean up old entries (keep last 500)
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

    const { id, decision } = JSON.parse(action.value) as {
      id: string;
      decision: "allow-once" | "allow-always" | "deny";
    };
    try {
      await params.gateway.resolveApproval({ id, decision });
      await client.chat.update({
        channel: (body as any).channel.id,
        ts: (body as any).message.ts,
        text: `Approved: ${id}`,
        blocks: buildResolvedBlocks({
          decision,
          resolvedBy: body.user.id,
        }) as any,
      });
      console.log(
        `[OASIS Bridge] ${params.accountId}: Approved ${id.slice(0, 12)}`
      );
    } catch (err) {
      console.error(
        `[OASIS Bridge] ${params.accountId}: Approval failed: ${err}`
      );
    }
  });

  // Handle Deny button click
  app.action("oasis_deny", async ({ ack, body, client }) => {
    await ack();
    const action = (body as any).actions?.[0];
    if (!action?.value) return;

    const { id, decision } = JSON.parse(action.value) as {
      id: string;
      decision: "allow-once" | "allow-always" | "deny";
    };
    try {
      await params.gateway.resolveApproval({ id, decision });
      await client.chat.update({
        channel: (body as any).channel.id,
        ts: (body as any).message.ts,
        text: `Denied: ${id}`,
        blocks: buildResolvedBlocks({
          decision,
          resolvedBy: body.user.id,
        }) as any,
      });
      console.log(
        `[OASIS Bridge] ${params.accountId}: Denied ${id.slice(0, 12)}`
      );
    } catch (err) {
      console.error(
        `[OASIS Bridge] ${params.accountId}: Denial failed: ${err}`
      );
    }
  });

  return app;
}
