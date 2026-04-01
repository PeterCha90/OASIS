// tests/integration.test.ts
import { describe, test, expect } from "vitest";
import { handleBeforeToolCall } from "../src/index.js";
import { defaultConfig } from "../src/config.js";

describe("Plugin Integration — handleBeforeToolCall", () => {
  test("read tool should return empty (pass through)", async () => {
    const result = await handleBeforeToolCall(
      { toolName: "read", params: { path: "/tmp/test" } },
      defaultConfig
    );
    expect(result).toEqual({});
  });

  test("safe exec should return empty (auto-allow)", async () => {
    const result = await handleBeforeToolCall(
      { toolName: "exec", params: { command: "echo hello" } },
      defaultConfig
    );
    expect(result).toEqual({});
  });

  test("blocked command should return block:true", async () => {
    const result = await handleBeforeToolCall(
      { toolName: "exec", params: { command: "rm -rf /" } },
      defaultConfig
    );
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("OASIS");
  });

  test("risky command above threshold should return requireApproval", async () => {
    const result = await handleBeforeToolCall(
      { toolName: "exec", params: { command: "sudo docker-compose up" } },
      defaultConfig
    );
    expect(result.requireApproval).toBeDefined();
    expect(result.requireApproval!.title).toContain("OASIS");
    expect(result.requireApproval!.severity).toBeDefined();
  });

  test("unknown tool should be treated as execute (risk analysis)", async () => {
    const result = await handleBeforeToolCall(
      { toolName: "some_unknown_tool", params: { command: "sudo rm stuff" } },
      defaultConfig
    );
    expect(result.requireApproval).toBeDefined();
  });

  test("threshold 0.9 should auto-allow most things", async () => {
    const config = { ...defaultConfig, threshold: 0.9 };
    const result = await handleBeforeToolCall(
      { toolName: "exec", params: { command: "sudo apt install vim" } },
      config
    );
    // score 0.5 < threshold 0.9 → auto-allow
    expect(result).toEqual({});
  });

  test("score 1.0 should block even with threshold 0.9", async () => {
    const config = { ...defaultConfig, threshold: 0.9 };
    const result = await handleBeforeToolCall(
      { toolName: "exec", params: { command: "rm -rf /" } },
      config
    );
    expect(result.block).toBe(true);
  });

  test("approval description should use markdown formatting", async () => {
    const result = await handleBeforeToolCall(
      { toolName: "exec", params: { command: "sudo docker-compose up" } },
      defaultConfig
    );
    expect(result.requireApproval).toBeDefined();
    const desc = result.requireApproval!.description;
    expect(desc).toContain("**Risk Score:**");
    expect(desc).toContain("**Tool:**");
    expect(desc).toContain("**Detected:**");
    expect(desc).toContain("```");
  });
});
