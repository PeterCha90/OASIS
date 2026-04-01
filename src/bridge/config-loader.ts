import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface SlackAccountConfig {
  id: string;
  botTokenEnvKey: string;
  appTokenEnvKey: string;
}

export interface BridgeConfig {
  accounts: SlackAccountConfig[];
  gatewayPort: number;
  gatewayAuthToken?: string;
  deviceToken?: string;
  deviceId?: string;
  tokens: Record<string, string>;
}

export function parseSlackAccounts(
  config: Record<string, unknown>
): SlackAccountConfig[] {
  const channels = config.channels as Record<string, unknown> | undefined;
  if (!channels) return [];
  const slack = channels.slack as Record<string, unknown> | undefined;
  if (!slack) return [];
  const accounts = slack.accounts as Record<string, unknown> | undefined;
  if (!accounts) return [];

  const result: SlackAccountConfig[] = [];
  for (const [id, account] of Object.entries(accounts)) {
    const acc = account as Record<string, unknown>;
    const botToken = acc.botToken as { id?: string } | undefined;
    const appToken = acc.appToken as { id?: string } | undefined;
    if (botToken?.id && appToken?.id) {
      result.push({
        id,
        botTokenEnvKey: botToken.id,
        appTokenEnvKey: appToken.id,
      });
    }
  }
  return result;
}

export function loadEnvTokens(envContent: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    tokens[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
  return tokens;
}

export function parseGatewayPort(config: Record<string, unknown>): number {
  const gateway = config.gateway as { port?: number } | undefined;
  return gateway?.port ?? 18789;
}

export function loadBridgeConfig(): BridgeConfig {
  const openclawDir = join(homedir(), ".openclaw");
  const configPath = join(openclawDir, "openclaw.json");
  const envPath = join(openclawDir, ".env");

  if (!existsSync(configPath)) {
    throw new Error(`OpenClaw config not found: ${configPath}`);
  }

  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  const accounts = parseSlackAccounts(config);
  const gatewayPort = parseGatewayPort(config);

  let tokens: Record<string, string> = {};
  if (existsSync(envPath)) {
    tokens = loadEnvTokens(readFileSync(envPath, "utf-8"));
  }

  // Read gateway auth token
  const gatewayAuth = (config.gateway as any)?.auth;
  let gatewayAuthToken: string | undefined;
  if (gatewayAuth?.mode === "token" && gatewayAuth?.token?.id) {
    gatewayAuthToken = tokens[gatewayAuth.token.id];
  }

  // Read device token (used for authenticated gateway calls)
  let deviceToken: string | undefined;
  let deviceId: string | undefined;
  const deviceAuthPath = join(openclawDir, "identity", "device-auth.json");
  if (existsSync(deviceAuthPath)) {
    try {
      const deviceAuth = JSON.parse(readFileSync(deviceAuthPath, "utf-8"));
      deviceToken = deviceAuth.tokens?.operator?.token;
      deviceId = deviceAuth.deviceId;
    } catch {}
  }

  return { accounts, gatewayPort, gatewayAuthToken, deviceToken, deviceId, tokens };
}
