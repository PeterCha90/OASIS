// src/cli/setup-wizard.ts
import { scanForRisks } from "../scanner.js";
import type { OasisConfig } from "../types.js";

interface CliApi {
  registerCli?: (fn: (program: unknown) => void) => void;
}

interface CliProgram {
  command(name: string): CliCommand;
}

interface CliCommand {
  description(desc: string): CliCommand;
  argument(name: string, desc: string): CliCommand;
  action(fn: (...args: unknown[]) => Promise<void>): CliCommand;
  command(name: string): CliCommand;
}

export function registerOasisCli(api: CliApi, config: OasisConfig): void {
  if (!api.registerCli) return;

  api.registerCli((prog) => {
    const program = prog as CliProgram;
    const oasis = program.command("oasis").description("OASIS security plugin");

    oasis
      .command("test")
      .argument("<command>", "Command to test risk score")
      .description("Test risk score for a command without executing")
      .action(async (command: unknown) => {
        const result = scanForRisks(
          "exec",
          { command: command as string },
          config
        );

        if (result.score >= 1.0) {
          console.log(
            `🚨 BLOCKED (${result.score}) — ${result.reasons.join(", ")}`
          );
        } else if (result.score > config.threshold) {
          console.log(
            `⚠️  APPROVAL REQUIRED (${result.score}) — ${result.reasons.join(", ")}`
          );
        } else {
          console.log(
            `✅ AUTO-ALLOW (${result.score})${result.reasons.length > 0 ? ` — ${result.reasons.join(", ")}` : ""}`
          );
        }
      });

    oasis
      .command("status")
      .description("Show current OASIS configuration")
      .action(async () => {
        console.log("🏝️ OASIS Configuration");
        console.log("═".repeat(30));
        console.log(`  Threshold:  ${config.threshold}`);
        console.log(`  Timeout:    ${config.approvalTimeoutMs / 1000}s`);
        console.log(`  Log Level:  ${config.logLevel}`);
        console.log(`  Read Tools: ${config.readTools.join(", ")}`);
        console.log(
          `  Exec Tools: ${config.executeTools.join(", ")}`
        );
        if (config.safeDomains.length > 0) {
          console.log(
            `  Safe Domains: ${config.safeDomains.join(", ")}`
          );
        }
      });
  });
}
