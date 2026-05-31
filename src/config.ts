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
// The agent's own user-facing reply tool — gating it would block the agent from
// responding (e.g. when its reply merely mentions a URL the user asked about).
const DEFAULT_FREEPASS_TOOLS = ["message"];

export const defaultConfig: OasisConfig = {
  threshold: 0.5,
  approvalTimeoutMs: 120_000,
  readTools: DEFAULT_READ_TOOLS,
  executeTools: DEFAULT_EXECUTE_TOOLS,
  customReadTools: [],
  customExecuteTools: [],
  freePassTools: DEFAULT_FREEPASS_TOOLS,
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
    freePassTools: pluginConfig.freePassTools ?? defaultConfig.freePassTools,
    safeDomains: pluginConfig.safeDomains ?? defaultConfig.safeDomains,
    customPatterns: pluginConfig.customPatterns ?? defaultConfig.customPatterns,
    logLevel: pluginConfig.logLevel ?? defaultConfig.logLevel,
    oasisBotToken: pluginConfig.oasisBotToken ?? defaultConfig.oasisBotToken,
    oasisAppToken: pluginConfig.oasisAppToken ?? defaultConfig.oasisAppToken,
  };
}
