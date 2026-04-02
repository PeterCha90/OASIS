import { App, LogLevel } from "@slack/bolt";
import { parseApprovalMessage } from "./approval-parser.js";
import { resolveApprovalOneShot } from "./gateway-client.js";

interface SlackAppConfig {
  botToken: string;
  appToken: string;
  gatewayPort: number;
  gatewayAuthToken?: string;
}

export function createOasisSlackApp(config: SlackAppConfig) {
  const app = new App({
    token: config.botToken,
    appToken: config.appToken,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  const processedMessages = new Set<string>();
  const resolvedApprovals = new Set<string>();
  let botUserId: string | undefined;

  // Detect approval messages → post clean reply + add reactions
  app.event("message", async ({ event, client }) => {
    const msg = event as any;
    const text: string = msg.text ?? "";
    const ts: string | undefined = msg.ts;
    const channel: string | undefined = msg.channel;
    if (!ts || !channel || !text) return;

    // Delete followup messages
    if (text.match(/Plugin approval (allowed|denied|expired)/i)) {
      try { await client.chat.delete({ channel, ts }); } catch {}
      return;
    }

    if (processedMessages.has(ts)) return;
    const parsed = parseApprovalMessage(text);
    if (!parsed) return;
    processedMessages.add(ts);

    try {
      // Post clean summary as reply
      await client.chat.postMessage({
        channel,
        thread_ts: ts,
        text: [
          `*${parsed.title.replace(/^🏝️\s*/, "🏝️ ")}*`,
          `*Tool:* \`${parsed.toolName}\`  •  *Risk Score:* \`${parsed.riskScore}\` / 1.0`,
          parsed.detected ? `*Detected:* ${parsed.detected}` : "",
          parsed.parameters ? `*Parameters:*\n\`\`\`${parsed.parameters.slice(0, 500)}\`\`\`` : "",
          ``,
          `React ✅ on the message above to *Allow* or 🙅 to *Deny*`,
        ].filter(Boolean).join("\n"),
      });
      // Add reactions to original
      await client.reactions.add({ channel, timestamp: ts, name: "white_check_mark" });
      await client.reactions.add({ channel, timestamp: ts, name: "no_good" });
      console.log(`[OASIS] Approval ready: ${parsed.approvalId.slice(0, 12)}`);
    } catch (err) {
      console.error(`[OASIS] Failed: ${err}`);
      processedMessages.delete(ts);
    }

    if (processedMessages.size > 1000) {
      const entries = [...processedMessages];
      for (let i = 0; i < entries.length - 500; i++) processedMessages.delete(entries[i]);
    }
  });

  // Handle reactions — ✅ = allow, 🙅 = deny
  app.event("reaction_added", async ({ event, client }) => {
    const reaction = event as any;
    const ts = reaction.item?.ts;
    const channel = reaction.item?.channel;
    const reactionName = reaction.reaction;
    const userId = reaction.user;
    if (!ts || !channel) return;

    if (!botUserId) {
      try { const auth = await client.auth.test(); botUserId = auth.user_id as string; } catch {}
    }
    if (userId === botUserId) return;

    let decision: "allow-once" | "deny";
    if (reactionName === "white_check_mark") decision = "allow-once";
    else if (reactionName === "no_good") decision = "deny";
    else return;

    // Fetch message to get approval ID
    let messageText = "";
    try {
      const result = await client.conversations.replies({ channel, ts, limit: 1, inclusive: true });
      messageText = (result.messages?.[0] as any)?.text ?? "";
    } catch {
      try {
        const result = await client.conversations.history({ channel, latest: ts, limit: 1, inclusive: true });
        messageText = (result.messages?.[0] as any)?.text ?? "";
      } catch { return; }
    }

    const parsed = parseApprovalMessage(messageText);
    if (!parsed) return;
    if (resolvedApprovals.has(parsed.approvalId)) return;
    resolvedApprovals.add(parsed.approvalId);

    const label = decision === "allow-once" ? "Allowed" : "Denied";
    const emoji = decision === "allow-once" ? "✅" : "🙅";
    console.log(`[OASIS] ${label} by <@${userId}>`);

    try {
      await resolveApprovalOneShot(config.gatewayPort, config.gatewayAuthToken, { id: parsed.approvalId, decision });
      console.log(`[OASIS] Gateway resolved: ${label}`);
      await client.chat.postMessage({ channel, thread_ts: ts, text: `${emoji} *OASIS: ${label}* by <@${userId}>` });
    } catch (err) {
      console.error(`[OASIS] Resolve failed: ${err}`);
      resolvedApprovals.delete(parsed.approvalId);
    }
  });

  app.error(async (error) => { console.error(`[OASIS] Error:`, error); });

  return app;
}
