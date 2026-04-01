// tests/classifier.test.ts
import { describe, test, expect } from "vitest";
import { classifyTool } from "../src/classifier.js";
import { defaultConfig } from "../src/config.js";

describe("Tool Classifier", () => {
  test("read tool should be classified as read", () => {
    expect(classifyTool("read", defaultConfig)).toBe("read");
  });

  test("glob tool should be classified as read", () => {
    expect(classifyTool("glob", defaultConfig)).toBe("read");
  });

  test("grep tool should be classified as read", () => {
    expect(classifyTool("grep", defaultConfig)).toBe("read");
  });

  test("web_search tool should be classified as read", () => {
    expect(classifyTool("web_search", defaultConfig)).toBe("read");
  });

  test("exec tool should be classified as execute", () => {
    expect(classifyTool("exec", defaultConfig)).toBe("execute");
  });

  test("bash tool should be classified as execute", () => {
    expect(classifyTool("bash", defaultConfig)).toBe("execute");
  });

  test("write tool should be classified as execute", () => {
    expect(classifyTool("write", defaultConfig)).toBe("execute");
  });

  test("file_delete tool should be classified as execute", () => {
    expect(classifyTool("file_delete", defaultConfig)).toBe("execute");
  });

  test("unknown tool should be classified as unknown", () => {
    expect(classifyTool("some_random_tool", defaultConfig)).toBe("unknown");
  });

  test("custom read tool should be classified as read", () => {
    const config = {
      ...defaultConfig,
      customReadTools: ["my_custom_read"],
    };
    expect(classifyTool("my_custom_read", config)).toBe("read");
  });

  test("custom execute tool should be classified as execute", () => {
    const config = {
      ...defaultConfig,
      customExecuteTools: ["my_custom_write"],
    };
    expect(classifyTool("my_custom_write", config)).toBe("execute");
  });
});
