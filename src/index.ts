// src/index.ts
import { classifyTool } from "./classifier.js";
import { scanForRisks } from "./scanner.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { registerOasisCli } from "./cli/setup-wizard.js";
import type { OasisConfig } from "./types.js";

interface ToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
}

interface HookResult {
  block?: boolean;
  blockReason?: string;
  requireApproval?: {
    title: string;
    description: string;
    severity: string;
    timeoutMs: number;
    timeoutBehavior: string;
    onResolution?: (decision: string) => Promise<void>;
  };
}

/**
 * Core hook handler logic — exported for testing.
 */
export async function handleBeforeToolCall(
  event: ToolCallEvent,
  config: OasisConfig
): Promise<HookResult> {
  const { toolName, params } = event;

  // 1. Tool classification
  const classification = classifyTool(toolName, config);
  if (classification === "read") {
    return {};
  }

  // 2. Risk analysis
  const scanResult = scanForRisks(toolName, params, config);

  // 3. Decision
  if (scanResult.score >= 1.0) {
    return {
      block: true,
      blockReason: [
        `🚨 OASIS Security Block`,
        ``,
        `Risk Score: ${scanResult.score}/1.0`,
        `Detected: ${scanResult.reasons.join(", ")}`,
        ``,
        `This pattern is blocked and cannot be approved.`,
      ].join("\n"),
    };
  }

  if (scanResult.score > config.threshold) {
    return {
      requireApproval: {
        title: "🏝️ OASIS Security Review",
        description: [
          `Risk Score: ${scanResult.score}/1.0`,
          `Tool: ${toolName}`,
          `Detected: ${scanResult.reasons.join(", ")}`,
          ``,
          `Parameters:`,
          `${JSON.stringify(params, null, 2).slice(0, 500)}`,
        ].join("\n"),
        severity: scanResult.severity,
        timeoutMs: config.approvalTimeoutMs,
        timeoutBehavior: "deny",
      },
    };
  }

  return {};
}

/**
 * Plugin entry — uses definePluginEntry when loaded by OpenClaw.
 * The actual SDK import is dynamic to avoid build-time dependency.
 */
export function createOasisPlugin() {
  return {
    id: "oasis",
    name: "OASIS",
    description:
      "OpenClaw Antidote for Suspicious Injection Signals — deterministic tool security guard",

    register(api: {
      pluginConfig: unknown;
      logger: { debug: (m: string) => void; info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
      on: (event: string, handler: (...args: unknown[]) => unknown, opts?: Record<string, unknown>) => void;
      registerCli?: (fn: (program: unknown) => void) => void;
    }) {
      const config = loadConfig(api.pluginConfig as Partial<OasisConfig>);
      const logger = createLogger(config, api.logger);

      logger.info(
        `[OASIS] Loaded with threshold=${config.threshold}`
      );

      // ── CLI: setup wizard ──
      registerOasisCli(api, config);

      api.on(
        "before_tool_call",
        async (event: unknown) => {
          const result = await handleBeforeToolCall(
            event as ToolCallEvent,
            config
          );

          if (result.block) {
            logger.warn(
              `[OASIS] BLOCKED: ${(event as ToolCallEvent).toolName}`
            );
          } else if (result.requireApproval) {
            const e = event as ToolCallEvent;
            logger.info(
              `[OASIS] Approval requested: ${e.toolName}`
            );
            // Attach resolution logger
            result.requireApproval.onResolution = async (decision: string) => {
              logger.info(
                `[OASIS] Resolution: ${decision} for ${e.toolName}`
              );
            };
          }

          return result;
        },
        { name: "oasis-guard", priority: 10 }
      );
    },
  };
}
