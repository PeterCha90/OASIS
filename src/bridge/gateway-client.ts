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

    this.ws.on("open", () => {
      console.log(`[OASIS Bridge] Gateway connected (ws://127.0.0.1:${this.port})`);
      // Subscribe to approval events
      this.send({
        jsonrpc: "2.0",
        id: ++this.rpcId,
        method: "subscribe",
        params: { events: ["plugin.approval.requested", "plugin.approval.resolved"] },
      });
    });

    this.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        // Handle broadcast events
        if (msg.method === "event" && msg.params?.event === "plugin.approval.requested") {
          this.onApproval?.(msg.params.data as ApprovalRequest);
        }
        // Also handle direct event format
        if (msg.event === "plugin.approval.requested") {
          this.onApproval?.(msg.data ?? msg);
        }
      } catch {
        // Ignore parse errors for non-JSON messages
      }
    });

    this.ws.on("close", () => {
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
    // Try persistent connection first
    if (this.ws?.readyState === WebSocket.OPEN) {
      return new Promise((resolve, reject) => {
        const id = ++this.rpcId;
        const timeout = setTimeout(() => reject(new Error("Gateway timeout")), 10_000);

        const handler = (data: WebSocket.Data) => {
          try {
            const response = JSON.parse(data.toString());
            if (response.id === id) {
              clearTimeout(timeout);
              this.ws?.off("message", handler);
              if (response.error) {
                reject(new Error(response.error.message ?? "Gateway error"));
              } else {
                resolve(true);
              }
            }
          } catch {}
        };

        this.ws!.on("message", handler);
        this.send({
          jsonrpc: "2.0",
          id,
          method: "plugin.approval.resolve",
          params: { id: params.id, decision: params.decision },
        });
      });
    }

    // Fallback: one-shot connection
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
      const timeout = setTimeout(() => { ws.close(); reject(new Error("Gateway timeout")); }, 10_000);

      ws.on("open", () => {
        ws.send(JSON.stringify({
          jsonrpc: "2.0", id: 1,
          method: "plugin.approval.resolve",
          params: { id: params.id, decision: params.decision },
        }));
      });

      ws.on("message", (data) => {
        clearTimeout(timeout);
        const response = JSON.parse(data.toString());
        ws.close();
        response.error ? reject(new Error(response.error.message)) : resolve(true);
      });

      ws.on("error", (err) => { clearTimeout(timeout); reject(err); });
    });
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
