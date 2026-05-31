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

// openclaw's plugin.approval.request schema rejects the whole request if these
// are exceeded (title maxLength 80, description maxLength 256), which silently
// blocks the tool call. Clamp to stay within the limits.
const APPROVAL_TITLE_MAX = 80;
const APPROVAL_DESCRIPTION_MAX = 256;

function clampLen(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export function formatTitle(scanResult: { score: number; reasons: string[] }): string {
  return clampLen(
    `🏝️ OASIS [${scanResult.score}] ${scanResult.reasons.join(", ")}`,
    APPROVAL_TITLE_MAX,
  );
}

export function formatDescription(
  scanResult: { score: number; reasons: string[] },
  toolName: string,
  params: Record<string, unknown>,
): string {
  const parts = [
    `Risk Score: ${scanResult.score} / 1.0`,
    `Detected: ${scanResult.reasons.join(", ")}`,
    summarizeParams(toolName, params),
  ];
  return clampLen(parts.join("\n"), APPROVAL_DESCRIPTION_MAX);
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

  // 0b. Free-pass tools (e.g. the agent's own reply tool) — never gate these,
  // otherwise the agent can't respond when its message merely mentions a URL.
  if (config.freePassTools.includes(toolName)) return {};

  // 1. Tool classification
  const classification = classifyTool(toolName, config);

  // 2. Even for read tools, scan params for sensitive file paths
  if (classification === "read") {
    const scanResult = scanForRisks(toolName, params, config);
    if (scanResult.score > 0) {
      return {
        requireApproval: {
          title: formatTitle(scanResult),
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
        title: formatTitle(scanResult),
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
/**
 * Normalize a secret-ref id to a bare env-var key.
 * openclaw (>=2026.5) may store the id wrapped in its `${VAR}` interpolation
 * syntax (e.g. "${OASIS_BOT_TOKEN}"); strip the wrapper so it matches the
 * bare key in ~/.openclaw/.env. Without this the env lookup never matches and
 * the OASIS Slack app silently fails to start.
 */
export function normalizeEnvKey(id: string): string {
  return String(id).replace(/^\$\{(.+)\}$/, "$1").trim();
}

/** Build a `^KEY=value$` matcher for a .env file, escaping regex metachars in KEY. */
function envLineRegex(key: string): RegExp {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${esc}=(.+)$`, "m");
}

export function resolveSecretRef(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (value && typeof value === "object" && "id" in value) {
    const ref = value as { source?: string; id: string };
    if (ref.source === "env") {
      const key = normalizeEnvKey(ref.id);
      if (!key) return undefined;
      // 1. Look up the key in ~/.openclaw/.env
      const envPath = join(homedir(), ".openclaw", ".env");
      if (existsSync(envPath)) {
        const content = readFileSync(envPath, "utf-8");
        const match = content.match(envLineRegex(key));
        if (match?.[1]) return match[1].trim();
      }
      // 2. Fallback to process.env
      if (process.env[key]) return process.env[key];
      // 3. openclaw >=2026.5 interpolates ${VAR} placeholders inside plugin
      //    config itself, so the SecretRef id may ALREADY be the resolved
      //    secret value rather than an env-var name. If it could not be found
      //    as a key and does not look like an UPPER_SNAKE_CASE env-var name,
      //    treat the id as the literal resolved value.
      if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) return key;
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
      const tokenKey = normalizeEnvKey(config.gateway.auth.token.id);
      const match = envContent.match(envLineRegex(tokenKey));
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
    let activeSlackApp: any;

    const shutdown = async () => {
      if (activeSlackApp) {
        logger.info("[OASIS] Stopping Slack app...");
        try {
          await activeSlackApp.stop();
          activeSlackApp = undefined;
          logger.info("[OASIS] Slack app stopped");
        } catch (err) {
          logger.warn(`[OASIS] Failed to stop Slack app: ${err}`);
        }
      }
    };

    logger.info(`[OASIS] Loaded with threshold=${config.threshold}`);

    // ── Inject SOUL.md rules into all agent workspaces ──
    injectSoulRules();

    // ── CLI: setup wizard ──
    registerOasisCli(api, config);

    // ── Lifecycle Hooks ──
    api.on("session_end", async () => { await shutdown(); });
    api.on("gateway_stop", async () => { await shutdown(); });

    // Safety net for process signals
    process.on("SIGINT", () => { shutdown().finally(() => process.exit(0)); });
    process.on("SIGTERM", () => { shutdown().finally(() => process.exit(0)); });

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
    const botRef = api.pluginConfig?.oasisBotToken ?? config.oasisBotToken;
    const appRef = api.pluginConfig?.oasisAppToken ?? config.oasisAppToken;
    const botToken = resolveSecretRef(botRef);
    const appToken = resolveSecretRef(appRef);
    if (botToken && appToken) {
      import("./slack/approval-handler.js").then(({ createOasisSlackApp }) => {
        const gw = loadGatewayConfig();
        activeSlackApp = createOasisSlackApp({
          botToken,
          appToken,
          gatewayPort: gw.port,
          gatewayAuthToken: gw.authToken,
        });
        activeSlackApp.start().then(() => {
          logger.info("[OASIS] Slack app connected");
        }).catch((err: unknown) => {
          logger.warn(`[OASIS] Slack app failed: ${err}`);
        });
      }).catch((err: unknown) => {
        logger.warn(`[OASIS] Slack app module load failed: ${err}`);
      });
    } else {
      // Don't fail silently — explain WHY no approval buttons will appear.
      // (config id is an env-var NAME, not the secret value, so it is safe to log.)
      const describeRef = (v: unknown): string => {
        if (v == null) return "missing";
        if (typeof v === "string") return v ? "string(set)" : "empty-string";
        if (typeof v === "object" && v !== null && "id" in (v as Record<string, unknown>))
          return `secretRef(source=${(v as any).source}, id=${JSON.stringify((v as any).id)})`;
        return typeof v;
      };
      logger.warn(
        `[OASIS] Slack app NOT started — tokens unresolved, so no approval buttons will appear. ` +
        `botToken=${botToken ? "ok" : "UNRESOLVED"} (config: ${describeRef(botRef)}); ` +
        `appToken=${appToken ? "ok" : "UNRESOLVED"} (config: ${describeRef(appRef)}). ` +
        `Ensure OASIS_BOT_TOKEN/OASIS_APP_TOKEN exist in ~/.openclaw/.env and oasisBotToken/oasisAppToken are set in the plugin config.`
      );
    }
  },
});
