import WebSocket from "ws";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createSign } from "crypto";

interface ResolveParams {
  id: string;
  decision: "allow-once" | "allow-always" | "deny";
}

interface DeviceIdentity {
  deviceId: string;
  privateKeyPem: string;
}

function loadDeviceIdentity(): DeviceIdentity | null {
  const identityPath = join(homedir(), ".openclaw", "identity", "device.json");
  if (!existsSync(identityPath)) return null;
  try {
    const data = JSON.parse(readFileSync(identityPath, "utf-8"));
    return { deviceId: data.deviceId, privateKeyPem: data.privateKeyPem };
  } catch {
    return null;
  }
}

function signPayload(privateKeyPem: string, payload: string): string {
  const sign = createSign("Ed25519");
  sign.update(payload);
  return sign.sign(privateKeyPem, "base64url");
}

/**
 * One-shot Gateway WebSocket call to resolve an approval.
 * Uses device identity + crypto signing like the OpenClaw CLI does.
 */
export async function resolveApprovalOneShot(
  port: number,
  authToken: string | undefined,
  params: ResolveParams
): Promise<boolean> {
  const device = loadDeviceIdentity();
  const deviceAuthPath = join(homedir(), ".openclaw", "identity", "device-auth.json");
  let deviceTokenStr: string | undefined;
  if (existsSync(deviceAuthPath)) {
    try {
      const auth = JSON.parse(readFileSync(deviceAuthPath, "utf-8"));
      deviceTokenStr = auth.tokens?.operator?.token;
    } catch {}
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
      headers: authToken
        ? { "Authorization": `Bearer ${authToken}`, "X-OpenClaw-Token": authToken }
        : {},
    });
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Gateway timeout"));
    }, 10_000);

    let handshakeDone = false;
    let challengeNonce: string | undefined;

    ws.on("open", () => {
      // Wait for challenge nonce before sending connect
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // Handle challenge — extract nonce for device auth
        if (msg.type === "event" && msg.event === "connect.challenge") {
          challengeNonce = msg.payload?.nonce;

          // Build connect with device identity
          const signedAtMs = Date.now();
          const clientId = "cli";
          const clientMode = "cli";
          const role = "operator";
          const scopes = ["operator.admin", "operator.read", "operator.write", "operator.approvals"];

          const connectParams: any = {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: clientId,
              displayName: "OASIS Bridge",
              version: "2026.3.28",
              platform: process.platform,
              mode: clientMode,
            },
            role,
            scopes,
            auth: authToken ? { token: authToken } : undefined,
          };

          // Add device identity if available
          if (device && challengeNonce) {
            const payload = [
              "v3",
              device.deviceId,
              clientId,
              clientMode,
              role,
              scopes.join(","),
              String(signedAtMs),
              deviceTokenStr ?? "",
              challengeNonce,
              process.platform,
              "",
            ].join("|");

            const signature = signPayload(device.privateKeyPem, payload);

            connectParams.device = {
              id: device.deviceId,
              auth: {
                version: 3,
                signedAtMs,
                signature,
                token: deviceTokenStr,
                nonce: challengeNonce,
              },
            };
          }

          ws.send(JSON.stringify({
            type: "req",
            id: "1",
            method: "connect",
            params: connectParams,
          }));
          return;
        }

        // Handle connect response
        if (msg.type === "res" && msg.id === "1" && !handshakeDone) {
          if (!msg.ok) {
            clearTimeout(timeout);
            ws.close();
            reject(new Error(`Gateway handshake failed: ${msg.error?.message}`));
            return;
          }
          handshakeDone = true;
          // Now send the resolve request
          ws.send(JSON.stringify({
            type: "req",
            id: "2",
            method: "plugin.approval.resolve",
            params: { id: params.id, decision: params.decision },
          }));
          return;
        }

        // Handle resolve response
        if (msg.type === "res" && msg.id === "2") {
          clearTimeout(timeout);
          ws.close();
          if (msg.ok) {
            resolve(true);
          } else {
            reject(new Error(msg.error?.message ?? "Resolve failed"));
          }
        }
      } catch {
        clearTimeout(timeout);
        ws.close();
        reject(new Error("Invalid gateway response"));
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
