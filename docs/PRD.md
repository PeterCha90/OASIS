# PRD: OpenClaw Approval Gate Plugin

## 개요

OpenClaw 에이전트가 위험한 tool 실행(파일 삭제, 외부 네트워크 요청, 시스템 명령 등)을 시도할 때, `before_tool_call` 플러그인 훅의 `requireApproval`을 활용하여 사용자 승인을 받은 후에만 실행되도록 하는 플러그인.

## 배경

- OpenClaw `v2026.3.28`에서 `before_tool_call` 훅에 async `requireApproval`이 추가됨
- `requireApproval` 반환 시 에이전트 실행이 일시 정지되고, Slack `/approve` 커맨드 또는 채널별 네이티브 UI(Telegram 버튼, Discord interactions, exec approval overlay)를 통해 사용자 승인/거부 가능
- 별도 콜백 서버 불필요 — OpenClaw Gateway가 승인 플로우를 네이티브로 처리

## 목표

1. 위험 tool 호출을 패턴 매칭으로 감지하여 사용자 승인을 요구
2. 승인 없이는 절대 실행되지 않는 **확정적(deterministic)** 게이트
3. CISO 에이전트(Plankton)가 모니터링할 수 있는 감사 로그 생성
4. SpongeBob 테마에 맞는 승인 메시지 포맷

## 비목표 (Out of Scope)

- 에이전트 SOUL.md 기반의 소프트 규칙 (프롬프트 레벨 판단)
- 별도 콜백 서버/웹훅 엔드포인트 구축
- 승인 이력 기반 자동 화이트리스트 (v2에서 고려)

---

## 기술 스펙

### 1. 플러그인 구조

```
~/.openclaw/extensions/approval-gate/
├── openclaw.plugin.json    # 플러그인 매니페스트
├── package.json
└── index.ts                # 플러그인 엔트리
```

### 2. 매니페스트 (`openclaw.plugin.json`)

```json
{
  "id": "approval-gate",
  "name": "Approval Gate",
  "version": "1.0.0",
  "description": "Intercepts dangerous tool calls and requires user approval before execution",
  "configSchema": {
    "type": "object",
    "properties": {
      "severity": {
        "type": "object",
        "description": "위험 등급별 패턴 정의",
        "properties": {
          "critical": {
            "type": "array",
            "items": { "type": "string" },
            "description": "CRITICAL 패턴 (regex). 매칭 시 반드시 승인 필요",
            "default": [
              "rm\\s+-rf",
              "rm\\s+-r",
              "mkfs",
              "dd\\s+if=",
              "chmod\\s+777",
              "DROP\\s+TABLE",
              "DELETE\\s+FROM",
              "truncate"
            ]
          },
          "high": {
            "type": "array",
            "items": { "type": "string" },
            "description": "HIGH 패턴. 외부 통신, 파일 쓰기 등",
            "default": [
              "curl\\s+",
              "wget\\s+",
              "fetch\\(",
              "git\\s+push",
              "npm\\s+publish",
              "pip\\s+install",
              "sudo\\s+"
            ]
          },
          "monitored": {
            "type": "array",
            "items": { "type": "string" },
            "description": "MONITORED 패턴. 로그만 남기고 승인 불필요",
            "default": ["cat\\s+/etc/", "ls\\s+-la"]
          }
        }
      },
      "protectedPaths": {
        "type": "array",
        "items": { "type": "string" },
        "description": "쓰기 작업 시 승인이 필요한 경로 패턴 (glob)",
        "default": ["/etc/**", "/prod/**", "**/.env", "**/secrets.*"]
      },
      "timeoutMs": {
        "type": "number",
        "description": "승인 대기 타임아웃 (ms)",
        "default": 120000
      },
      "timeoutBehavior": {
        "type": "string",
        "enum": ["allow", "deny"],
        "description": "타임아웃 시 기본 동작",
        "default": "deny"
      },
      "blocklist": {
        "type": "array",
        "items": { "type": "string" },
        "description": "승인 요청 없이 무조건 차단하는 패턴 (regex)",
        "default": [":(){ :|:& };:", "rm\\s+-rf\\s+/\\s*$", "mkfs\\s+/dev/sda"]
      },
      "auditLogPath": {
        "type": "string",
        "description": "감사 로그 파일 경로",
        "default": "~/.openclaw/logs/approval-gate.log"
      }
    }
  }
}
```

### 3. `package.json`

```json
{
  "name": "@openclaw-peter/approval-gate",
  "version": "1.0.0",
  "type": "module",
  "openclaw": {
    "extensions": ["./index.ts"],
    "compat": {
      "pluginApi": ">=2026.3.28",
      "minGatewayVersion": "2026.3.28"
    }
  }
}
```

### 4. 플러그인 핸들러 (`index.ts`)

```typescript
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { appendFileSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";

// ── 위험도 분류 타입 ──
type Severity = "critical" | "high" | "monitored" | "safe";
type Decision = "block" | "requireApproval" | "log" | "pass";

interface ToolCallContext {
  toolName: string;
  params: Record<string, unknown>;
}

interface ApprovalGateConfig {
  severity: {
    critical: string[];
    high: string[];
    monitored: string[];
  };
  protectedPaths: string[];
  timeoutMs: number;
  timeoutBehavior: "allow" | "deny";
  blocklist: string[];
  auditLogPath: string;
}

// ── 유틸 ──
function matchesAny(input: string, patterns: string[]): boolean {
  return patterns.some((p) => new RegExp(p, "i").test(input));
}

function classifySeverity(input: string, config: ApprovalGateConfig): Severity {
  if (matchesAny(input, config.blocklist)) return "critical"; // 무조건 차단용이지만 severity 분류상 critical
  if (matchesAny(input, config.severity.critical)) return "critical";
  if (matchesAny(input, config.severity.high)) return "high";
  if (matchesAny(input, config.severity.monitored)) return "monitored";
  return "safe";
}

function decide(
  severity: Severity,
  input: string,
  config: ApprovalGateConfig,
): Decision {
  // blocklist는 승인 기회 없이 즉시 차단
  if (matchesAny(input, config.blocklist)) return "block";

  switch (severity) {
    case "critical":
      return "requireApproval";
    case "high":
      return "requireApproval";
    case "monitored":
      return "log";
    case "safe":
      return "pass";
  }
}

function writeAuditLog(
  logPath: string,
  entry: {
    timestamp: string;
    toolName: string;
    input: string;
    severity: Severity;
    decision: Decision;
    agent?: string;
  },
) {
  const resolvedPath = logPath.replace("~", homedir());
  const line = JSON.stringify(entry) + "\n";
  try {
    appendFileSync(resolve(resolvedPath), line);
  } catch {
    // 로그 실패는 tool 실행을 막지 않음
  }
}

// ── 플러그인 등록 ──
export default definePluginEntry({
  id: "approval-gate",
  name: "Approval Gate",
  description: "Intercepts dangerous tool calls and requires user approval",

  register(api) {
    const config = api.config as ApprovalGateConfig;

    api.on("before_tool_call", async (event, ctx) => {
      const { toolName, params } = event as ToolCallContext;

      // Bash/Shell 계열 tool만 심층 검사
      // Write/Edit tool은 경로 기반 검사
      let inputToCheck = "";

      if (["Bash", "bash", "shell", "execute"].includes(toolName)) {
        inputToCheck =
          typeof params.command === "string"
            ? params.command
            : JSON.stringify(params);
      } else if (
        ["Write", "Edit", "write_file", "str_replace"].includes(toolName)
      ) {
        inputToCheck =
          typeof params.path === "string"
            ? params.path
            : JSON.stringify(params);
        // protectedPaths 체크
        if (
          typeof params.path === "string" &&
          config.protectedPaths.some((glob) =>
            new RegExp(
              glob.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*"),
            ).test(params.path as string),
          )
        ) {
          writeAuditLog(config.auditLogPath, {
            timestamp: new Date().toISOString(),
            toolName,
            input: inputToCheck,
            severity: "high",
            decision: "requireApproval",
          });

          return {
            requireApproval: {
              title: "🔐 보호된 경로 쓰기 감지",
              description: `\`${toolName}\` → \`${params.path}\`\n이 경로는 보호 대상입니다. 승인하시겠습니까?`,
              severity: "warning" as const,
              timeoutMs: config.timeoutMs,
              timeoutBehavior: config.timeoutBehavior,
            },
          };
        }
      } else {
        // 기타 tool은 통과
        return {};
      }

      const severity = classifySeverity(inputToCheck, config);
      const decision = decide(severity, inputToCheck, config);

      // 감사 로그 기록
      writeAuditLog(config.auditLogPath, {
        timestamp: new Date().toISOString(),
        toolName,
        input: inputToCheck,
        severity,
        decision,
      });

      switch (decision) {
        case "block":
          return {
            block: true,
            description: `🚫 차단됨: 이 명령은 blocklist에 해당하여 실행이 금지됩니다.\n\`${inputToCheck.slice(0, 100)}\``,
          };

        case "requireApproval":
          return {
            requireApproval: {
              title:
                severity === "critical"
                  ? "🚨 CRITICAL: 위험 명령 승인 필요"
                  : "⚠️ HIGH: 민감한 명령 승인 필요",
              description: [
                `**Tool:** \`${toolName}\``,
                `**명령:** \`\`\`${inputToCheck.slice(0, 300)}\`\`\``,
                `**위험도:** ${severity.toUpperCase()}`,
                "",
                severity === "critical"
                  ? "이 명령은 시스템에 돌이킬 수 없는 변경을 가할 수 있습니다."
                  : "이 명령은 외부 통신 또는 시스템 변경을 수행합니다.",
              ].join("\n"),
              severity: severity === "critical" ? "critical" : "warning",
              timeoutMs: config.timeoutMs,
              timeoutBehavior: config.timeoutBehavior,
            },
          };

        case "log":
          // monitored: 로그만 남기고 통과
          return {};

        case "pass":
        default:
          return {};
      }
    });

    api.logger.info(
      "[approval-gate] Plugin registered. Watching for dangerous tool calls.",
    );
  },
});
```

---

## 동작 흐름

```
에이전트가 tool 실행 시도 (예: Bash "rm -rf /tmp/data")
  │
  ▼
Gateway가 before_tool_call 훅 실행
  │
  ▼
approval-gate 플러그인이 명령 패턴 매칭
  │
  ├─ blocklist 매칭 → { block: true } → 즉시 차단, 에이전트에 차단 사유 전달
  │
  ├─ critical/high 매칭 → { requireApproval: {...} } → 실행 일시 정지
  │    │
  │    ▼
  │  Slack에서 승인 UI 표시 (버튼 or /approve 커맨드)
  │    │
  │    ├─ 사용자 승인 → 실행 재개
  │    ├─ 사용자 거부 → 차단, 에이전트에 거부 사유 전달
  │    └─ 타임아웃 → timeoutBehavior에 따라 deny(기본) 또는 allow
  │
  ├─ monitored 매칭 → 로그 기록 후 통과
  │
  └─ 매칭 없음 → 그대로 통과
```

## `requireApproval` API 스펙 (OpenClaw 공식)

`before_tool_call` 훅에서 반환하는 `requireApproval` 객체:

```typescript
{
  requireApproval: {
    title: string; // 승인 요청 제목
    description: string; // 상세 설명 (Markdown 지원)
    severity: "info" | "warning" | "critical";
    timeoutMs: number; // 기본 120000 (2분)
    timeoutBehavior: "allow" | "deny"; // 기본 "deny"
  }
}
```

**우선순위 규칙:**

- `block: true`는 `requireApproval`보다 우선. 둘 다 있으면 즉시 차단.
- 여러 플러그인이 `requireApproval`을 반환하면 가장 높은 priority의 플러그인이 승리.
- Gateway가 승인 플로우를 지원하지 않으면, `description`을 사유로 한 soft block으로 fallback.

**채널별 승인 UI:**

| 채널     | 승인 방식                               |
| -------- | --------------------------------------- |
| Slack    | `/approve` 커맨드 또는 네이티브 승인 UI |
| Telegram | 인라인 버튼                             |
| Discord  | Interaction 컴포넌트                    |
| Web UI   | Exec approval overlay                   |

---

## 설치 및 활성화 절차

```bash
# 1. 플러그인 디렉토리 생성
mkdir -p ~/.openclaw/extensions/approval-gate
cd ~/.openclaw/extensions/approval-gate

# 2. 파일 생성 (openclaw.plugin.json, package.json, index.ts)
# Claude Code가 위 스펙대로 생성

# 3. 플러그인 설치 및 활성화
openclaw plugins install ~/.openclaw/extensions/approval-gate
openclaw plugins enable approval-gate

# 4. Gateway 재시작
openclaw gateway restart

# 5. 확인
openclaw plugins list
# approval-gate  enabled  workspace
```

## 설정 커스터마이징

`~/.openclaw/config.json`의 `plugins.entries`에서 패턴을 수정:

```json
{
  "plugins": {
    "entries": {
      "approval-gate": {
        "enabled": true,
        "config": {
          "severity": {
            "critical": ["rm\\s+-rf", "DROP\\s+TABLE"],
            "high": ["curl\\s+", "git\\s+push"],
            "monitored": ["cat\\s+/etc/"]
          },
          "protectedPaths": ["/prod/**", "**/.env"],
          "timeoutMs": 180000,
          "timeoutBehavior": "deny",
          "blocklist": [":(){ :|:& };:"],
          "auditLogPath": "~/.openclaw/logs/approval-gate.log"
        }
      }
    }
  }
}
```

---

## 감사 로그 포맷

`~/.openclaw/logs/approval-gate.log` (JSON Lines):

```jsonl
{"timestamp":"2026-03-31T10:30:00.000Z","toolName":"Bash","input":"rm -rf /tmp/old-data","severity":"critical","decision":"requireApproval"}
{"timestamp":"2026-03-31T10:30:15.000Z","toolName":"Bash","input":"curl https://api.example.com/deploy","severity":"high","decision":"requireApproval"}
{"timestamp":"2026-03-31T10:31:00.000Z","toolName":"Bash","input":":(){ :|:& };:","severity":"critical","decision":"block"}
```

## CISO 에이전트(Plankton) 연동

Plankton 에이전트의 IDENTITY.md에 다음을 추가하여 감사 로그를 모니터링하도록 설정:

```markdown
## 감사 로그 모니터링

`~/.openclaw/logs/approval-gate.log`를 주기적으로 확인하라.

- `decision: "block"` 항목은 즉시 보고
- `severity: "critical"` + `decision: "requireApproval"` 항목은 일일 리포트에 포함
- 비정상적 패턴 (동일 에이전트의 반복적 위험 명령 시도) 감지 시 경고
```

---

## 테스트 시나리오

| #   | 입력                             | 예상 결과                          |
| --- | -------------------------------- | ---------------------------------- |
| 1   | `Bash: rm -rf /tmp/data`         | `requireApproval` (critical)       |
| 2   | `Bash: curl https://example.com` | `requireApproval` (high)           |
| 3   | `Bash: ls -la /home`             | 통과 (safe)                        |
| 4   | `Bash: :(){ :\|:& };:`           | `block` (blocklist)                |
| 5   | `Write: /prod/config.yml`        | `requireApproval` (protectedPaths) |
| 6   | `Write: /home/claude/temp.txt`   | 통과 (safe)                        |
| 7   | `Bash: cat /etc/passwd`          | 로그 기록 후 통과 (monitored)      |
| 8   | 승인 요청 후 2분 경과            | 기본 거부 (timeoutBehavior: deny)  |

## 향후 확장 (v2)

- 승인 이력 기반 자동 화이트리스트 (N회 이상 승인된 패턴은 자동 통과)
- 에이전트별 위험 등급 차등 적용 (CEO Sandy는 높은 권한, 인턴 에이전트는 낮은 권한)
- Slack thread에 승인 이력 요약 자동 포스팅
- `after_tool_call` 훅과 연동하여 실행 결과까지 감사 로그에 기록
