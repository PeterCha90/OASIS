// src/patterns.ts
import type { DetectionPattern } from "./types.js";

/** Patterns that always block (score 1.0, no approval possible) */
export const BLOCKED_PATTERNS: DetectionPattern[] = [
  {
    id: "BLOCK_DESTRUCTIVE",
    regex:
      /rm\s+-rf\s+[/~]|:\(\)\{\s*:\|:&\s*\};:|mkfs\.|dd\s+if=\/dev\/zero/,
    score: 1.0,
    description: "Destructive command",
    severity: "critical",
  },
  {
    id: "BLOCK_PIPE_SHELL",
    regex: /curl\s+.*\|\s*(bash|sh|zsh)|wget\s+.*\|\s*(bash|sh|zsh)|curl\s+.*\|\s*python/,
    score: 1.0,
    description: "Pipe to shell execution",
    severity: "critical",
  },
];

/** Patterns that trigger risk scoring (score < 1.0) */
export const RISK_PATTERNS: DetectionPattern[] = [
  {
    id: "PROMPT_INJECTION",
    regex:
      /ignore previous instructions|you are now|system prompt:|<\|im_start\|>system/i,
    score: 0.9,
    description: "Prompt injection pattern",
    severity: "critical",
  },
  {
    id: "SECRET_ACCESS",
    regex:
      /\$\{?[A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|ACCESS_?KEY|CREDENTIAL|CRED|PRIVATE_KEY|WEBHOOK|BEARER)[A-Z0-9_]*\}?\b|process\.env\.[A-Z_]*(?:SECRET|PASSWORD|PASSWD|KEY|TOKEN|CREDENTIAL|AUTH|PRIVATE|WEBHOOK|API)[A-Z_]*/i,
    score: 0.8,
    description: "Secret/credential access",
    severity: "warning",
  },
  {
    id: "ENV_DUMP",
    regex:
      /\bprintenv\b|(?:^|[\s;|&])env\s*(?:\||$|>|;)|cat\s+\/proc\/[^\s]*\/environ|\bexport\s+-p\b/i,
    score: 0.6,
    description: "Environment variable dump",
    severity: "warning",
  },
  {
    id: "SUSPICIOUS_DOMAIN",
    regex: /\.(xyz|tk|ml|ga|cf|pw|top|click|loan|work)\b/i,
    score: 0.8,
    description: "Suspicious domain TLD",
    severity: "warning",
  },
  {
    id: "DATA_EXFILTRATION",
    regex:
      /curl\s+-X\s+POST|wget\s+--post-data|nc\s+-e|ncat\s|reverse\s+shell/i,
    score: 0.7,
    description: "Potential data exfiltration",
    severity: "warning",
  },
  {
    id: "SENSITIVE_FILE",
    regex:
      /\.env(\.[a-z0-9]+)*|\.ssh\/|id_rsa|\.aws\/credentials|\/etc\/shadow|\/etc\/passwd|\.pem\b|\.key\b|oasis-allowlist\.json|\/proc\/[^\s/]+\/environ/i,
    score: 0.6,
    description: "Sensitive file access",
    severity: "warning",
  },
  {
    id: "PRIVILEGE_ESCALATION",
    regex: /\bsudo\b|\bsu\s+-|chmod\s+777|chown\s+root|setuid/i,
    score: 0.5,
    description: "Privilege escalation",
    severity: "warning",
  },
  {
    id: "EXTERNAL_URL",
    regex: /https?:\/\/[^\s"']+/i,
    score: 0.3,
    description: "External URL access",
    severity: "info",
  },
];

/** Domains that are considered safe (skip EXTERNAL_URL scoring) */
export const DEFAULT_SAFE_DOMAINS: string[] = [
  "github.com",
  "githubusercontent.com",
  "npmjs.com",
  "pypi.org",
  "registry.npmjs.org",
  "crates.io",
  "api.anthropic.com",
  "api.openai.com",
  "docs.openclaw.ai",
  "stackoverflow.com",
];
