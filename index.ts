// OASIS — OpenClaw Antidote for Suspicious Injection Signals
// Prompt injection defense plugin with read/execute classification and risk scoring

interface OasisConfig {
  readTools?: string[];
  executeTools?: string[];
  blockedPatterns?: string[];
  suspiciousDomains?: string[];
  riskThreshold?: number;
  timeoutMs?: number;
  timeoutBehavior?: "allow" | "deny";
  llmValidation?: boolean;
}

interface RiskAssessment {
  score: number;
  severity: "info" | "warning" | "critical";
  reasons: string[];
  matchedPatterns: string[];
}

// ─── Default Configuration ───────────────────────────────────────────

const DEFAULT_READ_TOOLS = [
  "read", "glob", "grep",
  "web_search", "ollama_web_search",
];

const DEFAULT_EXECUTE_TOOLS = [
  "exec", "bash",
  "write", "edit", "apply_patch",
  "web_fetch", "ollama_web_fetch",
  "file_delete",
];

const DEFAULT_BLOCKED_PATTERNS = [
  "rm\\s+(-rf|--recursive)\\s+[/~]",
  "mkfs\\b",
  "dd\\s+if=",
  ":(){\\s*:|\\s*:&\\s*};",
  "chmod\\s+777\\s+[/~]",
  "curl.*\\|\\s*(bash|sh|zsh)",
  "wget.*\\|\\s*(bash|sh|zsh)",
];

const DEFAULT_SUSPICIOUS_DOMAINS = [
  "*.tk", "*.ml", "*.ga", "*.cf", "*.gq",
  "*.xyz", "*.top", "*.buzz",
];

// ─── Risk Assessment Engine ──────────────────────────────────────────

function extractCommand(params: Record<string, unknown>): string {
  return (
    (params.command as string) ||
    (params.content as string) ||
    (params.code as string) ||
    (params.script as string) ||
    ""
  );
}

function extractUrl(params: Record<string, unknown>): string {
  return (params.url as string) || "";
}

function matchesDomainPattern(url: string, patterns: string[]): string[] {
  const matched: string[] = [];
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    for (const pattern of patterns) {
      const regex = new RegExp(
        "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$",
      );
      if (regex.test(hostname)) {
        matched.push(pattern);
      }
    }
  } catch {
    // invalid URL — not a domain match concern
  }
  return matched;
}

function assessRisk(
  toolName: string,
  params: Record<string, unknown>,
  blockedPatterns: string[],
  suspiciousDomains: string[],
  riskThreshold: number,
): RiskAssessment {
  const reasons: string[] = [];
  const matchedPatterns: string[] = [];
  let score = 0;

  const command = extractCommand(params);
  const url = extractUrl(params);
  const allText = JSON.stringify(params).toLowerCase();

  // ── Check blocked patterns (hard block — score goes to 1.0) ──
  for (const pattern of blockedPatterns) {
    try {
      if (new RegExp(pattern, "i").test(command)) {
        matchedPatterns.push(pattern);
        reasons.push(`차단 패턴 매치: ${pattern}`);
        score = 1.0;
      }
    } catch {
      // invalid regex — skip
    }
  }

  // ── URL risk factors ──
  if (url) {
    const domainMatches = matchesDomainPattern(url, suspiciousDomains);
    if (domainMatches.length > 0) {
      matchedPatterns.push(...domainMatches);
      reasons.push(`의심 도메인: ${domainMatches.join(", ")}`);
      score = Math.max(score, 0.8);
    }

    // pipe to shell pattern in URL context
    if (/\|\s*(bash|sh|zsh)/.test(url) || /\|\s*(bash|sh|zsh)/.test(command)) {
      reasons.push("외부 스크립트를 셸에 파이프 실행 시도");
      score = Math.max(score, 0.95);
    }
  }

  // ── Command risk factors ──
  if (command) {
    // Accessing sensitive files
    if (/\.(env|pem|key|credentials|secret)/.test(command)) {
      reasons.push("민감 파일 접근 시도 (.env, .pem 등)");
      score = Math.max(score, 0.6);
    }

    // Outbound data transfer
    if (/curl\s.*(-d|--data|--upload)/.test(command)) {
      reasons.push("외부로 데이터 전송 시도 (curl POST/upload)");
      score = Math.max(score, 0.7);
    }

    // Base64 encode/decode (common obfuscation)
    if (/base64\s+(-d|--decode|encode)/.test(command)) {
      reasons.push("Base64 인코딩/디코딩 (난독화 가능성)");
      score = Math.max(score, 0.4);
    }

    // Network tools
    if (/\b(nc|netcat|ncat|socat)\b/.test(command)) {
      reasons.push("네트워크 도구 사용 (nc/netcat)");
      score = Math.max(score, 0.7);
    }

    // Privilege escalation
    if (/\b(sudo|su\s|chmod\s+[47]|chown)\b/.test(command)) {
      reasons.push("권한 상승 시도 (sudo/chmod)");
      score = Math.max(score, 0.5);
    }

    // Environment variable exfiltration
    if (/\$\{?[A-Z_]*(TOKEN|SECRET|KEY|PASSWORD|PASS)\b/.test(command)) {
      reasons.push("환경변수에서 비밀값 참조 시도");
      score = Math.max(score, 0.8);
    }
  }

  // ── Injection pattern detection in all params ──
  if (
    allText.includes("ignore previous") ||
    allText.includes("ignore all") ||
    allText.includes("disregard") ||
    allText.includes("system prompt") ||
    allText.includes("이전 지시를 무시") ||
    allText.includes("시스템 프롬프트")
  ) {
    reasons.push("프롬프트 인젝션 패턴 감지");
    score = Math.max(score, 0.9);
  }

  // ── web_fetch specific: any URL is moderate risk ──
  if (
    (toolName === "web_fetch" || toolName === "ollama_web_fetch") &&
    url &&
    score < 0.3
  ) {
    reasons.push("외부 URL 접근 (데이터 유출 경로 가능)");
    score = Math.max(score, 0.3);
  }

  // ── Determine severity ──
  let severity: "info" | "warning" | "critical";
  if (score >= riskThreshold) {
    severity = "critical";
  } else if (score >= 0.3) {
    severity = "warning";
  } else {
    severity = "info";
  }

  // ── Default reason if none found ──
  if (reasons.length === 0) {
    reasons.push("실행 도구 호출 — 기본 승인 필요");
  }

  return { score, severity, reasons, matchedPatterns };
}

// ─── Format Slack Approval Message ───────────────────────────────────

function formatApprovalMessage(
  toolName: string,
  params: Record<string, unknown>,
  risk: RiskAssessment,
): { title: string; description: string } {
  const riskEmoji =
    risk.severity === "critical" ? "🚨" :
    risk.severity === "warning" ? "⚠️" : "ℹ️";

  const riskLabel =
    risk.severity === "critical" ? "높음" :
    risk.severity === "warning" ? "보통" : "낮음";

  const paramsStr = JSON.stringify(params, null, 2);
  const truncated = paramsStr.length > 500
    ? paramsStr.slice(0, 500) + "\n..."
    : paramsStr;

  const title = `${riskEmoji} OASIS: ${toolName} 실행 승인 요청`;

  const description = [
    `📋 실행할 도구: ${toolName}`,
    ``,
    `📎 파라미터:`,
    "```",
    truncated,
    "```",
    ``,
    `${riskEmoji} Injection 위험도: ${riskLabel} (${risk.score.toFixed(1)})`,
    ...risk.reasons.map((r) => `  • ${r}`),
    ...(risk.matchedPatterns.length > 0
      ? [``, `🔍 매칭된 패턴:`, ...risk.matchedPatterns.map((p) => `  • ${p}`)]
      : []),
  ].join("\n");

  return { title, description };
}

// ─── Plugin Entry ────────────────────────────────────────────────────

const oasisPlugin = {
  id: "oasis",
  name: "OASIS — Prompt Injection Defense",
  description:
    "OpenClaw Antidote for Suspicious Injection Signals. " +
    "Read tools run freely, execute tools require Slack approval with risk scoring.",

  register(api: any) {
    const config: OasisConfig = api.pluginConfig ?? {};

    const readTools = config.readTools ?? DEFAULT_READ_TOOLS;
    const executeTools = config.executeTools ?? DEFAULT_EXECUTE_TOOLS;
    const blockedPatterns = config.blockedPatterns ?? DEFAULT_BLOCKED_PATTERNS;
    const suspiciousDomains = config.suspiciousDomains ?? DEFAULT_SUSPICIOUS_DOMAINS;
    const riskThreshold = config.riskThreshold ?? 0.7;
    const timeoutMs = config.timeoutMs ?? 120_000;
    const timeoutBehavior = config.timeoutBehavior ?? "deny";

    api.on(
      "before_tool_call",
      async (event: any, _ctx: any) => {
        const { toolName, toolCallId, params } = event;

        // ── 1. Read tools: always allow ──
        if (readTools.includes(toolName)) {
          return undefined;
        }

        // ── 2. Unknown tools (not in either list): allow by default ──
        if (!executeTools.includes(toolName)) {
          return undefined;
        }

        // ── 3. Execute tools: assess risk ──
        const risk = assessRisk(
          toolName,
          params ?? {},
          blockedPatterns,
          suspiciousDomains,
          riskThreshold,
        );

        api.logger.info(
          `[oasis] ${toolName} (${toolCallId}) — risk: ${risk.score.toFixed(2)} (${risk.severity})`,
        );

        // ── 4. Hard block: matched blocked patterns ──
        if (risk.matchedPatterns.length > 0 && risk.score >= 1.0) {
          api.logger.warn(
            `[oasis] BLOCKED ${toolName}: ${risk.reasons.join(", ")}`,
          );
          return {
            block: true,
            blockReason:
              `🚨 OASIS: 차단됨 — ${risk.reasons.join("; ")}`,
          };
        }

        // ── 5. Require approval ──
        const { title, description } = formatApprovalMessage(
          toolName,
          params ?? {},
          risk,
        );

        return {
          requireApproval: {
            title,
            description,
            severity: risk.severity,
            timeoutMs,
            timeoutBehavior,
            onResolution: async (decision: string) => {
              api.logger.info(
                `[oasis] ${toolName} (${toolCallId}): ${decision} — risk was ${risk.score.toFixed(2)}`,
              );
            },
          },
        };
      },
      { name: "oasis-security-gate" },
    );

    api.logger.info(
      `[oasis] Security gate registered — ${readTools.length} read tools, ${executeTools.length} execute tools, ${blockedPatterns.length} blocked patterns`,
    );
  },
};

export default oasisPlugin;
