# OASIS Dedicated Slack App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the multi-bot bridge with a single dedicated OASIS Slack app that reliably handles approval UI via reactions, and remove all old bridge code.

**Architecture:** The OASIS plugin starts a single Bolt app (Socket Mode) using a dedicated OASIS Slack app's tokens (stored in plugin config). This app has NO event routing conflicts because it doesn't share tokens with OpenClaw. It detects approval messages, updates them with clean format + reactions, handles user reactions, and resolves approvals via Gateway WS.

**Tech Stack:** @slack/bolt (kept), ws (kept for gateway-client), vitest

---

## File Structure

### DELETE:
- `src/bridge/` (entire directory — 6 files)
- `tests/bridge/` (entire directory — 3 files)
- `bin/oasis.js`

### KEEP (reuse from bridge):
- `src/bridge/approval-parser.ts` → move to `src/slack/approval-parser.ts`
- `src/bridge/gateway-client.ts` → move to `src/slack/gateway-client.ts`

### CREATE:
- `src/slack/index.ts` — Slack app entry (single Bolt instance, started from plugin register)
- `src/slack/approval-handler.ts` — message detection + reaction handling + approval resolution

### MODIFY:
- `src/index.ts` — start Slack app from plugin `register()`, remove `before_message_write` hook
- `src/cli/setup-wizard.ts` — add `openclaw oasis setup` for token input
- `package.json` — remove `bin`, remove `dotenv`, remove `@slack/web-api` (bolt includes it), remove `@types/ws` if unused
- `openclaw.plugin.json` — add `oasisBotToken` and `oasisAppToken` config fields

---

### Task 1: Delete Bridge + Bin

**Files:**
- Delete: `src/bridge/` (all 6 files)
- Delete: `tests/bridge/` (all 3 files)
- Delete: `bin/oasis.js`
- Modify: `package.json` — remove `bin` field, remove `bin` from `files`, remove `dotenv` and `@types/ws` from deps
- Modify: `.gitignore` — remove `!bin/*.js`

- [ ] **Step 1: Delete files**

```bash
rm -rf src/bridge tests/bridge bin
```

- [ ] **Step 2: Update package.json**

Remove:
- `"bin": { "oasis": "./bin/oasis.js" }`
- `"bin"` from `files` array
- `"dotenv"` from dependencies
- `"@types/ws"` from devDependencies
- `"@slack/web-api"` from dependencies (Bolt includes it)

- [ ] **Step 3: Remove `!bin/*.js` from .gitignore**

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds (bridge imports are gone, nothing references them)

- [ ] **Step 5: Run tests**

Run: `npx vitest run`
Expected: All remaining tests pass (bridge tests deleted)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove bridge code, bin, and bridge dependencies"
```

---

### Task 2: Move Reusable Files to src/slack/

**Files:**
- Create: `src/slack/approval-parser.ts` (copy from old bridge, already deleted — recreate)
- Create: `src/slack/gateway-client.ts` (copy from old bridge — recreate)
- Create: `tests/slack/approval-parser.test.ts` (recreate)

- [ ] **Step 1: Create src/slack/ directory**

```bash
mkdir -p src/slack tests/slack
```

- [ ] **Step 2: Create approval-parser.ts**

Same as the bridge version — parse approval messages for ID, title, toolName, riskScore, detected, parameters.

```typescript
// src/slack/approval-parser.ts
export interface ParsedApproval {
  approvalId: string;
  title: string;
  toolName: string;
  pluginName: string;
  riskScore: string;
  detected: string;
  parameters: string;
}

export function parseApprovalMessage(text: string): ParsedApproval | null {
  if (!text.includes("Plugin approval required")) return null;

  const idMatch = text.match(/ID:\s*(plugin:[a-f0-9-]+)/i);
  if (!idMatch) return null;

  const titleMatch = text.match(/Title:\s*(.+)/);
  const toolMatch = text.match(/^Tool:\s*(\S+)/m);
  const pluginMatch = text.match(/Plugin:\s*(\S+)/);
  const riskMatch = text.match(/\[([\d.]+)\]/) ?? text.match(/Risk Score:\s*\*?\*?\s*[`]?([\d.]+)/) ?? text.match(/score:([\d.]+)/);
  const detectedMatch = text.match(/Detected:\s*\*?\*?\s*([^|\n]+)/) ?? text.match(/detected:([^|]+)/);

  let parameters = "";
  const paramStart = text.indexOf("Parameters:");
  if (paramStart !== -1) {
    const afterParam = text.slice(paramStart + "Parameters:".length);
    const blockMatch = afterParam.match(/```([\s\S]*?)```/);
    if (blockMatch) {
      parameters = blockMatch[1].trim();
    } else {
      const jsonMatch = afterParam.match(/\{[\s\S]*?\}/);
      if (jsonMatch) parameters = jsonMatch[0].trim();
    }
  }
  if (!parameters) {
    const compactParams = text.match(/params:(\{[^}]+\})/);
    if (compactParams) parameters = compactParams[1];
  }

  return {
    approvalId: idMatch[1],
    title: titleMatch?.[1]?.trim() ?? "Approval Required",
    toolName: toolMatch?.[1] ?? "unknown",
    pluginName: pluginMatch?.[1] ?? "unknown",
    riskScore: riskMatch?.[1] ?? riskMatch?.[2] ?? "?",
    detected: (detectedMatch?.[1] ?? detectedMatch?.[2] ?? "").trim(),
    parameters,
  };
}
```

- [ ] **Step 3: Create gateway-client.ts**

Same as bridge version — one-shot WS with device identity signing.

(Exact code from current `src/bridge/gateway-client.ts` — the `resolveApprovalOneShot` function)

- [ ] **Step 4: Create approval-parser test**

```typescript
// tests/slack/approval-parser.test.ts
// Same tests as bridge version
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: move approval-parser and gateway-client to src/slack/"
```

---

### Task 3: Create Slack App Handler

**Files:**
- Create: `src/slack/approval-handler.ts`

- [ ] **Step 1: Implement approval handler**

Single Bolt app that:
1. Watches `message` events for approval messages
2. Updates message with clean format + ✅🙅 reactions
3. Watches `reaction_added` for user reactions
4. Resolves approval via Gateway WS one-shot
5. Updates message to show result
6. Deletes "Plugin approval allowed/denied" followup messages

```typescript
// src/slack/approval-handler.ts
import { App, LogLevel } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import { parseApprovalMessage } from "./approval-parser.js";
import { resolveApprovalOneShot } from "./gateway-client.js";

interface SlackAppConfig {
  botToken: string;
  appToken: string;
  gatewayPort: number;
  gatewayAuthToken?: string;
}

export function startOasisSlackApp(config: SlackAppConfig) {
  const app = new App({
    token: config.botToken,
    appToken: config.appToken,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  const processedMessages = new Set<string>();
  const resolvedApprovals = new Set<string>();
  let botUserId: string | undefined;

  // Detect approval messages → update + add reactions
  app.event("message", async ({ event, client }) => {
    const msg = event as any;
    const text: string = msg.text ?? "";
    const ts: string | undefined = msg.ts;
    const channel: string | undefined = msg.channel;

    if (!ts || !channel || !text) return;

    // Delete followup messages
    if (text.match(/Plugin approval (allowed|denied|expired)/i)) {
      try { await client.chat.delete({ channel, ts }); } catch {
        // OASIS bot might not own the message — that's OK
      }
      return;
    }

    if (processedMessages.has(ts)) return;

    const parsed = parseApprovalMessage(text);
    if (!parsed) return;

    processedMessages.add(ts);

    // Update the message with clean format
    // We need the ORIGINAL bot's token to update its message
    // Since we can't update other bots' messages, we post a reply instead
    try {
      await client.chat.postMessage({
        channel,
        thread_ts: ts,
        text: [
          `*${parsed.title.replace(/^🏝️\s*/, "🏝️ ")}*`,
          `*Tool:* \`${parsed.toolName}\`  •  *Risk Score:* \`${parsed.riskScore}\` / 1.0`,
          parsed.detected ? `*Detected:* ${parsed.detected}` : "",
          parsed.parameters ? `*Parameters:*\n\`\`\`${parsed.parameters.slice(0, 500)}\`\`\`` : "",
          ``,
          `React ✅ on the message above to *Allow* or 🙅 to *Deny*`,
        ].filter(Boolean).join("\n"),
      });

      // Add reactions to the ORIGINAL approval message
      await client.reactions.add({ channel, timestamp: ts, name: "white_check_mark" });
      await client.reactions.add({ channel, timestamp: ts, name: "no_good" });
      console.log(`[OASIS] Approval ready: ${parsed.approvalId.slice(0, 12)}`);
    } catch (err) {
      console.error(`[OASIS] Failed: ${err}`);
      processedMessages.delete(ts);
    }

    // Prune
    if (processedMessages.size > 1000) {
      const entries = [...processedMessages];
      for (let i = 0; i < entries.length - 500; i++) {
        processedMessages.delete(entries[i]);
      }
    }
  });

  // Handle reactions
  app.event("reaction_added", async ({ event, client }) => {
    const reaction = event as any;
    const ts = reaction.item?.ts;
    const channel = reaction.item?.channel;
    const reactionName = reaction.reaction;
    const userId = reaction.user;

    if (!ts || !channel) return;

    // Resolve bot user ID
    if (!botUserId) {
      try {
        const auth = await client.auth.test();
        botUserId = auth.user_id as string;
      } catch {}
    }
    if (userId === botUserId) return;

    let decision: "allow-once" | "deny";
    if (reactionName === "white_check_mark") {
      decision = "allow-once";
    } else if (reactionName === "no_good") {
      decision = "deny";
    } else {
      return;
    }

    // Fetch the message to get approval ID
    let messageText = "";
    try {
      const result = await client.conversations.replies({
        channel, ts, limit: 1, inclusive: true,
      });
      messageText = (result.messages?.[0] as any)?.text ?? "";
    } catch {
      try {
        const result = await client.conversations.history({
          channel, latest: ts, limit: 1, inclusive: true,
        });
        messageText = (result.messages?.[0] as any)?.text ?? "";
      } catch { return; }
    }

    const parsed = parseApprovalMessage(messageText);
    if (!parsed) return;

    if (resolvedApprovals.has(parsed.approvalId)) return;
    resolvedApprovals.add(parsed.approvalId);

    const label = decision === "allow-once" ? "Allowed" : "Denied";
    const emoji = decision === "allow-once" ? "✅" : "🙅";

    console.log(`[OASIS] ${label} by <@${userId}>`);

    try {
      await resolveApprovalOneShot(config.gatewayPort, config.gatewayAuthToken, {
        id: parsed.approvalId,
        decision,
      });
      console.log(`[OASIS] Gateway resolved: ${label}`);

      // Post resolution as reply
      await client.chat.postMessage({
        channel,
        thread_ts: ts,
        text: `${emoji} *OASIS: ${label}* by <@${userId}>`,
      });
    } catch (err) {
      console.error(`[OASIS] Resolve failed: ${err}`);
      resolvedApprovals.delete(parsed.approvalId);
    }
  });

  app.error(async (error) => {
    console.error(`[OASIS] Slack app error:`, error);
  });

  return app;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/slack/approval-handler.ts
git commit -m "feat: add dedicated OASIS Slack app handler"
```

---

### Task 4: Add Config Fields + Setup Wizard

**Files:**
- Modify: `openclaw.plugin.json` — add `oasisBotToken`, `oasisAppToken`
- Modify: `src/cli/setup-wizard.ts` — add `setup` command for token input
- Modify: `src/config.ts` — add `oasisBotToken`, `oasisAppToken` to OasisConfig
- Modify: `src/types.ts` — add fields to OasisConfig interface

- [ ] **Step 1: Add fields to types.ts**

Add to `OasisConfig`:
```typescript
oasisBotToken?: string;
oasisAppToken?: string;
```

- [ ] **Step 2: Add defaults to config.ts**

```typescript
oasisBotToken: pluginConfig.oasisBotToken ?? defaultConfig.oasisBotToken,
oasisAppToken: pluginConfig.oasisAppToken ?? defaultConfig.oasisAppToken,
```

Default: `undefined`

- [ ] **Step 3: Add to openclaw.plugin.json**

```json
"oasisBotToken": {
  "type": "string",
  "description": "Bot token for the dedicated OASIS Slack app (xoxb-...)"
},
"oasisAppToken": {
  "type": "string",
  "description": "App-level token for the dedicated OASIS Slack app (xapp-...)"
}
```

- [ ] **Step 4: Update setup-wizard.ts**

Add `setup` command that prompts for tokens via readline and writes to config.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add OASIS Slack app token config fields + setup wizard"
```

---

### Task 5: Start Slack App from Plugin Register

**Files:**
- Modify: `src/index.ts` — start Slack app if tokens are configured, remove `before_message_write` hook

- [ ] **Step 1: Update register() in src/index.ts**

After registering the `before_tool_call` hook, check if OASIS Slack tokens exist. If yes, start the Slack app:

```typescript
// ── OASIS Slack App (dedicated) ──
if (config.oasisBotToken && config.oasisAppToken) {
  const { startOasisSlackApp } = await import("./slack/approval-handler.js");
  const slackApp = startOasisSlackApp({
    botToken: config.oasisBotToken,
    appToken: config.oasisAppToken,
    gatewayPort: loadGatewayPort(),
    gatewayAuthToken: loadGatewayAuthToken(),
  });
  slackApp.start().then(() => {
    logger.info("[OASIS] Slack app connected");
  }).catch((err) => {
    logger.error(`[OASIS] Slack app failed: ${err}`);
  });
}
```

- [ ] **Step 2: Remove `before_message_write` hook** (no longer needed)

- [ ] **Step 3: Remove `handleBeforeMessageWrite` export and related code**

- [ ] **Step 4: Update integration tests** — remove `handleBeforeMessageWrite` tests

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All pass.

- [ ] **Step 6: Build**

Run: `npm run build`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: start OASIS Slack app from plugin register when tokens configured"
```

---

### Task 6: Update README + Version Bump

**Files:**
- Modify: `README.md`
- Modify: `docs/README-ko.md`
- Modify: `package.json` — version bump
- Modify: `openclaw.plugin.json` — version bump

- [ ] **Step 1: Update READMEs**

Replace bridge instructions with dedicated Slack app setup:

```markdown
## Installation

### 1. Plugin
\`\`\`bash
openclaw plugins install @petercha90/oasis
\`\`\`

### 2. OASIS Slack App (for approval buttons)

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**
2. Name: `OASIS` / Workspace: your workspace
3. **OAuth & Permissions** → Add Bot Token Scopes:
   - `chat:write`, `reactions:read`, `reactions:write`
   - `channels:history`, `channels:read`
4. **Socket Mode** → Enable → Generate App Token (name: `oasis`) → Copy `xapp-...`
5. **Install to Workspace** → Copy Bot Token `xoxb-...`
6. **Event Subscriptions** → Subscribe to bot events:
   - `message.channels`, `reaction_added`
7. Configure OASIS:
\`\`\`bash
openclaw oasis setup
\`\`\`
8. Invite OASIS bot to your channels:
\`\`\`
/invite @OASIS
\`\`\`
```

- [ ] **Step 2: Version bump**

```bash
npm version minor --no-git-tag-version
```

Sync `openclaw.plugin.json`.

- [ ] **Step 3: Commit + push**

```bash
git add -A
git commit -m "feat: OASIS v1.2.0 — dedicated Slack app, no bridge needed"
git push origin main
```
