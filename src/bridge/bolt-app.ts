import { App, LogLevel } from "@slack/bolt";
import { buildApprovalBlocks, buildResolvedBlocks } from "./blocks.js";
import { GatewayClient } from "./gateway-client.js";
import { WebClient } from "@slack/web-api";

interface BoltAppParams {
  accountId: string;
  botToken: string;
  appToken: string;
  gateway: GatewayClient;
}

interface ApprovalInfo {
  id: string;
  title: string;
  description: string;
  toolName: string;
  channel: string;
  threadTs?: string;
}

export function createBoltApp(params: BoltAppParams) {
  const app = new App({
    token: params.botToken,
    appToken: params.appToken,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  // Web client for posting messages directly
  const webClient = new WebClient(params.botToken);

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
      console.log(`[OASIS Bridge] ${params.accountId}: Denied ${id.slice(0, 12)}`);
    } catch (err) {
      console.error(`[OASIS Bridge] ${params.accountId}: Denial failed: ${err}`);
    }
  });

  /**
   * Post approval buttons to a Slack channel/thread.
   * Called externally when Gateway emits a plugin.approval.requested event.
   */
  async function postApprovalButtons(approval: ApprovalInfo): Promise<void> {
    try {
      await webClient.chat.postMessage({
        channel: approval.channel,
        thread_ts: approval.threadTs,
        text: `🏝️ OASIS Security Review — ${approval.toolName}`,
        blocks: buildApprovalBlocks({
          approvalId: approval.id,
          title: approval.title,
          toolName: approval.toolName,
          description: approval.description,
        }) as any,
      });
      console.log(`[OASIS Bridge] ${params.accountId}: Posted approval buttons for ${approval.id.slice(0, 12)}`);
    } catch (err) {
      console.error(`[OASIS Bridge] ${params.accountId}: Failed to post buttons: ${err}`);
    }
  }

  return { app, postApprovalButtons, accountId: params.accountId };
}
