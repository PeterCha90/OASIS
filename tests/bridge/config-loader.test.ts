import { describe, test, expect } from "vitest";
import { parseSlackAccounts, loadEnvTokens, parseGatewayPort } from "../../src/bridge/config-loader.js";

describe("Config Loader", () => {
  test("should parse Slack accounts from OpenClaw config", () => {
    const config = {
      channels: {
        slack: {
          accounts: {
            "ceo-bot": {
              botToken: { source: "env", id: "CEO_BOT_TOKEN" },
              appToken: { source: "env", id: "CEO_APP_TOKEN" },
            },
            "cto-bot": {
              botToken: { source: "env", id: "CTO_BOT_TOKEN" },
              appToken: { source: "env", id: "CTO_APP_TOKEN" },
            },
          },
        },
      },
    };
    const accounts = parseSlackAccounts(config);
    expect(accounts).toHaveLength(2);
    expect(accounts[0].id).toBe("ceo-bot");
    expect(accounts[0].botTokenEnvKey).toBe("CEO_BOT_TOKEN");
    expect(accounts[0].appTokenEnvKey).toBe("CEO_APP_TOKEN");
  });

  test("should return empty array if no Slack config", () => {
    const accounts = parseSlackAccounts({});
    expect(accounts).toEqual([]);
  });

  test("should load env tokens from dotenv content", () => {
    const envContent = "CEO_BOT_TOKEN=xoxb-test-123\nCEO_APP_TOKEN=xapp-test-456\n";
    const tokens = loadEnvTokens(envContent);
    expect(tokens["CEO_BOT_TOKEN"]).toBe("xoxb-test-123");
    expect(tokens["CEO_APP_TOKEN"]).toBe("xapp-test-456");
  });

  test("should skip comments and empty lines", () => {
    const envContent = "# comment\n\nKEY=value\n";
    const tokens = loadEnvTokens(envContent);
    expect(tokens["KEY"]).toBe("value");
    expect(Object.keys(tokens)).toHaveLength(1);
  });

  test("should parse gateway port from config", () => {
    expect(parseGatewayPort({ gateway: { port: 18789 } })).toBe(18789);
  });

  test("should default gateway port to 18789", () => {
    expect(parseGatewayPort({})).toBe(18789);
  });
});
