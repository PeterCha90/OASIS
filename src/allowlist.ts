/**
 * Persistent allowlist for "Allow Always" decisions.
 * Stored at ~/.openclaw/oasis-allowlist.json.
 * Users can manage entries via Slack DM to the OASIS bot.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const ALLOWLIST_PATH = join(homedir(), ".openclaw", "oasis-allowlist.json");

interface AllowlistEntry {
  key: string;         // e.g. "exec::curl https://webhook.site/xxx"
  addedBy: string;     // Slack user ID
  addedAt: string;     // ISO timestamp
  label: string;       // human-readable label for Slack UI
}

let entries: AllowlistEntry[] = [];
let loaded = false;

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(ALLOWLIST_PATH)) {
      entries = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf-8"));
    }
  } catch {
    entries = [];
  }
}

function persist() {
  try {
    const dir = join(homedir(), ".openclaw");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(ALLOWLIST_PATH, JSON.stringify(entries, null, 2));
  } catch (err) {
    console.error(`[OASIS] Failed to save allowlist: ${err}`);
  }
}

// ── Key generation ──

export function makeKey(toolName: string, params: Record<string, unknown>): string {
  const command = params.command ?? params.cmd;
  if (command) return `${toolName}::${String(command).trim()}`;

  const filePath = params.file_path ?? params.path ?? params.file;
  if (filePath) return `${toolName}::${String(filePath).trim()}`;

  const url = params.url ?? params.uri;
  if (url) return `${toolName}::${String(url).trim()}`;

  return `${toolName}::${JSON.stringify(params)}`;
}

export function makeKeyFromParsed(toolName: string, parametersStr: string): string {
  if (!parametersStr) return `${toolName}::`;
  try {
    const params = JSON.parse(parametersStr);
    return makeKey(toolName, params);
  } catch {
    return `${toolName}::${parametersStr.trim()}`;
  }
}

function keyToLabel(key: string): string {
  const [tool, ...rest] = key.split("::");
  const param = rest.join("::");
  if (param.length > 60) return `${tool} — ${param.slice(0, 57)}…`;
  return `${tool} — ${param}`;
}

// ── Public API ──

export function isAllowed(toolName: string, params: Record<string, unknown>): boolean {
  ensureLoaded();
  const key = makeKey(toolName, params);
  return entries.some(e => e.key === key);
}

export function allowAlways(key: string, userId?: string): void {
  ensureLoaded();
  if (entries.some(e => e.key === key)) return; // already exists
  entries.push({
    key,
    addedBy: userId ?? "unknown",
    addedAt: new Date().toISOString(),
    label: keyToLabel(key),
  });
  persist();
  console.log(`[OASIS] Allow-always added: ${key.slice(0, 80)}`);
}

export function removeEntry(index: number): AllowlistEntry | null {
  ensureLoaded();
  if (index < 0 || index >= entries.length) return null;
  const [removed] = entries.splice(index, 1);
  persist();
  console.log(`[OASIS] Allow-always removed: ${removed.key.slice(0, 80)}`);
  return removed;
}

export function removeByKey(key: string): boolean {
  ensureLoaded();
  const idx = entries.findIndex(e => e.key === key);
  if (idx === -1) return false;
  entries.splice(idx, 1);
  persist();
  return true;
}

export function getEntries(): readonly AllowlistEntry[] {
  ensureLoaded();
  return entries;
}

export function clearAll(): number {
  ensureLoaded();
  const count = entries.length;
  entries = [];
  persist();
  return count;
}
