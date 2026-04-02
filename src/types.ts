// src/types.ts

/** Risk detection pattern definition */
export interface DetectionPattern {
  id: string;
  regex: RegExp;
  score: number;
  description: string;
  severity: "critical" | "warning" | "info";
}

/** Result of scanning a tool call for risks */
export interface ScanResult {
  score: number;
  reasons: string[];
  matchedPatterns: string[];
  severity: "critical" | "warning" | "info" | "none";
}

/** OASIS plugin configuration */
export interface OasisConfig {
  threshold: number;
  approvalTimeoutMs: number;
  readTools: string[];
  executeTools: string[];
  customReadTools: string[];
  customExecuteTools: string[];
  safeDomains: string[];
  customPatterns: CustomPatternInput[];
  logLevel: "debug" | "info" | "warn" | "error";
  oasisBotToken?: string;
  oasisAppToken?: string;
}

/** Custom pattern as provided in config (regex as string) */
export interface CustomPatternInput {
  id: string;
  regex: string;
  score: number;
  description?: string;
}

/** Tool classification result */
export type ToolClassification = "read" | "execute" | "unknown";
