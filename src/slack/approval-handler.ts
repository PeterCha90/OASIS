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

  // Detect approval messages → post Block Kit buttons
  app.event("message", async ({ event, client }) => {
    const msg = event as any;
    const text: string = msg.text ?? "";
    const ts: string | undefined = msg.ts;
    const channel: string | undefined = msg.channel;
    if (!ts || !channel || !text) return;

    // Delete followup messages from OpenClaw
    if (text.match(/Plugin approval (allowed|denied|expired)/i)) {
      try { await client.chat.delete({ channel, ts }); } catch {}
      return;
    }

    if (processedMessages.has(ts)) return;
    const parsed = parseApprovalMessage(text);
    if (!parsed) return;
    processedMessages.add(ts);

    try {
      await client.chat.postMessage({
        channel,
        thread_ts: ts,
        text: `🏝️ OASIS: ${parsed.detected || "Security Review"}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: [
                `*🏝️ ${parsed.title.replace(/^🏝️\s*/, "")}*`,
                `*Tool:* \`${parsed.toolName}\`  •  *Risk Score:* \`${parsed.riskScore}\` / 1.0`,
                parsed.detected ? `*Detected:* ${parsed.detected}` : "",
                parsed.parameters ? `*Parameters:*\n\`\`\`${parsed.parameters.slice(0, 300)}\`\`\`` : "",
              ].filter(Boolean).join("\n"),
            },
          },
          { type: "divider" },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "✅ Allow", emoji: true },
                style: "primary",
                action_id: "oasis_allow",
                value: parsed.approvalId,
              },
              {
                type: "button",
                text: { type: "plain_text", text: "🙅 Deny", emoji: true },
                style: "danger",
                action_id: "oasis_deny",
                value: parsed.approvalId,
              },
            ],
          },
        ] as any,
      });
      console.log(`[OASIS] Approval buttons posted: ${parsed.approvalId.slice(0, 12)}`);
    } catch (err) {
      console.error(`[OASIS] Failed to post buttons: ${err}`);
      processedMessages.delete(ts);
    }

    // Prune
    if (processedMessages.size > 1000) {
      const entries = [...processedMessages];
      for (let i = 0; i < entries.length - 500; i++) processedMessages.delete(entries[i]);
    }
  });

  // Handle Allow button
  app.action("oasis_allow", async ({ ack, body, client }) => {
    await ack();
    const approvalId = (body as any).actions?.[0]?.value;
    if (!approvalId || resolvedApprovals.has(approvalId)) return;
    resolvedApprovals.add(approvalId);

    const userId = body.user.id;
    const channel = (body as any).channel?.id;
    const messageTs = (body as any).message?.ts;

    console.log(`[OASIS] Allow by <@${userId}>`);

    try {
      await resolveApprovalOneShot(config.gatewayPort, config.gatewayAuthToken, {
        id: approvalId,
        decision: "allow-once",
      });
      console.log(`[OASIS] Gateway resolved: Allowed`);

      if (channel && messageTs) {
        await client.chat.update({
          channel,
          ts: messageTs,
          text: `✅ OASIS: Allowed by <@${userId}>`,
          blocks: [{
            type: "section",
            text: { type: "mrkdwn", text: `✅ *OASIS: Allowed* by <@${userId}>` },
          }] as any,
        });
      }
    } catch (err) {
      console.error(`[OASIS] Allow failed: ${err}`);
      resolvedApprovals.delete(approvalId);
    }
  });

  // Handle Deny button
  app.action("oasis_deny", async ({ ack, body, client }) => {
    await ack();
    const approvalId = (body as any).actions?.[0]?.value;
    if (!approvalId || resolvedApprovals.has(approvalId)) return;
    resolvedApprovals.add(approvalId);

    const userId = body.user.id;
    const channel = (body as any).channel?.id;
    const messageTs = (body as any).message?.ts;

    console.log(`[OASIS] Deny by <@${userId}>`);

    try {
      await resolveApprovalOneShot(config.gatewayPort, config.gatewayAuthToken, {
        id: approvalId,
        decision: "deny",
      });
      console.log(`[OASIS] Gateway resolved: Denied`);

      if (channel && messageTs) {
        await client.chat.update({
          channel,
          ts: messageTs,
          text: `🙅 OASIS: Denied by <@${userId}>`,
          blocks: [{
            type: "section",
            text: { type: "mrkdwn", text: `🙅 *OASIS: Denied* by <@${userId}>` },
          }] as any,
        });
      }
    } catch (err) {
      console.error(`[OASIS] Deny failed: ${err}`);
      resolvedApprovals.delete(approvalId);
    }
  });

  app.error(async (error) => { console.error(`[OASIS] Error:`, error); });

  return app;
}
