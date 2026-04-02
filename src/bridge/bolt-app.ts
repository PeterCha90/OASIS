import { App, LogLevel } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import { parseApprovalMessage } from "./approval-parser.js";
import { resolveApprovalOneShot } from "./gateway-client.js";

interface BoltAppParams {
  accountId: string;
  botToken: string;
  appToken: string;
  gatewayPort: number;
  gatewayAuthToken?: string;
  /** Shared — prevents duplicate approval resolution */
  resolvedApprovals: Set<string>;
  /** Map of all bot tokens by accountId */
  allBotTokens: Map<string, string>;
  /** All bot user IDs — to filter out bot reactions */
  botUserIds: Set<string>;
  /** Shared — prevents duplicate reaction adding */
  processedMessages: Set<string>;
}

export function createBoltApp(params: BoltAppParams) {
  const app = new App({
    token: params.botToken,
    appToken: params.appToken,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  // Handle reactions — ✅ = allow, 🙅 = deny
  // This is the ONLY detection mechanism. No message event dependency.
  // When user reacts: fetch the message, parse approval ID, resolve.
  app.event("reaction_added", async ({ event, client }) => {
    const reaction = event as any;
    const ts = reaction.item?.ts;
    const channel = reaction.item?.channel;
    const reactionName = reaction.reaction;
    const userId = reaction.user;

    if (!ts || !channel) return;

    // Ignore bot reactions
    if (params.botUserIds.has(userId)) return;

    // Only process ✅ or 🙅
    let decision: "allow-once" | "deny";
    if (reactionName === "white_check_mark") {
      decision = "allow-once";
    } else if (reactionName === "no_good") {
      decision = "deny";
    } else {
      return;
    }

    // Fetch the message to get the approval ID
    let messageText = "";
    try {
      const result = await client.conversations.replies({
        channel,
        ts,
        limit: 1,
        inclusive: true,
      });
      messageText = (result.messages?.[0] as any)?.text ?? "";
    } catch {
      // Try conversations.history as fallback
      try {
        const result = await client.conversations.history({
          channel,
          latest: ts,
          limit: 1,
          inclusive: true,
        });
        messageText = (result.messages?.[0] as any)?.text ?? "";
      } catch {
        return;
      }
    }

    // Parse approval ID from the message
    const parsed = parseApprovalMessage(messageText);
    if (!parsed) return;

    // Prevent duplicate resolution
    if (params.resolvedApprovals.has(parsed.approvalId)) return;
    params.resolvedApprovals.add(parsed.approvalId);

    const label = decision === "allow-once" ? "Allowed" : "Denied";
    const emoji = decision === "allow-once" ? "✅" : "🙅";

    console.log(`[OASIS Bridge] ${params.accountId}: ${label} by <@${userId}>`);

    try {
      await resolveApprovalOneShot(params.gatewayPort, params.gatewayAuthToken, {
        id: parsed.approvalId,
        decision,
      });
      console.log(`[OASIS Bridge] Gateway resolved: ${label}`);

      // Update the message to show result
      for (const [, token] of params.allBotTokens) {
        try {
          const c = new WebClient(token);
          await c.chat.update({
            channel,
            ts,
            text: `${emoji} *OASIS: ${label}* by <@${userId}>`,
          });
          console.log(`[OASIS Bridge] Message updated: ${label}`);
          break;
        } catch { continue; }
      }

      // Delete any "Plugin approval allowed/denied" followup
      // Wait a moment for OpenClaw to post it
      setTimeout(async () => {
        try {
          const history = await client.conversations.history({
            channel,
            oldest: ts,
            limit: 5,
          });
          for (const msg of history.messages ?? []) {
            const txt = (msg as any).text ?? "";
            if (txt.match(/Plugin approval (allowed|denied|expired)/i)) {
              for (const [, token] of params.allBotTokens) {
                try {
                  const c = new WebClient(token);
                  await c.chat.delete({ channel, ts: (msg as any).ts });
                  break;
                } catch { continue; }
              }
            }
          }
        } catch {}
      }, 3000);

    } catch (err) {
      console.error(`[OASIS Bridge] Resolve failed: ${err}`);
      params.resolvedApprovals.delete(parsed.approvalId);
    }
  });

  // Also watch messages to add reactions to approval messages (best-effort)
  app.event("message", async ({ event }) => {
    const msg = event as any;
    const text: string = msg.text ?? "";
    const ts: string | undefined = msg.ts;
    const channel: string | undefined = msg.channel;

    if (!ts || !channel || !text) return;

    const parsed = parseApprovalMessage(text);
    if (!parsed) return;

    // Only one bot adds reactions
    if (params.processedMessages.has(ts)) return;
    params.processedMessages.add(ts);

    // Add reaction hints (best-effort)
    try {
      for (const [, token] of params.allBotTokens) {
        try {
          const c = new WebClient(token);
          await c.reactions.add({ channel, timestamp: ts, name: "white_check_mark" });
          await c.reactions.add({ channel, timestamp: ts, name: "no_good" });
          console.log(`[OASIS Bridge] Reactions added to ${parsed.approvalId.slice(0, 12)}`);
          break;
        } catch { continue; }
      }
    } catch {}
  });

  app.error(async (error) => {
    console.error(`[OASIS Bridge] ${params.accountId}: Error:`, error);
  });

  return { app, accountId: params.accountId };
}
