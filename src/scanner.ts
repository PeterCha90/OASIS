// src/scanner.ts
import type { OasisConfig, ScanResult } from "./types.js";
import {
  BLOCKED_PATTERNS,
  RISK_PATTERNS,
  DEFAULT_SAFE_DOMAINS,
} from "./patterns.js";



const BASE_RISK: Record<string, number> = {
  file_delete: 0.2,
};

/**
 * Extract the text content to scan from tool params.
 * Different tools store their scannable content in different fields.
 */
function extractScanText(
  toolName: string,
  params: Record<string, unknown>
): string {
  const parts: string[] = [];

  // Collect all string values from params
  for (const value of Object.values(params)) {
    if (typeof value === "string") {
      parts.push(value);
    }
  }

  return parts.join(" ");
}

/**
 * Check if a URL belongs to a safe domain.
 */
function containsOnlySafeDomains(
  text: string,
  config: OasisConfig
): boolean {
  const allSafeDomains = [...DEFAULT_SAFE_DOMAINS, ...config.safeDomains];
  const urlRegex = /https?:\/\/([^\s/"']+)/gi;
  let match: RegExpExecArray | null;
  let foundUrl = false;

  while ((match = urlRegex.exec(text)) !== null) {
    foundUrl = true;
    const hostname = match[1].toLowerCase();
    const isSafe = allSafeDomains.some(
      (domain) => hostname === domain || hostname.endsWith("." + domain)
    );
    if (!isSafe) return false;
  }

  return foundUrl;
}

/**
 * Scan a tool call for risks and return a deterministic score.
 */
export function scanForRisks(
  toolName: string,
  params: Record<string, unknown>,
  config: OasisConfig
): ScanResult {
  const text = extractScanText(toolName, params);
  const matchedScores: number[] = [];
  const reasons: string[] = [];
  const matchedPatterns: string[] = [];

  // Check blocked patterns first
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.regex.test(text)) {
      matchedScores.push(pattern.score);
      reasons.push(pattern.description);
      matchedPatterns.push(pattern.id);
    }
  }

  // Check risk patterns
  for (const pattern of RISK_PATTERNS) {
    // Special handling for EXTERNAL_URL: skip if all URLs are safe domains
    if (pattern.id === "EXTERNAL_URL") {
      if (pattern.regex.test(text) && !containsOnlySafeDomains(text, config)) {
        matchedScores.push(pattern.score);
        reasons.push(pattern.description);
        matchedPatterns.push(pattern.id);
      }
      continue;
    }

    if (pattern.regex.test(text)) {
      matchedScores.push(pattern.score);
      reasons.push(pattern.description);
      matchedPatterns.push(pattern.id);
    }
  }

  // Check custom patterns
  for (const cp of config.customPatterns) {
    const regex = new RegExp(cp.regex, "i");
    if (regex.test(text)) {
      matchedScores.push(cp.score);
      reasons.push(cp.description ?? cp.id);
      matchedPatterns.push(cp.id);
    }
  }

  // Apply base risk for certain tools
  const baseRisk = BASE_RISK[toolName] ?? 0;
  if (baseRisk > 0 && matchedScores.length === 0) {
    matchedScores.push(baseRisk);
    reasons.push(`Base risk for ${toolName}`);
    matchedPatterns.push("BASE_RISK");
  }

  // Final score is max of all matched scores
  const score = matchedScores.length > 0 ? Math.max(...matchedScores) : 0;

  // Determine severity
  let severity: ScanResult["severity"] = "none";
  if (score >= 0.9) severity = "critical";
  else if (score >= 0.5) severity = "warning";
  else if (score > 0) severity = "info";

  return { score, reasons, matchedPatterns, severity };
}
