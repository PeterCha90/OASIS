import { describe, test, expect } from "vitest";
import { parseApprovalMessage } from "../../src/bridge/approval-parser.js";

const SAMPLE_MESSAGE = `🦞 Plugin approval required
Title: 🏝️ OASIS Security Review
Description: **Risk Score:** \`0.6\` / 1.0
**Tool:** \`exec\`
**Detected:** Sensitive file access

**Parameters:**
\`\`\`
{
  "command": "cat ~/.openclaw/.env"
}
\`\`\`
Tool: exec
Plugin: oasis
Agent: pa
ID: plugin:bc92b8cc-9e7e-4f48-b647-3aa7617771ac
Expires in: 120s
Reply with: /approve <id> allow-once|allow-always|deny`;

describe("Approval Parser", () => {
  test("should parse approval ID from message", () => {
    const result = parseApprovalMessage(SAMPLE_MESSAGE);
    expect(result).not.toBeNull();
    expect(result!.approvalId).toBe("plugin:bc92b8cc-9e7e-4f48-b647-3aa7617771ac");
  });

  test("should parse tool name", () => {
    const result = parseApprovalMessage(SAMPLE_MESSAGE);
    expect(result!.toolName).toBe("exec");
  });

  test("should parse plugin name", () => {
    const result = parseApprovalMessage(SAMPLE_MESSAGE);
    expect(result!.pluginName).toBe("oasis");
  });

  test("should parse title", () => {
    const result = parseApprovalMessage(SAMPLE_MESSAGE);
    expect(result!.title).toContain("OASIS");
  });

  test("should return null for non-approval message", () => {
    expect(parseApprovalMessage("Hello, how are you?")).toBeNull();
  });

  test("should return null for message without ID", () => {
    expect(parseApprovalMessage("Plugin approval required\nNo ID here")).toBeNull();
  });
});
