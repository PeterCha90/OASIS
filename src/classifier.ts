// src/classifier.ts
import type { OasisConfig, ToolClassification } from "./types.js";

export function classifyTool(
  toolName: string,
  config: OasisConfig
): ToolClassification {
  const allReadTools = [...config.readTools, ...config.customReadTools];
  if (allReadTools.includes(toolName)) return "read";

  const allExecuteTools = [...config.executeTools, ...config.customExecuteTools];
  if (allExecuteTools.includes(toolName)) return "execute";

  return "unknown";
}
