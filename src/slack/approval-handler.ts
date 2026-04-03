import { App, LogLevel } from "@slack/bolt";
import { parseApprovalMessage } from "./approval-parser.js";
import { resolveApprovalOneShot } from "./gateway-client.js";
import { makeKeyFromParsed, allowAlways, getEntries, removeEntry, clearAll } from "../allowlist.js";

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
      try {
        await client.chat.delete({ channel, ts });
      } catch (delErr) {
        // chat.delete can fail due to permissions; fall back to blanking the message
        try {
          await client.chat.update({
            channel,
            ts,
            text: " ",
            blocks: [],
          });
        } catch (updErr) {
          console.error(`[OASIS] Failed to remove followup message: delete=${delErr}, update=${updErr}`);
        }
      }
      return;
    }

    if (processedMessages.has(ts)) return;
    const parsed = parseApprovalMessage(text);
    if (!parsed) return;
    processedMessages.add(ts);

    // Encode allowlist key into "Allow Always" button value (avoids cross-instance Map issues)
    const allowlistKey = makeKeyFromParsed(parsed.toolName, parsed.parameters);
    const allowAlwaysValue = JSON.stringify({ id: parsed.approvalId, key: allowlistKey });

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
                text: { type: "plain_text", text: "🔁 Allow Always", emoji: true },
                action_id: "oasis_allow_always",
                value: allowAlwaysValue,
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

  // Handle Allow Always button
  app.action("oasis_allow_always", async ({ ack, body, client }) => {
    await ack();
    const rawValue = (body as any).actions?.[0]?.value;
    let approvalId: string;
    let allowlistKey: string | undefined;
    try {
      const parsed = JSON.parse(rawValue);
      approvalId = parsed.id;
      allowlistKey = parsed.key;
    } catch {
      approvalId = rawValue; // fallback
    }
    if (!approvalId || resolvedApprovals.has(approvalId)) return;
    resolvedApprovals.add(approvalId);

    const userId = body.user.id;
    const channel = (body as any).channel?.id;
    const messageTs = (body as any).message?.ts;

    console.log(`[OASIS] Allow-always by <@${userId}>`);

    try {
      await resolveApprovalOneShot(config.gatewayPort, config.gatewayAuthToken, {
        id: approvalId,
        decision: "allow-always",
      });

      // Register in OASIS allowlist so future identical calls skip approval
      if (allowlistKey) {
        allowAlways(allowlistKey, userId);
      }

      console.log(`[OASIS] Gateway resolved: Allow-always`);

      if (channel && messageTs) {
        await client.chat.update({
          channel,
          ts: messageTs,
          text: `🔁 OASIS: Always allowed by <@${userId}>`,
          blocks: [{
            type: "section",
            text: { type: "mrkdwn", text: `🔁 *OASIS: Always allowed* by <@${userId}>\n_DM me \`list\` to manage the allowlist._` },
          }] as any,
        });
      }
    } catch (err) {
      console.error(`[OASIS] Allow-always failed: ${err}`);
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

  // ── Allowlist management via DM ──
  app.event("message", async ({ event, client }) => {
    const msg = event as any;
    if (msg.channel_type !== "im") return; // DM only
    const text: string = (msg.text ?? "").trim().toLowerCase();
    const channel: string | undefined = msg.channel;
    if (!channel) return;

    if (text === "list" || text === "allowlist") {
      const list = getEntries();
      if (list.length === 0) {
        await client.chat.postMessage({
          channel,
          text: "🏝️ Allowlist is empty. No commands are auto-approved.",
        });
        return;
      }

      const blocks: any[] = [
        { type: "header", text: { type: "plain_text", text: `🏝️ OASIS Allowlist (${list.length})`, emoji: true } },
        { type: "divider" },
      ];

      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        const addedDate = new Date(e.addedAt).toLocaleDateString();
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${i + 1}.* \`${e.label}\`\n_Added by <@${e.addedBy}> on ${addedDate}_`,
          },
          accessory: {
            type: "button",
            text: { type: "plain_text", text: "🗑️ Remove", emoji: true },
            style: "danger",
            action_id: "oasis_allowlist_remove",
            value: String(i),
          },
        });
      }

      blocks.push(
        { type: "divider" },
        {
          type: "actions",
          elements: [{
            type: "button",
            text: { type: "plain_text", text: "🗑️ Clear All", emoji: true },
            style: "danger",
            action_id: "oasis_allowlist_clear",
            confirm: {
              title: { type: "plain_text", text: "Clear allowlist?" },
              text: { type: "plain_text", text: "This will remove all auto-approved commands." },
              confirm: { type: "plain_text", text: "Clear All" },
              deny: { type: "plain_text", text: "Cancel" },
            },
          }],
        },
      );

      await client.chat.postMessage({ channel, text: "OASIS Allowlist", blocks });
      return;
    }

    if (text === "help") {
      await client.chat.postMessage({
        channel,
        text: [
          "🏝️ *OASIS Bot Commands*",
          "• `list` — View and manage the allowlist",
          "• `help` — Show this message",
        ].join("\n"),
      });
    }
  });

  // Handle allowlist remove button
  app.action("oasis_allowlist_remove", async ({ ack, body, client }) => {
    await ack();
    const index = parseInt((body as any).actions?.[0]?.value, 10);
    const channel = (body as any).channel?.id;
    const removed = removeEntry(index);

    if (removed && channel) {
      await client.chat.postMessage({
        channel,
        text: `✅ Removed: \`${removed.label}\`\nSend \`list\` to see the updated allowlist.`,
      });
    }
  });

  // Handle allowlist clear all button
  app.action("oasis_allowlist_clear", async ({ ack, body, client }) => {
    await ack();
    const channel = (body as any).channel?.id;
    const count = clearAll();

    if (channel) {
      await client.chat.postMessage({
        channel,
        text: `✅ Cleared ${count} entries from the allowlist.`,
      });
    }
  });

  app.error(async (error) => { console.error(`[OASIS] Error:`, error); });

  return app;
}
