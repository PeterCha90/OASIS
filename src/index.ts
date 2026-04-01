import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { classifyTool } from "./classifier.js";
import { scanForRisks } from "./scanner.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { registerOasisCli } from "./cli/setup-wizard.js";
import type { OasisConfig } from "./types.js";

/** Shape returned by handleBeforeToolCall, compatible with PluginHookBeforeToolCallResult */
interface HookResult {
  block?: boolean;
  blockReason?: string;
  requireApproval?: {
    title: string;
    description: string;
    severity?: "info" | "warning" | "critical";
    timeoutMs?: number;
    timeoutBehavior?: "allow" | "deny";
    onResolution?: (decision: string) => Promise<void> | void;
  };
}

/**
 * Core hook handler logic — exported for testing.
 */
export async function handleBeforeToolCall(
  event: { toolName: string; params: Record<string, unknown> },
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
        `🚨 *OASIS Security Block*`,
        ``,
        `**Risk Score:** \`${scanResult.score}\` / 1.0`,
        `**Detected:** ${scanResult.reasons.join(", ")}`,
        ``,
        `_This pattern is blocked and cannot be approved._`,
      ].join("\n"),
    };
  }

  if (scanResult.score > config.threshold) {
    const severity: "info" | "warning" | "critical" =
      scanResult.score >= 0.9
        ? "critical"
        : scanResult.score >= 0.5
          ? "warning"
          : "info";

    return {
      requireApproval: {
        title: "🏝️ OASIS Security Review",
        description: [
          `**Risk Score:** \`${scanResult.score}\` / 1.0`,
          `**Tool:** \`${toolName}\``,
          `**Detected:** ${scanResult.reasons.join(", ")}`,
          ``,
          `**Parameters:**`,
          `\`\`\``,
          `${JSON.stringify(params, null, 2).slice(0, 500)}`,
          `\`\`\``,
        ].join("\n"),
        severity,
        timeoutMs: config.approvalTimeoutMs,
        timeoutBehavior: "deny",
      },
    };
  }

  return {};
}

/**
 * OpenClaw plugin entry point.
 * Registers the before_tool_call hook for deterministic risk scoring.
 */
export default definePluginEntry({
  id: "oasis",
  name: "OASIS",
  description:
    "OpenClaw Antidote for Suspicious Injection Signals — deterministic tool security guard",

  register(api: OpenClawPluginApi) {
    const config = loadConfig(api.pluginConfig as Partial<OasisConfig>);
    const logger = createLogger(config, api.logger);

    logger.info(`[OASIS] Loaded with threshold=${config.threshold}`);

    // ── CLI: setup wizard ──
    registerOasisCli(api, config);

    // ── Core Hook: before_tool_call ──
    api.on("before_tool_call", async (event, _ctx) => {
      const result = await handleBeforeToolCall(event, config);

      if (result.block) {
        logger.warn(`[OASIS] BLOCKED: ${event.toolName}`);
      } else if (result.requireApproval) {
        logger.info(`[OASIS] Approval requested: ${event.toolName}`);
        result.requireApproval.onResolution = async (decision) => {
          logger.info(
            `[OASIS] Resolution: ${decision} for ${event.toolName}`
          );
        };
      }

      return result;
    }, { priority: 10 });
  },
});
