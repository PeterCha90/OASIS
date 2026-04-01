import WebSocket from "ws";

interface ResolveParams {
  id: string;
  decision: "allow-once" | "allow-always" | "deny";
}

/**
 * One-shot Gateway WebSocket call to resolve an approval.
 * Connects, sends connect handshake + resolve request, gets response, disconnects.
 * Does NOT maintain a persistent connection (avoids stealing approval routing).
 */
export async function resolveApprovalOneShot(
  port: number,
  authToken: string | undefined,
  params: ResolveParams
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Gateway timeout"));
    }, 10_000);

    let handshakeDone = false;

    ws.on("open", () => {
      // Send connect handshake first
      ws.send(JSON.stringify({
        type: "req",
        id: "1",
        method: "connect",
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: "gateway-client",
            displayName: "OASIS Bridge",
            version: "1.1.0",
            platform: process.platform,
            mode: "backend",
          },
          role: "operator",
          scopes: ["operator.approvals"],
          auth: authToken ? { token: authToken } : undefined,
        },
      }));
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // Skip challenge events
        if (msg.type === "event") return;

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
