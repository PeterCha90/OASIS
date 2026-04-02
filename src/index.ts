import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
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

  // 2. Even for read tools, scan params for sensitive file paths
  if (classification === "read") {
    const scanResult = scanForRisks(toolName, params, config);
    if (scanResult.score > 0) {
      return {
        requireApproval: {
          title: `🏝️ OASIS [${scanResult.score}] ${scanResult.reasons.join(", ")}`,
          description: `Risk Score: ${scanResult.score} / 1.0 | Detected: ${scanResult.reasons.join(", ")}`,
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
        description: `Risk Score: ${scanResult.score} / 1.0 | Detected: ${scanResult.reasons.join(", ")}`,
        severity,
        timeoutMs: config.approvalTimeoutMs,
        timeoutBehavior: "deny",
      },
    };
  }

  return {};
}

function loadGatewayConfig(): { port: number; authToken?: string } {
  try {
    const configPath = join(homedir(), ".openclaw", "openclaw.json");
    const envPath = join(homedir(), ".openclaw", ".env");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const port = config.gateway?.port ?? 18789;
    let authToken: string | undefined;
    if (config.gateway?.auth?.mode === "token" && config.gateway?.auth?.token?.id) {
      const envContent = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
      const tokenKey = config.gateway.auth.token.id;
      const match = envContent.match(new RegExp(`^${tokenKey}=(.+)$`, "m"));
      authToken = match?.[1]?.trim();
    }
    return { port, authToken };
  } catch {
    return { port: 18789 };
  }
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

    // ── Slack App: dedicated OASIS bot ──
    if (config.oasisBotToken && config.oasisAppToken) {
      import("./slack/approval-handler.js").then(({ createOasisSlackApp }) => {
        const gw = loadGatewayConfig();
        const slackApp = createOasisSlackApp({
          botToken: config.oasisBotToken!,
          appToken: config.oasisAppToken!,
          gatewayPort: gw.port,
          gatewayAuthToken: gw.authToken,
        });
        slackApp.start().then(() => {
          logger.info("[OASIS] Slack app connected");
        }).catch((err: unknown) => {
          logger.warn(`[OASIS] Slack app failed: ${err}`);
        });
      });
    }
  },
});
