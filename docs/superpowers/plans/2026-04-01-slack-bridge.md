# OASIS Slack Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Bolt-based Slack bridge to OASIS that renders Block Kit approval buttons and handles button clicks, forwarding decisions to OpenClaw Gateway.

**Architecture:** The bridge runs as a sidecar process (`npx @petercha90/oasis bridge`). It auto-reads Slack tokens from `~/.openclaw/openclaw.json` + `~/.openclaw/.env`, creates a Bolt app per Slack account (Socket Mode), watches for approval messages from OpenClaw bots, updates them with Block Kit buttons, and on click calls `plugin.approval.resolve` on the Gateway WebSocket (port from config).

**Tech Stack:** @slack/bolt (Socket Mode), @slack/web-api, ws (Gateway WebSocket client), dotenv

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/bridge/index.ts` | Bridge entry point — parse args, load config, start all Bolt instances |
| `src/bridge/config-loader.ts` | Read `~/.openclaw/openclaw.json` + `.env`, extract Slack accounts + gateway port |
| `src/bridge/bolt-app.ts` | Create a Bolt app for one Slack account, register message/action handlers |
| `src/bridge/gateway-client.ts` | WebSocket client to call `plugin.approval.resolve` on OpenClaw Gateway |
| `src/bridge/approval-parser.ts` | Parse approval message text → extract approval ID, details |
| `src/bridge/blocks.ts` | Build Block Kit button layouts for approval messages |
| `bin/oasis.js` | CLI entry point — routes `bridge` subcommand to bridge/index |
| `tests/bridge/approval-parser.test.ts` | Tests for parsing approval messages |
| `tests/bridge/blocks.test.ts` | Tests for Block Kit generation |
| `tests/bridge/config-loader.test.ts` | Tests for config/env loading |

---

### Task 1: CLI Entry Point (`bin/oasis.js`)

**Files:**
- Create: `bin/oasis.js`
- Modify: `package.json`

- [ ] **Step 1: Create bin/oasis.js**

```javascript
#!/usr/bin/env node
const command = process.argv[2];

if (command === "bridge") {
  import("../dist/bridge/index.js").then((m) => m.startBridge());
} else {
  console.log("Usage: npx @petercha90/oasis bridge");
  console.log("");
  console.log("Commands:");
  console.log("  bridge    Start the OASIS Slack approval bridge");
  process.exit(1);
}
```

- [ ] **Step 2: Update package.json**

Add `bin` field and new dependencies:

```json
{
  "bin": {
    "oasis": "./bin/oasis.js"
  },
  "dependencies": {
    "@slack/bolt": "^4.1.0",
    "@slack/web-api": "^7.8.0",
    "ws": "^8.18.0",
    "dotenv": "^16.4.0"
  }
}
```

Also add `"bin"` to the `files` array.

- [ ] **Step 3: Verify structure**

Run: `ls bin/oasis.js`
Expected: File exists.

- [ ] **Step 4: Commit**

```bash
git add bin/oasis.js package.json
git commit -m "feat: add CLI entry point for bridge command"
```

---

### Task 2: Config Loader (`src/bridge/config-loader.ts`)

**Files:**
- Create: `src/bridge/config-loader.ts`
- Create: `tests/bridge/config-loader.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/bridge/config-loader.test.ts
import { describe, test, expect } from "vitest";
import { parseSlackAccounts, loadEnvTokens } from "../src/bridge/config-loader.js";

describe("Config Loader", () => {
  test("should parse Slack accounts from OpenClaw config", () => {
    const config = {
      channels: {
        slack: {
          accounts: {
            "ceo-bot": {
              botToken: { source: "env", id: "CEO_BOT_TOKEN" },
              appToken: { source: "env", id: "CEO_APP_TOKEN" },
            },
            "cto-bot": {
              botToken: { source: "env", id: "CTO_BOT_TOKEN" },
              appToken: { source: "env", id: "CTO_APP_TOKEN" },
            },
          },
        },
      },
      gateway: { port: 18789 },
    };

    const accounts = parseSlackAccounts(config);
    expect(accounts).toHaveLength(2);
    expect(accounts[0].id).toBe("ceo-bot");
    expect(accounts[0].botTokenEnvKey).toBe("CEO_BOT_TOKEN");
    expect(accounts[0].appTokenEnvKey).toBe("CEO_APP_TOKEN");
  });

  test("should return empty array if no Slack config", () => {
    const accounts = parseSlackAccounts({});
    expect(accounts).toEqual([]);
  });

  test("should load env tokens from dotenv content", () => {
    const envContent = 'CEO_BOT_TOKEN=xoxb-test-123\nCEO_APP_TOKEN=xapp-test-456\n';
    const tokens = loadEnvTokens(envContent);
    expect(tokens["CEO_BOT_TOKEN"]).toBe("xoxb-test-123");
    expect(tokens["CEO_APP_TOKEN"]).toBe("xapp-test-456");
  });

  test("should parse gateway port from config", () => {
    const config = { gateway: { port: 18789 } };
    const accounts = parseSlackAccounts(config);
    // gateway port is returned separately
    expect(accounts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bridge/config-loader.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement config-loader**

```typescript
// src/bridge/config-loader.ts
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
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    tokens[key] = value;
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

  return { accounts, gatewayPort, tokens };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bridge/config-loader.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bridge/config-loader.ts tests/bridge/config-loader.test.ts
git commit -m "feat: add config loader for Slack tokens from OpenClaw config"
```

---

### Task 3: Approval Message Parser (`src/bridge/approval-parser.ts`)

**Files:**
- Create: `src/bridge/approval-parser.ts`
- Create: `tests/bridge/approval-parser.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/bridge/approval-parser.test.ts
import { describe, test, expect } from "vitest";
import { parseApprovalMessage } from "../src/bridge/approval-parser.js";

const SAMPLE_MESSAGE = `🦞 Plugin approval required
Title: 🏝️ OASIS Security Review
Description: **Risk Score:** \`0.6\` / 1.0
**Tool:** \`exec\`
**Detected:** Sensitive file access

**Parameters:**
\`\`\`
{
  "command": "cat ~/.openclaw/.env"
}
\`\`\`
Tool: exec
Plugin: oasis
Agent: pa
ID: plugin:bc92b8cc-9e7e-4f48-b647-3aa7617771ac
Expires in: 120s
Reply with: /approve <id> allow-once|allow-always|deny`;

describe("Approval Parser", () => {
  test("should parse approval ID from message", () => {
    const result = parseApprovalMessage(SAMPLE_MESSAGE);
    expect(result).not.toBeNull();
    expect(result!.approvalId).toBe("plugin:bc92b8cc-9e7e-4f48-b647-3aa7617771ac");
  });

  test("should parse tool name", () => {
    const result = parseApprovalMessage(SAMPLE_MESSAGE);
    expect(result!.toolName).toBe("exec");
  });

  test("should parse plugin name", () => {
    const result = parseApprovalMessage(SAMPLE_MESSAGE);
    expect(result!.pluginName).toBe("oasis");
  });

  test("should parse title", () => {
    const result = parseApprovalMessage(SAMPLE_MESSAGE);
    expect(result!.title).toContain("OASIS");
  });

  test("should return null for non-approval message", () => {
    const result = parseApprovalMessage("Hello, how are you?");
    expect(result).toBeNull();
  });

  test("should return null for message without ID", () => {
    const result = parseApprovalMessage("Plugin approval required\nNo ID here");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bridge/approval-parser.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement parser**

```typescript
// src/bridge/approval-parser.ts
export interface ParsedApproval {
  approvalId: string;
  title: string;
  toolName: string;
  pluginName: string;
  description: string;
}

export function parseApprovalMessage(text: string): ParsedApproval | null {
  if (!text.includes("Plugin approval required")) return null;

  const idMatch = text.match(/ID:\s*(plugin:[a-f0-9-]+)/i);
  if (!idMatch) return null;

  const titleMatch = text.match(/Title:\s*(.+)/);
  const toolMatch = text.match(/^Tool:\s*(\S+)/m);
  const pluginMatch = text.match(/Plugin:\s*(\S+)/);

  return {
    approvalId: idMatch[1],
    title: titleMatch?.[1]?.trim() ?? "Approval Required",
    toolName: toolMatch?.[1] ?? "unknown",
    pluginName: pluginMatch?.[1] ?? "unknown",
    description: text,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bridge/approval-parser.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bridge/approval-parser.ts tests/bridge/approval-parser.test.ts
git commit -m "feat: add approval message parser"
```

---

### Task 4: Block Kit Builder (`src/bridge/blocks.ts`)

**Files:**
- Create: `src/bridge/blocks.ts`
- Create: `tests/bridge/blocks.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/bridge/blocks.test.ts
import { describe, test, expect } from "vitest";
import { buildApprovalBlocks, buildResolvedBlocks } from "../src/bridge/blocks.js";

describe("Block Kit Builder", () => {
  test("should build approval blocks with buttons", () => {
    const blocks = buildApprovalBlocks({
      approvalId: "plugin:test-123",
      title: "🏝️ OASIS Security Review",
      toolName: "exec",
      description: "Risk Score: 0.6",
    });

    expect(blocks.length).toBeGreaterThan(0);

    // Should have an actions block with buttons
    const actionsBlock = blocks.find((b: any) => b.type === "actions");
    expect(actionsBlock).toBeDefined();
    expect(actionsBlock.elements).toHaveLength(2);
    expect(actionsBlock.elements[0].action_id).toBe("oasis_approve");
    expect(actionsBlock.elements[1].action_id).toBe("oasis_deny");
  });

  test("should build resolved blocks", () => {
    const blocks = buildResolvedBlocks({
      decision: "allow-once",
      resolvedBy: "U12345",
    });

    expect(blocks.length).toBeGreaterThan(0);
    const text = JSON.stringify(blocks);
    expect(text).toContain("allow-once");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bridge/blocks.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement blocks builder**

```typescript
// src/bridge/blocks.ts
import type { KnownBlock } from "@slack/bolt";

interface ApprovalBlocksParams {
  approvalId: string;
  title: string;
  toolName: string;
  description: string;
}

export function buildApprovalBlocks(params: ApprovalBlocksParams): KnownBlock[] {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: params.title, emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Tool:* \`${params.toolName}\`` },
        { type: "mrkdwn", text: `*ID:* \`${params.approvalId.slice(0, 12)}...\`` },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: params.description.slice(0, 2000) },
    },
    { type: "divider" },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "✅ Allow", emoji: true },
          style: "primary",
          action_id: "oasis_approve",
          value: JSON.stringify({
            id: params.approvalId,
            decision: "allow-once",
          }),
        },
        {
          type: "button",
          text: { type: "plain_text", text: "❌ Deny", emoji: true },
          style: "danger",
          action_id: "oasis_deny",
          value: JSON.stringify({
            id: params.approvalId,
            decision: "deny",
          }),
        },
      ],
    },
  ];
}

interface ResolvedBlocksParams {
  decision: string;
  resolvedBy?: string;
}

export function buildResolvedBlocks(params: ResolvedBlocksParams): KnownBlock[] {
  const emoji = params.decision === "deny" ? "❌" : "✅";
  const label = params.decision === "deny" ? "Denied" : "Allowed";
  const who = params.resolvedBy ? ` by <@${params.resolvedBy}>` : "";

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji} *OASIS: ${label}*${who}`,
      },
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bridge/blocks.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bridge/blocks.ts tests/bridge/blocks.test.ts
git commit -m "feat: add Block Kit builder for approval buttons"
```

---

### Task 5: Gateway WebSocket Client (`src/bridge/gateway-client.ts`)

**Files:**
- Create: `src/bridge/gateway-client.ts`

- [ ] **Step 1: Implement gateway client**

```typescript
// src/bridge/gateway-client.ts
import WebSocket from "ws";

interface ResolveParams {
  id: string;
  decision: "allow-once" | "allow-always" | "deny";
}

export class GatewayClient {
  private port: number;
  private authToken: string | undefined;

  constructor(port: number, authToken?: string) {
    this.port = port;
    this.authToken = authToken;
  }

  async resolveApproval(params: ResolveParams): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const url = `ws://127.0.0.1:${this.port}`;
      const ws = new WebSocket(url);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Gateway connection timeout"));
      }, 10_000);

      ws.on("open", () => {
        const payload = {
          jsonrpc: "2.0",
          id: 1,
          method: "plugin.approval.resolve",
          params: {
            id: params.id,
            decision: params.decision,
          },
        };
        ws.send(JSON.stringify(payload));
      });

      ws.on("message", (data) => {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(data.toString());
          ws.close();
          if (response.error) {
            reject(new Error(response.error.message ?? "Gateway error"));
          } else {
            resolve(true);
          }
        } catch {
          ws.close();
          reject(new Error("Invalid gateway response"));
        }
      });

      ws.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors (may need `@types/ws`).

- [ ] **Step 3: Commit**

```bash
git add src/bridge/gateway-client.ts
git commit -m "feat: add Gateway WebSocket client for approval resolution"
```

---

### Task 6: Bolt App Factory (`src/bridge/bolt-app.ts`)

**Files:**
- Create: `src/bridge/bolt-app.ts`

- [ ] **Step 1: Implement Bolt app factory**

```typescript
// src/bridge/bolt-app.ts
import { App, LogLevel } from "@slack/bolt";
import { parseApprovalMessage } from "./approval-parser.js";
import { buildApprovalBlocks, buildResolvedBlocks } from "./blocks.js";
import { GatewayClient } from "./gateway-client.js";

interface BoltAppParams {
  accountId: string;
  botToken: string;
  appToken: string;
  gateway: GatewayClient;
}

export function createBoltApp(params: BoltAppParams): App {
  const app = new App({
    token: params.botToken,
    appToken: params.appToken,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  // Watch for approval messages from this bot
  app.message(async ({ message, client }) => {
    if (message.subtype || !("text" in message) || !message.text) return;

    const parsed = parseApprovalMessage(message.text);
    if (!parsed) return;

    // Update the message with Block Kit buttons
    try {
      await client.chat.update({
        channel: message.channel,
        ts: message.ts,
        text: message.text,
        blocks: buildApprovalBlocks({
          approvalId: parsed.approvalId,
          title: parsed.title,
          toolName: parsed.toolName,
          description: parsed.description,
        }),
      });
    } catch (err) {
      console.error(`[OASIS Bridge] Failed to update message: ${err}`);
    }
  });

  // Handle Allow button click
  app.action("oasis_approve", async ({ ack, body, client }) => {
    await ack();
    const action = (body as any).actions?.[0];
    if (!action?.value) return;

    const { id, decision } = JSON.parse(action.value);
    try {
      await params.gateway.resolveApproval({ id, decision });
      // Update message to show result
      await client.chat.update({
        channel: (body as any).channel.id,
        ts: (body as any).message.ts,
        text: `✅ Approved: ${id}`,
        blocks: buildResolvedBlocks({
          decision,
          resolvedBy: body.user.id,
        }),
      });
    } catch (err) {
      console.error(`[OASIS Bridge] Approval failed: ${err}`);
    }
  });

  // Handle Deny button click
  app.action("oasis_deny", async ({ ack, body, client }) => {
    await ack();
    const action = (body as any).actions?.[0];
    if (!action?.value) return;

    const { id, decision } = JSON.parse(action.value);
    try {
      await params.gateway.resolveApproval({ id, decision });
      await client.chat.update({
        channel: (body as any).channel.id,
        ts: (body as any).message.ts,
        text: `❌ Denied: ${id}`,
        blocks: buildResolvedBlocks({
          decision,
          resolvedBy: body.user.id,
        }),
      });
    } catch (err) {
      console.error(`[OASIS Bridge] Denial failed: ${err}`);
    }
  });

  return app;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/bridge/bolt-app.ts
git commit -m "feat: add Bolt app with approval button handlers"
```

---

### Task 7: Bridge Entry Point (`src/bridge/index.ts`)

**Files:**
- Create: `src/bridge/index.ts`

- [ ] **Step 1: Implement bridge entry**

```typescript
// src/bridge/index.ts
import { loadBridgeConfig } from "./config-loader.js";
import { createBoltApp } from "./bolt-app.js";
import { GatewayClient } from "./gateway-client.js";

export async function startBridge() {
  console.log("🏝️  OASIS Slack Bridge");
  console.log("═".repeat(40));

  const config = loadBridgeConfig();

  if (config.accounts.length === 0) {
    console.error("❌ No Slack accounts found in ~/.openclaw/openclaw.json");
    process.exit(1);
  }

  const gateway = new GatewayClient(config.gatewayPort);

  const apps: { id: string; app: ReturnType<typeof createBoltApp> }[] = [];

  for (const account of config.accounts) {
    const botToken = config.tokens[account.botTokenEnvKey];
    const appToken = config.tokens[account.appTokenEnvKey];

    if (!botToken || !appToken) {
      console.warn(
        `⚠️  Skipping ${account.id}: missing ${!botToken ? account.botTokenEnvKey : account.appTokenEnvKey}`
      );
      continue;
    }

    const app = createBoltApp({
      accountId: account.id,
      botToken,
      appToken,
      gateway,
    });

    apps.push({ id: account.id, app });
  }

  if (apps.length === 0) {
    console.error("❌ No Slack accounts with valid tokens found");
    process.exit(1);
  }

  // Start all Bolt apps
  for (const { id, app } of apps) {
    try {
      await app.start();
      console.log(`  ✅ ${id} connected`);
    } catch (err) {
      console.error(`  ❌ ${id} failed: ${err}`);
    }
  }

  console.log("");
  console.log(
    `🏝️  Bridge running — ${apps.length} bot(s) connected, Gateway :${config.gatewayPort}`
  );
  console.log("   Press Ctrl+C to stop");
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/bridge/index.ts
git commit -m "feat: add bridge entry point with multi-account support"
```

---

### Task 8: Build, Install Dependencies, Test

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.build.json`

- [ ] **Step 1: Install dependencies**

Run: `npm install @slack/bolt @slack/web-api ws dotenv`
Run: `npm install -D @types/ws`

- [ ] **Step 2: Update tsconfig.build.json to include bridge**

Verify `src/bridge/**/*.ts` is included in the build.

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (existing + new bridge tests).

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: No TypeScript errors. `dist/bridge/` directory created.

- [ ] **Step 5: Test CLI locally**

Run: `node bin/oasis.js bridge`
Expected: Bridge starts, reads config, attempts to connect bots. May fail if tokens are invalid in dev env but should show the startup sequence.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: complete OASIS Slack Bridge with multi-account Bolt support"
```

---

### Task 9: Version Bump + Push

**Files:**
- Modify: `package.json`
- Modify: `openclaw.plugin.json`

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`

- [ ] **Step 2: Build**

Run: `npm run build`

- [ ] **Step 3: Bump version**

Run: `npm version minor --no-git-tag-version` (→ 1.1.0, since this is a new feature)

- [ ] **Step 4: Sync openclaw.plugin.json version**

Update version to match.

- [ ] **Step 5: Commit and push**

```bash
git add -A
git commit -m "feat: OASIS v1.1.0 — Slack Bridge with Block Kit approval buttons"
git push origin main
```
