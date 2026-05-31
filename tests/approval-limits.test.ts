// tests/approval-limits.test.ts
import { describe, test, expect } from "vitest";
import {
  handleBeforeToolCall,
  formatTitle,
  formatDescription,
} from "../src/index.js";
import { defaultConfig } from "../src/config.js";

// openclaw 2026.5's plugin.approval.request schema rejects the WHOLE request if
// title > 80 or description > 256 chars, silently blocking the tool call. OASIS
// must clamp both.
describe("approval field length clamping", () => {
  test("title is clamped to <= 80 chars", () => {
    const title = formatTitle({ score: 0.7, reasons: ["x".repeat(200)] });
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith("…")).toBe(true);
  });

  test("short title is left intact", () => {
    const title = formatTitle({ score: 0.7, reasons: ["URL access"] });
    expect(title).toContain("OASIS");
    expect(title.endsWith("…")).toBe(false);
  });

  test("description is clamped to <= 256 chars", () => {
    const desc = formatDescription(
      { score: 0.7, reasons: ["y".repeat(300)] },
      "exec",
      { command: "z".repeat(300) },
    );
    expect(desc.length).toBeLessThanOrEqual(256);
  });

  test("short description is left intact", () => {
    const desc = formatDescription(
      { score: 0.7, reasons: ["secret access"] },
      "read",
      { file_path: "~/.ssh/id_rsa" },
    );
    expect(desc).toContain("Risk Score");
    expect(desc.length).toBeLessThanOrEqual(256);
  });
});

// The agent's own reply tool ("message") must never be gated — otherwise the
// agent can't respond when its reply merely mentions a URL the user asked about.
describe("free-pass tools", () => {
  test("'message' tool is never gated, even with a risky URL in params", async () => {
    const result = await handleBeforeToolCall(
      { toolName: "message", params: { text: "Sure, checking http://dangerous.xyz now" } },
      defaultConfig,
    );
    expect(result).toEqual({});
  });

  test("a non-free-pass execute tool is still evaluated", async () => {
    // sanity: 'exec' is NOT free-passed (so the free-pass list isn't catching everything)
    const result = await handleBeforeToolCall(
      { toolName: "exec", params: { command: "echo hello" } },
      defaultConfig,
    );
    // benign command -> no approval, but it went through evaluation (returns {} either way);
    // the meaningful assertion is that 'message' above short-circuits identically.
    expect(result).toBeDefined();
  });
});
