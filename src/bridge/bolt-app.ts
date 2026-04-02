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
  /** Shared across all bot instances */
  processedMessages: Set<string>;
  /** Shared — tracks approval IDs being resolved to prevent duplicates */
  resolvedApprovals: Set<string>;
  /** Map of all bot tokens by accountId */
  allBotTokens: Map<string, string>;
  /** All bot user IDs — to filter out bot reactions */
  botUserIds: Set<string>;
}

// Map message ts → approval ID for reaction lookup
const approvalByMessageTs = new Map<string, string>();

export function createBoltApp(params: BoltAppParams) {
  const app = new App({
    token: params.botToken,
    appToken: params.appToken,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  // Watch for approval messages from OTHER bots.
  app.event("message", async ({ event }) => {
    const msg = event as any;
    const text: string = msg.text ?? "";
    const ts: string | undefined = msg.ts;
    const channel: string | undefined = msg.channel;

    if (!ts || !channel) return;

    // Delete "Plugin approval allowed/denied" followup messages
    if (text.match(/Plugin approval (allowed|denied)/i) && msg.bot_id) {
      try {
        // Find the bot that posted it to delete it
        for (const [, token] of params.allBotTokens) {
          try {
            const c = new WebClient(token);
            await c.chat.delete({ channel, ts });
            break;
          } catch { continue; }
        }
      } catch {}
      return;
    }

    if (params.processedMessages.has(ts)) return;

    const parsed = parseApprovalMessage(text);
    if (!parsed) return;

    params.processedMessages.add(ts);

    // Store mapping for reaction lookup
    approvalByMessageTs.set(ts, parsed.approvalId);

    // Find the bot that posted the message to update it
    const botId = msg.bot_id;
    let updateClient: WebClient | null = null;

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
      const firstToken = [...params.allBotTokens.values()][0];
      if (firstToken) updateClient = new WebClient(firstToken);
    }

    if (!updateClient) {
      params.processedMessages.delete(ts);
      return;
    }

    try {
      // Update message with clean format + reaction instructions
      await updateClient.chat.update({
        channel,
        ts,
        text: [
          `🏝️ *${parsed.title}*`,
          ``,
          `*Tool:* \`${parsed.toolName}\`  •  *Risk Score:* \`${parsed.riskScore}\` / 1.0`,
          `*Detected:* ${parsed.detected}`,
          parsed.parameters ? `\n*Parameters:*\n\`\`\`${parsed.parameters.slice(0, 500)}\`\`\`` : "",
          ``,
          `React ✅ to *Allow* or ❌ to *Deny*`,
        ].filter(Boolean).join("\n"),
      });

      // Add reaction options to the message
      await updateClient.reactions.add({ channel, timestamp: ts, name: "white_check_mark" });
      await updateClient.reactions.add({ channel, timestamp: ts, name: "x" });

      console.log(`[OASIS Bridge] Approval ready: ${parsed.approvalId.slice(0, 12)} — react ✅ or ❌`);
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

  // Handle reactions — ✅ = allow, ❌ = deny
  app.event("reaction_added", async ({ event, client }) => {
    const reaction = event as any;
    const ts = reaction.item?.ts;
    const channel = reaction.item?.channel;
    const reactionName = reaction.reaction;
    const userId = reaction.user;

    if (!ts || !channel) return;

    // Ignore reactions from ANY bot
    if (params.botUserIds.has(userId)) return;

    // Check if this is a reaction on an approval message
    const approvalId = approvalByMessageTs.get(ts);
    if (!approvalId) return;

    // Only process ✅ or ❌
    let decision: "allow-once" | "deny";
    if (reactionName === "white_check_mark") {
      decision = "allow-once";
    } else if (reactionName === "x") {
      decision = "deny";
    } else {
      return;
    }

    // Prevent duplicate resolution
    if (params.resolvedApprovals.has(approvalId)) return;
    params.resolvedApprovals.add(approvalId);

    const label = decision === "allow-once" ? "Allowed" : "Denied";
    const emoji = decision === "allow-once" ? "✅" : "❌";

    console.log(`[OASIS Bridge] ${params.accountId}: ${label} by user ${userId}`);

    try {
      await resolveApprovalOneShot(params.gatewayPort, params.gatewayAuthToken, {
        id: approvalId,
        decision,
      });
      console.log(`[OASIS Bridge] Gateway resolved: ${label}`);

      // Find the right bot to update the message
      const botId = (await client.auth.test()).bot_id;
      let updateClient: WebClient = client;

      // Try each bot token to find the message owner
      for (const [, token] of params.allBotTokens) {
        try {
          const testClient = new WebClient(token);
          await testClient.chat.update({
            channel,
            ts,
            text: `${emoji} *OASIS: ${label}* by <@${userId}>`,
          });
          updateClient = testClient;
          console.log(`[OASIS Bridge] Message updated: ${label}`);
          break;
        } catch {
          continue;
        }
      }
    } catch (err) {
      console.error(`[OASIS Bridge] Resolve failed: ${err}`);
      params.resolvedApprovals.delete(approvalId);
    }

    // Cleanup
    approvalByMessageTs.delete(ts);
  });

  app.error(async (error) => {
    console.error(`[OASIS Bridge] ${params.accountId}: Error:`, error);
  });

  return { app, accountId: params.accountId };
}
