import { describe, test, expect } from "vitest";
import { buildApprovalBlocks, buildResolvedBlocks } from "../../src/bridge/blocks.js";

describe("Block Kit Builder", () => {
  test("should build approval blocks with buttons", () => {
    const blocks = buildApprovalBlocks({
      approvalId: "plugin:test-123",
      title: "🏝️ OASIS Security Review",
      toolName: "exec",
      riskScore: "0.6",
      detected: "Sensitive file access",
      parameters: '{ "command": "cat .env" }',
    });

    expect(blocks.length).toBeGreaterThan(0);

    const actionsBlock = blocks.find((b: any) => b.type === "actions");
    expect(actionsBlock).toBeDefined();
    expect(actionsBlock!.elements).toHaveLength(2);
    expect(actionsBlock!.elements![0].action_id).toBe("oasis_approve");
    expect(actionsBlock!.elements![1].action_id).toBe("oasis_deny");
  });

  test("should include approval ID in button values", () => {
    const blocks = buildApprovalBlocks({
      approvalId: "plugin:abc-123",
      title: "Test",
      toolName: "exec",
      riskScore: "0.5",
      detected: "test",
      parameters: "",
    });

    const actionsBlock = blocks.find((b: any) => b.type === "actions");
    const approveValue = JSON.parse(actionsBlock!.elements![0].value!);
    expect(approveValue.id).toBe("plugin:abc-123");
    expect(approveValue.decision).toBe("allow-once");
  });

  test("should build resolved blocks for allow", () => {
    const blocks = buildResolvedBlocks({
      decision: "allow-once",
      resolvedBy: "U12345",
    });
    const text = JSON.stringify(blocks);
    expect(text).toContain("Allowed");
    expect(text).toContain("U12345");
  });

  test("should build resolved blocks for deny", () => {
    const blocks = buildResolvedBlocks({ decision: "deny" });
    const text = JSON.stringify(blocks);
    expect(text).toContain("Denied");
  });
});
