#!/usr/bin/env node
const command = process.argv[2];

if (command === "bridge") {
  import("../dist/bridge/index.js").then((m) => m.startBridge());
} else {
  console.log("Usage: npx @petercha90/oasis bridge");
  console.log("");
  console.log("Commands:");
  console.log("  bridge    Start the OASIS Slack approval bridge");
  process.exit(1);
}
