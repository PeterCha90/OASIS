<p align="center">
  <img src="https://img.shields.io/badge/OpenClaw-Plugin-blueviolet?style=for-the-badge" alt="OpenClaw Plugin" />
  <img src="https://img.shields.io/badge/Slack-Required-4A154B?style=for-the-badge&logo=slack" alt="Slack Required" />
  <img src="https://img.shields.io/npm/v/@petercha90/oasis?style=for-the-badge&color=red" alt="npm" />
  <img src="https://img.shields.io/github/license/PeterCha90/oasis?style=for-the-badge" alt="License" />
</p>

<h1 align="center">🏝️ OASIS</h1>
<h3 align="center">OpenClaw Antidote for Suspicious Injection Signals</h3>

<p align="center">
  A native OpenClaw plugin for <b>Slack</b> that intercepts every tool call,<br/>
  scores risk with deterministic pattern matching,<br/>
  and <b>lets you approve or deny with Slack buttons.</b>
</p>

<p align="center">
  No LLM judgment. No false confidence. Just regex and math.
</p>

---

<p align="center">
  <img src="https://raw.githubusercontent.com/PeterCha90/oasis/main/public/example1.png" alt="OASIS Approval Example" width="550" />
</p>

---

**[🇰🇷 한국어 문서](docs/README-ko.md)**

---

## How It Works

OASIS hooks into OpenClaw's `before_tool_call` pipeline at the Gateway level. Every tool call passes through a three-stage decision:

```
Agent requests tool call
        │
        ▼
  ┌─────────────────┐
  │ before_tool_call│ ◄── OASIS hook
  └────────┬────────┘
           │
     Read tool? ─── Yes ──→ Pass through ✅
           │
          No
           │
     Pattern scan ──→ score 0.0 ~ 1.0
           │
     ┌─────┴──────┐
   = 1.0        > threshold        ≤ threshold
     │              │                    │
  🚨 Block     ⚠️ Approval         ✅ Auto-allow
  (no override)  (Slack buttons)
```

---

## Requirements

| Requirement      | Minimum Version |
| ---------------- | --------------- |
| OpenClaw Gateway | `>= 2026.3.28`  |
| Node.js          | `>= 22.14`      |
| Slack workspace  | Required         |

---

## Installation

### 1. Install Plugin

```bash
openclaw plugins install @petercha90/oasis
openclaw gateway restart
```

### 2. Create OASIS Slack App

A dedicated Slack app is **required** for OASIS to work. It handles approval buttons and user interactions.

#### Step 1: Create the App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App**<br>
   <img src="https://raw.githubusercontent.com/PeterCha90/oasis/main/public/1.png"/>
   → **From scratch** <br>
   <img src="https://raw.githubusercontent.com/PeterCha90/oasis/main/public/2.png"/>

3. App Name: `OASIS`
4. Pick your workspace → **Create App**

#### Step 2: Enable Socket Mode

1. Left sidebar → **Socket Mode**
2. Toggle **Enable Socket Mode** to ON <br>
   <img src="https://raw.githubusercontent.com/PeterCha90/oasis/main/public/3.png"/>

3. You'll be prompted to create an App-Level Token:
   - Token Name: `oasis`
   - Scope: `connections:write` (auto-selected)
   - Click **Generate**

<img src="https://raw.githubusercontent.com/PeterCha90/oasis/main/public/4.png"/>

4. Copy the token starting with `xapp-...` — this is your **App Token**

#### Step 3: Set Bot Permissions

1. Left sidebar → **OAuth & Permissions**
2. Scroll to **Scopes** → **Bot Token Scopes**
3. Click **Add an OAuth Scope** and add these 5 scopes:

| Scope | Purpose |
|-------|---------|
| `chat:write` | Post approval summaries and results |
| `reactions:read` | Detect when users react ✅ or 🙅 |
| `reactions:write` | Add ✅ 🙅 reaction hints to approval messages |
| `channels:history` | Read approval messages to extract approval ID |
| `channels:read` | Access channel info |

  <img src="https://raw.githubusercontent.com/PeterCha90/oasis/main/public/6.png"/>

#### Step 4: Subscribe to Events

1. Left sidebar → **Event Subscriptions**
2. Toggle **Enable Events** to ON
3. Scroll to **Subscribe to bot events** → **Add Bot User Event**
4. Add these 2 events:

| Event | Purpose |
|-------|---------|
| `message.channels` | Detect approval messages from OpenClaw agents |
| `reaction_added` | Detect user's Allow (✅) or Deny (🙅) reaction |

<img src="https://raw.githubusercontent.com/PeterCha90/oasis/main/public/8.png"/>

5. Click **Save Changes**

#### Step 5: Messages Tab (On)

1. Left sidebar → **App Home**
2. Enable **Messages Tab** under **Show Tabs**

  <img src="https://raw.githubusercontent.com/PeterCha90/oasis/main/public/10.png"/>

#### Step 6: Install to Workspace

1. Left sidebar → **Install App**
2. Click **Install to Workspace** → **Allow**
   <img src="https://raw.githubusercontent.com/PeterCha90/oasis/main/public/9.png"/>

3. Copy the **Bot User OAuth Token** starting with `xoxb-...` — this is your **Bot Token**

### 3. Configure OASIS

Add both tokens to your OpenClaw plugin config. You can use direct strings or SecretRef:

**Option A: Direct tokens**

```jsonc
// ~/.openclaw/openclaw.json
{
  "plugins": {
    "entries": {
      "oasis": {
        "enabled": true,
        "config": {
          "threshold": 0.5,
          "oasisBotToken": "xoxb-your-bot-token-here",
          "oasisAppToken": "xapp-your-app-token-here"
        }
      }
    }
  },
  "approvals": {
    "plugin": {
      "enabled": true
    }
  }
}
```

**Option B: SecretRef (recommended — keeps tokens in `.env`)**

```jsonc
// ~/.openclaw/openclaw.json
{
  "plugins": {
    "entries": {
      "oasis": {
        "enabled": true,
        "config": {
          "threshold": 0.5,
          "oasisBotToken": {
            "source": "env",
            "provider": "default",
            "id": "OASIS_BOT_TOKEN"
          },
          "oasisAppToken": {
            "source": "env",
            "provider": "default",
            "id": "OASIS_APP_TOKEN"
          }
        }
      }
    }
  },
  "approvals": {
    "plugin": {
      "enabled": true
    }
  }
}
```

```bash
# ~/.openclaw/.env
OASIS_BOT_TOKEN=xoxb-your-bot-token
OASIS_APP_TOKEN=xapp-your-app-token
```

### 4. Invite OASIS bot to channels

```
/invite @OASIS
```

Restart the gateway and OASIS will automatically connect:

```bash
openclaw gateway restart
```

> When a tool call requires approval, OASIS posts Allow / Deny / Allow Always buttons in Slack.

---

## Allow Always

For repetitive commands like CronJobs or Slack Webhooks, you can skip repeated approvals by clicking **🔁 Allow Always**. This permanently allows the exact `tool + command/URL` combination.

- Click **🔁 Allow Always** on an approval request → the specific command is added to the allowlist
- Future identical calls are auto-approved without prompts
- The allowlist is persisted to disk and survives Gateway restarts

### Managing the Allowlist

**DM the OASIS bot with `list`** to view, remove individual entries, or clear the entire allowlist:

<p align="center">
  <img src="https://raw.githubusercontent.com/PeterCha90/oasis/main/public/11.png" alt="OASIS Allowlist Management" width="800" />
</p>

---

## Tool Classification

| Classification          | Tools                                                                      | Behavior         |
| ----------------------- | -------------------------------------------------------------------------- | ---------------- |
| **Read** (free pass)    | `read`, `glob`, `grep`, `web_search`, `list`, `cat`                        | No analysis      |
| **Execute** (risk scan) | `exec`, `bash`, `write`, `edit`, `web_fetch`, `file_delete`, `apply_patch` | Pattern matching |

Customize via config:

```jsonc
{
  "config": {
    "customReadTools": ["my_safe_tool"],
    "customExecuteTools": ["my_dangerous_tool"]
  }
}
```

---

## Risk Scoring

All scoring is **deterministic pattern matching**. No LLM involved.

| ID                     | Detection                                        | Score   | Action       |
| ---------------------- | ------------------------------------------------ | ------- | ------------ |
| `BLOCK_DESTRUCTIVE`    | `rm -rf /`, fork bomb, `mkfs`, `dd if=/dev/zero` | **1.0** | 🚨 Blocked   |
| `BLOCK_PIPE_SHELL`     | `curl \| bash`, `wget \| sh`                     | **1.0** | 🚨 Blocked   |
| `PROMPT_INJECTION`     | `ignore previous instructions`, `you are now`    | 0.9     | Ask approval |
| `SECRET_ACCESS`        | `$AWS_SECRET`, `process.env.TOKEN`               | 0.8     | Ask approval |
| `SUSPICIOUS_DOMAIN`    | `.xyz`, `.tk`, `.ml`, `.pw`, `.top`              | 0.8     | Ask approval |
| `DATA_EXFILTRATION`    | `curl -X POST`, `nc -e`, reverse shell           | 0.7     | Ask approval |
| `SENSITIVE_FILE`       | `.env`, `.ssh/id_rsa`, `.aws/credentials`        | 0.6     | Ask approval |
| `PRIVILEGE_ESCALATION` | `sudo`, `chmod 777`, `chown root`                | 0.5     | Ask approval |
| `EXTERNAL_URL`         | Non-safe-domain HTTP access                      | 0.3     | Ask approval |

- **Score 1.0** = always blocked, no approval possible
- **Score > threshold** = user approval required (Slack buttons)
- **Score ≤ threshold** = auto-allowed
- Multiple matches use `max()` strategy

---

## Configuration

| Option               | Type       | Default  | Description                                         |
| -------------------- | ---------- | -------- | --------------------------------------------------- |
| `threshold`          | `number`   | `0.5`    | Risk threshold (0.0 strictest ~ 0.9 most lenient)   |
| `approvalTimeoutMs`  | `number`   | `120000` | Approval timeout in ms (auto-deny on timeout)       |
| `safeDomains`        | `string[]` | `[]`     | Additional safe domains (skip EXTERNAL_URL scoring) |
| `customPatterns`     | `object[]` | `[]`     | Custom detection patterns (`{id, regex, score}`)    |
| `customReadTools`    | `string[]` | `[]`     | Additional read-only tools                          |
| `customExecuteTools` | `string[]` | `[]`     | Additional execute tools                            |
| `logLevel`           | `string`   | `"info"` | `debug`, `info`, `warn`, `error`                    |

### Built-in Safe Domains

`github.com`, `npmjs.com`, `pypi.org`, `crates.io`, `api.anthropic.com`, `api.openai.com`, `docs.openclaw.ai`, `stackoverflow.com` and more.

---

## Uninstall

```bash
openclaw plugins uninstall oasis
openclaw gateway restart
```

---

## Project Structure

```
oasis/
├── src/
│   ├── index.ts              # Plugin entry (definePluginEntry)
│   ├── scanner.ts            # Risk scoring engine
│   ├── classifier.ts         # Tool classification
│   ├── patterns.ts           # Detection patterns
│   ├── config.ts             # Config loading
│   ├── logger.ts             # Structured logging
│   ├── types.ts              # TypeScript types
│   ├── cli/
│   │   └── setup-wizard.ts   # Plugin CLI commands
│   └── slack/
│       ├── approval-handler.ts # Dedicated OASIS Slack app (Socket Mode)
│       ├── approval-parser.ts  # Parse approval messages
│       └── gateway-client.ts   # Gateway WebSocket client
├── tests/                    # 61 tests across 5 suites
├── openclaw.plugin.json      # Plugin manifest
├── package.json
└── tsconfig.json
```

---

## Why "OASIS"?

**O**penClaw **A**ntidote for **S**uspicious **I**njection **S**ignals

Like an oasis in the desert, a safe zone amidst security threats. 🏝️

---

## License

MIT — [Peter Cha](https://github.com/PeterCha90)
