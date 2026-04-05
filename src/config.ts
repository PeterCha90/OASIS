// src/config.ts
import type { OasisConfig } from "./types.js";

const DEFAULT_READ_TOOLS = ["read", "glob", "grep", "web_search", "list", "cat"];
const DEFAULT_EXECUTE_TOOLS = [
  "exec",
  "bash",
  "write",
  "edit",
  "web_fetch",
  "file_delete",
  "apply_patch",
];

export const defaultConfig: OasisConfig = {
  threshold: 0.5,
  approvalTimeoutMs: 120_000,
  readTools: DEFAULT_READ_TOOLS,
  executeTools: DEFAULT_EXECUTE_TOOLS,
  customReadTools: [],
  customExecuteTools: [],
  safeDomains: [],
  customPatterns: [],
  logLevel: "info",
  oasisBotToken: undefined,
  oasisAppToken: undefined,
};

export function loadConfig(
  pluginConfig: Partial<OasisConfig> | undefined
): OasisConfig {
  if (!pluginConfig) return { ...defaultConfig };

  return {
    threshold: pluginConfig.threshold ?? defaultConfig.threshold,
    approvalTimeoutMs:
      pluginConfig.approvalTimeoutMs ?? defaultConfig.approvalTimeoutMs,
    readTools: pluginConfig.readTools ?? defaultConfig.readTools,
    executeTools: pluginConfig.executeTools ?? defaultConfig.executeTools,
    customReadTools: pluginConfig.customReadTools ?? defaultConfig.customReadTools,
    customExecuteTools:
      pluginConfig.customExecuteTools ?? defaultConfig.customExecuteTools,
    safeDomains: pluginConfig.safeDomains ?? defaultConfig.safeDomains,
    customPatterns: pluginConfig.customPatterns ?? defaultConfig.customPatterns,
    logLevel: pluginConfig.logLevel ?? defaultConfig.logLevel,
    oasisBotToken: pluginConfig.oasisBotToken ?? defaultConfig.oasisBotToken,
    oasisAppToken: pluginConfig.oasisAppToken ?? defaultConfig.oasisAppToken,
  };
}
