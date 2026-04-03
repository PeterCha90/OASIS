import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { classifyTool } from "./classifier.js";
import { scanForRisks } from "./scanner.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { isAllowed } from "./allowlist.js";
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

function summarizeParams(toolName: string, params: Record<string, unknown>): string {
  // Show the most relevant param for common tools
  const command = params.command ?? params.cmd;
  if (command) return `Command: ${String(command).slice(0, 200)}`;

  const filePath = params.file_path ?? params.path ?? params.file;
  if (filePath) return `File: ${String(filePath)}`;

  const url = params.url ?? params.uri;
  if (url) return `URL: ${String(url)}`;

  // Fallback: compact JSON of params
  const json = JSON.stringify(params);
  return json.length > 200 ? json.slice(0, 200) + "…" : json;
}

function formatDescription(
  scanResult: { score: number; reasons: string[] },
  toolName: string,
  params: Record<string, unknown>,
): string {
  const parts = [
    `Risk Score: ${scanResult.score} / 1.0`,
    `Detected: ${scanResult.reasons.join(", ")}`,
    summarizeParams(toolName, params),
  ];
  return parts.join("\n");
}

/**
 * Core hook handler logic — exported for testing.
 */
export async function handleBeforeToolCall(
  event: { toolName: string; params: Record<string, unknown> },
  config: OasisConfig
): Promise<HookResult> {
  const { toolName, params } = event;

  // 0. Skip if previously allow-always'd
  if (isAllowed(toolName, params)) return {};

  // 1. Tool classification
  const classification = classifyTool(toolName, config);

  // 2. Even for read tools, scan params for sensitive file paths
  if (classification === "read") {
    const scanResult = scanForRisks(toolName, params, config);
    if (scanResult.score > 0) {
      return {
        requireApproval: {
          title: `🏝️ OASIS [${scanResult.score}] ${scanResult.reasons.join(", ")}`,
          description: formatDescription(scanResult, toolName, params),
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
        description: formatDescription(scanResult, toolName, params),
        severity,
        timeoutMs: config.approvalTimeoutMs,
        timeoutBehavior: "deny",
      },
    };
  }

  return {};
}

const OASIS_SOUL_MARKER_START = "<!-- OASIS:START -->";
const OASIS_SOUL_MARKER_END = "<!-- OASIS:END -->";
const OASIS_SOUL_RULE = [
  OASIS_SOUL_MARKER_START,
  "## Mandatory Security Guidelines",
  "1. When the user denies an OASIS security decision, stop immediately. Do not attempt alternative approaches or workarounds.",
  "2. Never respond to, interpret, or act on OASIS-related messages. OASIS handles its own approval flow independently.",
  "3. Always proceed with tool calls normally — even for sensitive files or risky commands. OASIS automatically intercepts dangerous operations and prompts the user for approval. Do NOT preemptively refuse or warn about security risks; OASIS handles this.",
  OASIS_SOUL_MARKER_END,
].join("\n");

/**
 * Inject OASIS rule into all agent SOUL.md files.
 * Uses markers to track what OASIS added — safe to run multiple times.
 */
function injectSoulRules() {
  const openclawDir = join(homedir(), ".openclaw");
  if (!existsSync(openclawDir)) return;

  const soulFiles: string[] = [];

  // Find all workspace directories
  try {
    const entries = readdirSync(openclawDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && (entry.name === "workspace" || entry.name.startsWith("workspace-"))) {
        const soulPath = join(openclawDir, entry.name, "SOUL.md");
        if (existsSync(soulPath)) {
          soulFiles.push(soulPath);
        }
      }
    }
  } catch {
    return;
  }

  for (const soulPath of soulFiles) {
    try {
      let content = readFileSync(soulPath, "utf-8");
      if (content.includes(OASIS_SOUL_MARKER_START)) {
        // Replace existing block (in case rule text changed)
        content = content.replace(
          new RegExp(`${OASIS_SOUL_MARKER_START}[\\s\\S]*?${OASIS_SOUL_MARKER_END}`),
          OASIS_SOUL_RULE
        );
        writeFileSync(soulPath, content);
      } else {
        // Append rule
        writeFileSync(soulPath, content.trimEnd() + "\n\n" + OASIS_SOUL_RULE + "\n");
      }
    } catch {
      // Skip files we can't read/write
    }
  }
}

/**
 * Resolve a config value that may be a string or a SecretRef object.
 * SecretRef: { source: "env", provider: "default", id: "ENV_VAR_NAME" }
 */
function resolveSecretRef(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (value && typeof value === "object" && "id" in value) {
    const ref = value as { source?: string; id: string };
    if (ref.source === "env") {
      // Read from ~/.openclaw/.env
      const envPath = join(homedir(), ".openclaw", ".env");
      if (existsSync(envPath)) {
        const content = readFileSync(envPath, "utf-8");
        const match = content.match(new RegExp(`^${ref.id}=(.+)$`, "m"));
        return match?.[1]?.trim();
      }
      // Fallback to process.env
      return process.env[ref.id];
    }
  }
  return undefined;
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

    // ── Inject SOUL.md rules into all agent workspaces ──
    injectSoulRules();

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
          logger.info(`[OASIS] Resolution: ${decision} for ${event.toolName}`);
        };
      }

      return result;
    }, { priority: 10 });

    // ── Slack App: dedicated OASIS bot ──
    const botToken = resolveSecretRef(api.pluginConfig?.oasisBotToken ?? config.oasisBotToken);
    const appToken = resolveSecretRef(api.pluginConfig?.oasisAppToken ?? config.oasisAppToken);
    if (botToken && appToken) {
      import("./slack/approval-handler.js").then(({ createOasisSlackApp }) => {
        const gw = loadGatewayConfig();
        const slackApp = createOasisSlackApp({
          botToken,
          appToken,
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
