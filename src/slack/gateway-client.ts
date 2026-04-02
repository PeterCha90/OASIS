import WebSocket from "ws";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { sign, createPublicKey } from "crypto";

interface ResolveParams {
  id: string;
  decision: "allow-once" | "allow-always" | "deny";
}
interface DeviceIdentity {
  deviceId: string;
  privateKeyPem: string;
  publicKeyPem: string;
}

function loadDeviceIdentity(): DeviceIdentity | null {
  const p = join(homedir(), ".openclaw", "identity", "device.json");
  if (!existsSync(p)) return null;
  try {
    const d = JSON.parse(readFileSync(p, "utf-8"));
    return { deviceId: d.deviceId, privateKeyPem: d.privateKeyPem, publicKeyPem: d.publicKeyPem };
  } catch { return null; }
}

function signPayload(privateKeyPem: string, payload: string): string {
  const signature = sign(null, Buffer.from(payload), privateKeyPem);
  return signature.toString("base64url");
}

function publicKeyToBase64Url(publicKeyPem: string): string {
  const key = createPublicKey(publicKeyPem);
  const rawKey = key.export({ type: "spki", format: "der" });
  return rawKey.subarray(12).toString("base64url");
}

export async function resolveApprovalOneShot(
  port: number,
  authToken: string | undefined,
  params: ResolveParams
): Promise<boolean> {
  const device = loadDeviceIdentity();
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
      headers: authToken ? { "Authorization": `Bearer ${authToken}`, "X-OpenClaw-Token": authToken } : {},
    });
    const timeout = setTimeout(() => { ws.close(); reject(new Error("Gateway timeout")); }, 10_000);
    let handshakeDone = false;
    let challengeNonce: string | undefined;

    ws.on("open", () => {});

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "event" && msg.event === "connect.challenge") {
          challengeNonce = msg.payload?.nonce;
          const signedAtMs = Date.now();
          const clientId = "cli"; const clientMode = "cli"; const role = "operator";
          const scopes = ["operator.admin", "operator.read", "operator.write", "operator.approvals"];
          const connectParams: any = {
            minProtocol: 3, maxProtocol: 3,
            client: { id: clientId, displayName: "OASIS", version: "2026.3.28", platform: process.platform, mode: clientMode },
            role, scopes,
            auth: authToken ? { token: authToken } : undefined,
          };
          if (device && challengeNonce) {
            const signatureToken = authToken ?? "";
            const payload = ["v3", device.deviceId, clientId, clientMode, role, scopes.join(","), String(signedAtMs), signatureToken, challengeNonce, process.platform, ""].join("|");
            const signature = signPayload(device.privateKeyPem, payload);
            connectParams.device = { id: device.deviceId, publicKey: publicKeyToBase64Url(device.publicKeyPem), signature, signedAt: signedAtMs, nonce: challengeNonce };
            connectParams.auth = { ...connectParams.auth, deviceToken: undefined };
          }
          ws.send(JSON.stringify({ type: "req", id: "1", method: "connect", params: connectParams }));
          return;
        }
        if (msg.type === "res" && msg.id === "1" && !handshakeDone) {
          if (!msg.ok) { clearTimeout(timeout); ws.close(); reject(new Error(`Gateway handshake failed: ${msg.error?.message}`)); return; }
          handshakeDone = true;
          ws.send(JSON.stringify({ type: "req", id: "2", method: "plugin.approval.resolve", params: { id: params.id, decision: params.decision } }));
          return;
        }
        if (msg.type === "res" && msg.id === "2") {
          clearTimeout(timeout); ws.close();
          msg.ok ? resolve(true) : reject(new Error(msg.error?.message ?? "Resolve failed"));
        }
      } catch { clearTimeout(timeout); ws.close(); reject(new Error("Invalid gateway response")); }
    });
    ws.on("error", (err) => { clearTimeout(timeout); reject(err); });
  });
}
