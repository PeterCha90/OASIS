import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { classifyTool } from "./classifier.js";
import { scanForRisks, scanTextForSecrets } from "./scanner.js";
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

  // 2. Even for read tools, scan params for sensitive file paths
  if (classification === "read") {
    const scanResult = scanForRisks(toolName, params, config);
    if (scanResult.score > 0) {
      return {
        requireApproval: {
          title: `🏝️ OASIS [${scanResult.score}] ${scanResult.reasons.join(", ")}`,
          description: `${toolName} | ${JSON.stringify(params).slice(0, 200)}`,
          severity: "warning",
          timeoutMs: config.approvalTimeoutMs,
          timeoutBehavior: "deny",
        },
      };
    }
    return {};
  }

  // 3. Risk analysis for execute tools
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
        title: `🏝️ OASIS [${scanResult.score}] ${scanResult.reasons.join(", ")}`,
        description: `${toolName} | ${JSON.stringify(params).slice(0, 200)}`,
        severity,
        timeoutMs: config.approvalTimeoutMs,
        timeoutBehavior: "deny",
      },
    };
  }

  return {};
}

/**
 * Extract text content from an AgentMessage for secret scanning.
 * AgentMessage can be a standard LLM message (role + content) or custom type.
 */
function extractMessageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const msg = message as Record<string, unknown>;

  // Standard LLM message: { role, content }
  if (typeof msg.content === "string") return msg.content;

  // Content might be an array of parts (multimodal messages)
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((part: unknown) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join(" ");
  }

  // Fallback: try text field
  if (typeof msg.text === "string") return msg.text;

  return "";
}

interface BeforeMessageWriteResult {
  block?: boolean;
}

/**
 * Scans agent messages for secret content before they are written/sent.
 * Blocks messages that contain credentials, tokens, or keys.
 */
export function handleBeforeMessageWrite(
  event: { message: unknown },
  _config: OasisConfig
): BeforeMessageWriteResult {
  const text = extractMessageText(event.message);
  if (!text) return {};

  const result = scanTextForSecrets(text);

  if (result.detected) {
    return { block: true };
  }

  return {};
}

/**
 * OpenClaw plugin entry point.
 * Registers the before_tool_call hook for deterministic risk scoring
 * and before_message_write hook for secret leakage prevention.
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
      // DEBUG: log every tool call to diagnose hook behavior
      const classification = classifyTool(event.toolName, config);
      logger.warn(
        `[OASIS DEBUG] toolName="${event.toolName}" classification="${classification}" params=${JSON.stringify(event.params).slice(0, 200)}`
      );

      const result = await handleBeforeToolCall(event, config);

      if (result.block) {
        logger.warn(`[OASIS] BLOCKED: ${event.toolName}`);
      } else if (result.requireApproval) {
        logger.warn(`[OASIS] Approval requested: ${event.toolName}`);
        result.requireApproval.onResolution = async (decision) => {
          logger.info(
            `[OASIS] Resolution: ${decision} for ${event.toolName}`
          );
        };
      } else {
        logger.warn(`[OASIS DEBUG] PASSED: ${event.toolName}`);
      }

      return result;
    }, { priority: 10 });

    // ── Secret Leakage Guard: before_message_write ──
    api.on("before_message_write", (event, _ctx) => {
      const text = extractMessageText(event.message);
      if (!text) return;

      const result = scanTextForSecrets(text);

      if (result.detected) {
        logger.warn(
          `[OASIS] Message blocked: ${result.reasons.join(", ")}`
        );
        return { block: true };
      }
    }, { priority: 10 });
  },
});
