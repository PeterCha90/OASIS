interface ApprovalBlocksParams {
  approvalId: string;
  title: string;
  toolName: string;
  description: string;
}

interface Block {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  fields?: { type: string; text: string }[];
  elements?: { type: string; text: { type: string; text: string; emoji?: boolean }; style?: string; action_id: string; value?: string }[];
  [key: string]: unknown;
}

export function buildApprovalBlocks(params: ApprovalBlocksParams): Block[] {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: params.title, emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Tool:* \`${params.toolName}\`` },
        { type: "mrkdwn", text: `*ID:* \`${params.approvalId.slice(0, 12)}...\`` },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: params.description.slice(0, 2000) },
    },
    { type: "divider" },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "✅ Allow", emoji: true },
          style: "primary",
          action_id: "oasis_approve",
          value: JSON.stringify({ id: params.approvalId, decision: "allow-once" }),
        },
        {
          type: "button",
          text: { type: "plain_text", text: "❌ Deny", emoji: true },
          style: "danger",
          action_id: "oasis_deny",
          value: JSON.stringify({ id: params.approvalId, decision: "deny" }),
        },
      ],
    },
  ];
}

interface ResolvedBlocksParams {
  decision: string;
  resolvedBy?: string;
}

export function buildResolvedBlocks(params: ResolvedBlocksParams): Block[] {
  const emoji = params.decision === "deny" ? "❌" : "✅";
  const label = params.decision === "deny" ? "Denied" : "Allowed";
  const who = params.resolvedBy ? ` by <@${params.resolvedBy}>` : "";

  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: `${emoji} *OASIS: ${label}*${who}` },
    },
  ];
}
