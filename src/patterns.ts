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
      /\$AWS_SECRET|\$API_KEY|\$DB_PASSWORD|process\.env\.(SECRET|PASSWORD|KEY|TOKEN)/i,
    score: 0.8,
    description: "Secret/credential access",
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
      /\.env\b|\.ssh\/|id_rsa|\.aws\/credentials|\/etc\/shadow|\/etc\/passwd|\.pem\b|\.key\b/i,
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

/** Patterns for detecting secrets in outbound message content */
export const SECRET_OUTPUT_PATTERNS: DetectionPattern[] = [
  {
    id: "AWS_KEY",
    regex: /AKIA[0-9A-Z]{16}/,
    score: 1.0,
    description: "AWS Access Key",
    severity: "critical",
  },
  {
    id: "SLACK_TOKEN",
    regex: /xox[bporas]-[0-9a-zA-Z-]+/,
    score: 1.0,
    description: "Slack token",
    severity: "critical",
  },
  {
    id: "PRIVATE_KEY",
    regex: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/,
    score: 1.0,
    description: "Private key",
    severity: "critical",
  },
  {
    id: "GENERIC_SECRET_VALUE",
    regex: /(?:SECRET|PASSWORD|TOKEN|API_KEY|APIKEY|AUTH|CREDENTIAL)[_\s]*[=:]\s*\S{8,}/i,
    score: 1.0,
    description: "Secret value assignment",
    severity: "critical",
  },
  {
    id: "GENERIC_HIGH_ENTROPY",
    regex: /(?:sk|pk|key|token|secret|password)[-_][a-zA-Z0-9]{20,}/i,
    score: 1.0,
    description: "High-entropy secret token",
    severity: "critical",
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
