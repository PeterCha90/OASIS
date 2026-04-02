// tests/slack/approval-parser.test.ts
import { describe, test, expect } from "vitest";
import { parseApprovalMessage } from "../../src/slack/approval-parser.js";

const SAMPLE_MESSAGE = `Plugin approval required

Title: 🏝️ OASIS [0.7] Privilege escalation
Tool: bash
Plugin: oasis
ID: plugin:a1b2c3d4-e5f6-7890-abcd-ef1234567890
Risk Score: \`0.7\` / 1.0 | Detected: **Privilege escalation** | Parameters: \`{"command":"sudo rm -rf /tmp/test"}\``;

const FULL_MESSAGE = `Plugin approval required

Title: 🏝️ OASIS [0.5] Sensitive file access
Tool: read
Plugin: oasis
ID: plugin:deadbeef-dead-beef-dead-beefdeadbeef
Risk Score: **0.5**
Detected: **Sensitive file path**

Parameters:
\`\`\`
{"path": "~/.ssh/id_rsa"}
\`\`\``;

describe("parseApprovalMessage", () => {
  test("returns null for non-approval messages", () => {
    expect(parseApprovalMessage("Hello world")).toBeNull();
    expect(parseApprovalMessage("")).toBeNull();
    expect(parseApprovalMessage("Plugin approval required")).toBeNull(); // missing ID
  });

  test("parses approvalId from plugin: prefix", () => {
    const parsed = parseApprovalMessage(SAMPLE_MESSAGE);
    expect(parsed).not.toBeNull();
    expect(parsed!.approvalId).toBe("plugin:a1b2c3d4-e5f6-7890-abcd-ef1234567890");
  });

  test("parses toolName", () => {
    const parsed = parseApprovalMessage(SAMPLE_MESSAGE);
    expect(parsed!.toolName).toBe("bash");
  });

  test("parses pluginName", () => {
    const parsed = parseApprovalMessage(SAMPLE_MESSAGE);
    expect(parsed!.pluginName).toBe("oasis");
  });

  test("parses riskScore from bracket notation", () => {
    const parsed = parseApprovalMessage(SAMPLE_MESSAGE);
    expect(parsed!.riskScore).toBe("0.7");
  });

  test("parses title", () => {
    const parsed = parseApprovalMessage(SAMPLE_MESSAGE);
    expect(parsed!.title).toContain("OASIS");
  });

  test("parses detected field", () => {
    const parsed = parseApprovalMessage(SAMPLE_MESSAGE);
    expect(parsed!.detected).toContain("Privilege escalation");
  });

  test("parses parameters from fenced code block", () => {
    const parsed = parseApprovalMessage(FULL_MESSAGE);
    expect(parsed).not.toBeNull();
    expect(parsed!.parameters).toContain(".ssh/id_rsa");
  });

  test("parses approvalId from FULL_MESSAGE", () => {
    const parsed = parseApprovalMessage(FULL_MESSAGE);
    expect(parsed!.approvalId).toBe("plugin:deadbeef-dead-beef-dead-beefdeadbeef");
  });

  test("parses riskScore from Risk Score field", () => {
    const parsed = parseApprovalMessage(FULL_MESSAGE);
    expect(parsed!.riskScore).toBe("0.5");
  });

  test("returns fallback values for missing optional fields", () => {
    const minimal = `Plugin approval required\nID: plugin:aaaabbbb-0000-1111-2222-ccccddddeeee\nTool: exec`;
    const parsed = parseApprovalMessage(minimal);
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe("Approval Required");
    expect(parsed!.pluginName).toBe("unknown");
    expect(parsed!.riskScore).toBe("?");
    expect(parsed!.detected).toBe("");
    expect(parsed!.parameters).toBe("");
  });

  test("handles uppercase ID prefix", () => {
    const msg = `Plugin approval required\nID: PLUGIN:aabbccdd-1234-5678-9abc-def012345678\nTool: write`;
    const parsed = parseApprovalMessage(msg);
    expect(parsed).not.toBeNull();
    expect(parsed!.approvalId).toBe("PLUGIN:aabbccdd-1234-5678-9abc-def012345678");
  });
});
