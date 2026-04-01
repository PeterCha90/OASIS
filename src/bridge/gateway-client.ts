import WebSocket from "ws";

interface ResolveParams {
  id: string;
  decision: "allow-once" | "allow-always" | "deny";
}

interface ApprovalRequest {
  id: string;
  request: {
    pluginId: string | null;
    title: string;
    description: string;
    severity: string | null;
    toolName: string | null;
    agentId: string | null;
    sessionKey: string | null;
    turnSourceChannel: string | null;
    turnSourceTo: string | null;
    turnSourceAccountId: string | null;
    turnSourceThreadId: string | number | null;
  };
  createdAtMs: number;
  expiresAtMs: number;
}

export type ApprovalEventHandler = (approval: ApprovalRequest) => void;

export class GatewayClient {
  private port: number;
  private ws: WebSocket | null = null;
  private onApproval: ApprovalEventHandler | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private rpcId = 0;

  constructor(port: number) {
    this.port = port;
  }

  onApprovalRequested(handler: ApprovalEventHandler) {
    this.onApproval = handler;
  }

  connect() {
    const url = `ws://127.0.0.1:${this.port}`;
    this.ws = new WebSocket(url);
    let handshakeComplete = false;

    this.ws.on("open", () => {
      // Gateway requires a "connect" handshake as the first frame
      this.send({
        type: "req",
        id: String(++this.rpcId),
        method: "connect",
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: "oasis-bridge",
            displayName: "OASIS Bridge",
            version: "1.1.0",
            platform: process.platform,
            mode: "operator",
          },
          role: "operator",
          scopes: ["approvals", "read"],
        },
      });
    });

    this.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // Handle connect response
        if (msg.type === "res" && !handshakeComplete) {
          if (msg.ok) {
            handshakeComplete = true;
            console.log(`[OASIS Bridge] Gateway connected`);
          } else {
            console.error(`[OASIS Bridge] Gateway handshake failed: ${msg.error?.message ?? "unknown"}`);
          }
          return;
        }

        // Handle approval events
        if (msg.type === "event" && msg.event === "plugin.approval.requested") {
          this.onApproval?.(msg.payload as ApprovalRequest);
        }
      } catch {
        // Ignore parse errors
      }
    });

    this.ws.on("close", () => {
      handshakeComplete = false;
      this.scheduleReconnect();
    });

    this.ws.on("error", () => {
      this.ws?.close();
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log("[OASIS Bridge] Reconnecting to Gateway...");
      this.connect();
    }, 5000);
  }

  private send(payload: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  async resolveApproval(params: ResolveParams): Promise<boolean> {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error("Gateway not connected");
    }

    return new Promise((resolve, reject) => {
      const id = String(++this.rpcId);
      const timeout = setTimeout(() => reject(new Error("Gateway timeout")), 10_000);

      const handler = (data: WebSocket.Data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.type === "res" && response.id === id) {
            clearTimeout(timeout);
            this.ws?.off("message", handler);
            if (response.ok) {
              resolve(true);
            } else {
              reject(new Error(response.error?.message ?? "Gateway error"));
            }
          }
        } catch {}
      };

      this.ws!.on("message", handler);
      this.send({
        type: "req",
        id,
        method: "plugin.approval.resolve",
        params: { id: params.id, decision: params.decision },
      });
    });
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
