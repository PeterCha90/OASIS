// tests/secret-ref.test.ts
import { describe, test, expect } from "vitest";
import { normalizeEnvKey, resolveSecretRef } from "../src/index.js";

// openclaw >=2026.5 writes plugin secret-ref ids wrapped in its ${VAR}
// interpolation syntax (e.g. "${OASIS_BOT_TOKEN}"). resolveSecretRef builds a
// `^KEY=...` matcher against ~/.openclaw/.env, where the key is BARE
// ("OASIS_BOT_TOKEN="). Without stripping the wrapper the regex `$` becomes an
// end-anchor mid-pattern and never matches, so the token resolves to undefined
// and the OASIS Slack app silently never starts.
describe("normalizeEnvKey", () => {
  test("strips ${...} interpolation wrapper", () => {
    expect(normalizeEnvKey("${OASIS_BOT_TOKEN}")).toBe("OASIS_BOT_TOKEN");
    expect(normalizeEnvKey("${OASIS_APP_TOKEN}")).toBe("OASIS_APP_TOKEN");
    expect(normalizeEnvKey("${GATEWAY_TOKEN}")).toBe("GATEWAY_TOKEN");
  });

  test("leaves a bare key unchanged", () => {
    expect(normalizeEnvKey("OASIS_BOT_TOKEN")).toBe("OASIS_BOT_TOKEN");
  });

  test("trims surrounding whitespace", () => {
    expect(normalizeEnvKey("  OASIS_BOT_TOKEN  ")).toBe("OASIS_BOT_TOKEN");
  });

  test("a wrapped key, once normalized, matches a bare .env line", () => {
    const key = normalizeEnvKey("${OASIS_BOT_TOKEN}");
    const envFile = "OASIS_BOT_TOKEN=xoxb-123-456\nOASIS_APP_TOKEN=xapp-789\n";
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = envFile.match(new RegExp(`^${esc}=(.+)$`, "m"));
    expect(match?.[1]).toBe("xoxb-123-456");
  });

  test("the OLD un-normalized wrapped id never matched (regression guard)", () => {
    const wrapped = "${OASIS_BOT_TOKEN}";
    const envFile = "OASIS_BOT_TOKEN=xoxb-123-456\n";
    // The pre-fix code did: new RegExp(`^${ref.id}=(.+)$`) with ref.id wrapped.
    const brokenMatch = envFile.match(new RegExp(`^${wrapped}=(.+)$`, "m"));
    expect(brokenMatch).toBeNull();
  });
});

// openclaw >=2026.5 interpolates ${VAR} placeholders inside plugin config
// BEFORE the plugin sees them, so a SecretRef id arrives ALREADY resolved to
// the secret value (e.g. {source:"env", id:"xoxb-..."}). resolveSecretRef must
// use that value directly instead of treating it as an env-var name to look up.
describe("resolveSecretRef", () => {
  test("passes a plain string token through", () => {
    expect(resolveSecretRef("xoxb-plain-token")).toBe("xoxb-plain-token");
  });

  test("uses an already-resolved Slack token in the id (openclaw 2026.5 path)", () => {
    // Not an UPPER_SNAKE env-var name and not present as a key -> it's the value.
    expect(resolveSecretRef({ source: "env", id: "xoxb-106-real-token-value" }))
      .toBe("xoxb-106-real-token-value");
    expect(resolveSecretRef({ source: "env", id: "xapp-1-A-real-app-token" }))
      .toBe("xapp-1-A-real-app-token");
  });

  test("strips a ${} wrapper around an already-resolved value", () => {
    expect(resolveSecretRef({ source: "env", id: "${xoxb-wrapped-value}" }))
      .toBe("xoxb-wrapped-value");
  });

  test("returns undefined for a genuinely missing UPPER_SNAKE env-var name", () => {
    // Looks like an env-var name, not found in .env or process.env -> unresolved
    // (must NOT echo the variable name back as if it were the token).
    expect(resolveSecretRef({ source: "env", id: "OASIS_DEFINITELY_MISSING_VAR_XYZ" }))
      .toBeUndefined();
  });

  test("returns undefined for empty / nullish refs", () => {
    expect(resolveSecretRef(undefined)).toBeUndefined();
    expect(resolveSecretRef("")).toBeUndefined();
    expect(resolveSecretRef({ source: "env", id: "" })).toBeUndefined();
  });
});
