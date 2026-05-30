<p align="center">
  <img src="https://img.shields.io/badge/OpenClaw-Plugin-blueviolet?style=for-the-badge" alt="OpenClaw Plugin" />
  <img src="https://img.shields.io/badge/Slack-Required-4A154B?style=for-the-badge&logo=slack" alt="Slack Required" />
  <img src="https://img.shields.io/npm/v/@petercha90/oasis?style=for-the-badge&color=red" alt="npm" />
  <img src="https://img.shields.io/github/license/PeterCha90/oasis?style=for-the-badge" alt="License" />
</p>

<h1 align="center">🏝️ OASIS</h1>
<h3 align="center">OpenClaw Antidote for Suspicious Injection Signals</h3>

<p align="center">
  <b>Slack</b> 전용 OpenClaw 보안 플러그인.<br/>
  모든 tool 호출을 가로채서 deterministic 패턴 매칭으로 위험도를 점수화하고,<br/>
  <b>Slack 버튼으로 승인/거부</b>할 수 있습니다.
</p>

<p align="center">
  LLM 판단 없음. 오판 없음. 오직 정규식과 수학.
</p>

---

<p align="center">
  <img src="https://raw.githubusercontent.com/PeterCha90/oasis/main/public/example1.png" alt="OASIS Approval Example" width="800" />
</p>

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
  │ before_tool_call│ ◄── OASIS hook
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
  (해제 불가)    (Slack 버튼)
```

---

## 요구사항

| 항목             | 최소 버전      |
| ---------------- | -------------- |
| OpenClaw Gateway | `>= 2026.3.28` |
| Node.js          | `>= 22.14`     |

---

## 설치

### 1. 플러그인

```bash
openclaw plugins install @petercha90/oasis
openclaw gateway restart
```

### 2. OASIS Slack 앱 생성 (필수)

OASIS를 사용하려면 전용 Slack 앱이 **필수**입니다. 승인 버튼과 사용자 인터랙션을 처리합니다.

#### Step 1: Manifest로 앱 생성

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From an app manifest**
2. 워크스페이스 선택
3. [`slack-app-manifest.yaml`](../slack-app-manifest.yaml) 내용 복사 → YAML 탭에 붙여넣기 → **Next** → **Create**

> Manifest가 봇 권한, 이벤트 구독, Socket Mode, Interactivity, Messages Tab을 모두 자동 설정합니다. 수동 클릭 불필요.

#### Step 2: App-Level Token 발급

1. 좌측 메뉴 → **Basic Information** → **App-Level Tokens** → **Generate Token and Scopes**
2. Token Name: `oasis`, Scope: `connections:write` → **Generate**
3. `xapp-...` 토큰 복사 — 이것이 **App Token**

#### Step 3: 워크스페이스에 설치

1. 좌측 메뉴 → **Install App** → **Install to Workspace** → **Allow**
2. `xoxb-...`로 시작하는 **Bot User OAuth Token** 복사 — 이것이 **Bot Token**

### 3. OASIS 설정

OpenClaw 플러그인 config에 두 토큰을 추가합니다. 직접 입력 또는 SecretRef 방식 사용 가능:

**방법 A: 직접 입력**

```jsonc
// ~/.openclaw/openclaw.json
{
  "plugins": {
    "entries": {
      "oasis": {
        "enabled": true,
        "config": {
          "threshold": 0.5,
          "oasisBotToken": "xoxb-여기에-봇-토큰",
          "oasisAppToken": "xapp-여기에-앱-토큰",
        },
      },
    },
  },
  "approvals": {
    "plugin": {
      "enabled": true,
    },
  },
}
```

**방법 B: SecretRef (권장 — 토큰을 `.env`에 보관)**

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
OASIS_BOT_TOKEN=xoxb-여기에-봇-토큰
OASIS_APP_TOKEN=xapp-여기에-앱-토큰
```

### 4. OASIS 봇 채널 초대

```
/invite @OASIS
```

Gateway 재시작하면 OASIS가 자동 연결됩니다:

```bash
openclaw gateway restart
```

> 승인이 필요한 tool 호출 시 OASIS가 Slack에 Allow / Deny / Allow Always 버튼을 표시합니다.

---

## Allow Always (허용 목록)

반복적으로 실행되는 동일한 명령(예: CronJob, Slack Webhook 등)은 매번 승인할 필요 없이 **Allow Always** 버튼으로 영구 허용할 수 있습니다.

- 승인 요청에서 **🔁 Allow Always** 클릭 → 해당 `도구 + 명령어/URL` 조합이 allowlist에 등록
- 이후 동일한 호출은 승인 없이 자동 통과
- allowlist는 파일로 저장되어 Gateway 재시작 후에도 유지

### Allowlist 관리

OASIS 봇에 **DM으로 `list`**를 보내면 현재 등록된 항목을 확인하고 개별 삭제하거나 전체 초기화할 수 있습니다:

<p align="center">
  <img src="https://raw.githubusercontent.com/PeterCha90/oasis/main/public/11.png" alt="OASIS Allowlist Management" width="800" />
</p>

---

## 도구 분류

| 분류                    | 도구                                                                       | 동작           |
| ----------------------- | -------------------------------------------------------------------------- | -------------- |
| **Read** (자유 통과)    | `read`, `glob`, `grep`, `web_search`, `list`, `cat`                        | 분석 없이 통과 |
| **Execute** (위험 분석) | `exec`, `bash`, `write`, `edit`, `web_fetch`, `file_delete`, `apply_patch` | 패턴 매칭 수행 |

커스텀 도구 추가 가능:

```jsonc
{
  "config": {
    "customReadTools": ["my_safe_tool"],
    "customExecuteTools": ["my_dangerous_tool"],
  },
}
```

---

## 위험도 판단

모든 스코어링은 **deterministic 패턴 매칭**이다. LLM 판단에 의존하지 않는다.

| ID                     | 탐지 패턴                                        | 점수    | 처리      |
| ---------------------- | ------------------------------------------------ | ------- | --------- |
| `BLOCK_DESTRUCTIVE`    | `rm -rf /`, fork bomb, `mkfs`, `dd if=/dev/zero` | **1.0** | 🚨 차단   |
| `BLOCK_PIPE_SHELL`     | `curl \| bash`, `wget \| sh`                     | **1.0** | 🚨 차단   |
| `PROMPT_INJECTION`     | `ignore previous instructions`, `you are now`    | 0.9     | 승인 요청 |
| `SECRET_ACCESS`        | `$AWS_SECRET`, `process.env.TOKEN`               | 0.8     | 승인 요청 |
| `SUSPICIOUS_DOMAIN`    | `.xyz`, `.tk`, `.ml`, `.pw`, `.top`              | 0.8     | 승인 요청 |
| `DATA_EXFILTRATION`    | `curl -X POST`, `nc -e`, reverse shell           | 0.7     | 승인 요청 |
| `SENSITIVE_FILE`       | `.env`, `.ssh/id_rsa`, `.aws/credentials`        | 0.6     | 승인 요청 |
| `PRIVILEGE_ESCALATION` | `sudo`, `chmod 777`, `chown root`                | **0.5** | 승인 요청 |
| `EXTERNAL_URL`         | 안전 도메인 외 HTTP 접근                         | 0.3     | 승인 요청 |

- **Score 1.0** = 무조건 차단, 승인 불가
- **Score > threshold** = 사용자 승인 필요 (Slack 버튼)
- **Score ≤ threshold** = 자동 허용
- 복수 패턴 매칭 시 `max()` 전략 사용

---

## 설정 옵션

| 옵션                 | 타입       | 기본값   | 설명                                          |
| -------------------- | ---------- | -------- | --------------------------------------------- |
| `threshold`          | `number`   | `0.5`    | 위험도 임계값 (0.0 가장 엄격 ~ 0.9 가장 관대) |
| `approvalTimeoutMs`  | `number`   | `120000` | 승인 대기 시간 (타임아웃 시 자동 거부)        |
| `safeDomains`        | `string[]` | `[]`     | 추가 안전 도메인 (EXTERNAL_URL 스킵)          |
| `customPatterns`     | `object[]` | `[]`     | 커스텀 탐지 패턴 (`{id, regex, score}`)       |
| `customReadTools`    | `string[]` | `[]`     | 추가 읽기 전용 도구                           |
| `customExecuteTools` | `string[]` | `[]`     | 추가 실행 도구                                |
| `logLevel`           | `string`   | `"info"` | `debug`, `info`, `warn`, `error`              |

### 기본 안전 도메인

`github.com`, `npmjs.com`, `pypi.org`, `crates.io`, `api.anthropic.com`, `api.openai.com`, `docs.openclaw.ai`, `stackoverflow.com` 등.

---

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
│   ├── allowlist.ts          # 허용 목록 관리
│   ├── config.ts             # 설정 로딩
│   ├── logger.ts             # 구조화 로깅
│   ├── types.ts              # TypeScript 타입
│   ├── cli/
│   │   └── setup-wizard.ts   # 플러그인 CLI 명령어
│   └── slack/
│       ├── approval-handler.ts # 전용 OASIS Slack 앱 (Socket Mode)
│       ├── approval-parser.ts  # 승인 메시지 파서
│       └── gateway-client.ts   # Gateway WebSocket 클라이언트
├── tests/                    # 61개 테스트 (5개 스위트)
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
