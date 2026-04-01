import WebSocket from "ws";

interface ResolveParams {
  id: string;
  decision: "allow-once" | "allow-always" | "deny";
}

export class GatewayClient {
  private port: number;

  constructor(port: number) {
    this.port = port;
  }

  async resolveApproval(params: ResolveParams): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const url = `ws://127.0.0.1:${this.port}`;
      const ws = new WebSocket(url);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Gateway connection timeout"));
      }, 10_000);

      ws.on("open", () => {
        const payload = {
          jsonrpc: "2.0",
          id: 1,
          method: "plugin.approval.resolve",
          params: {
            id: params.id,
            decision: params.decision,
          },
        };
        ws.send(JSON.stringify(payload));
      });

      ws.on("message", (data) => {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(data.toString());
          ws.close();
          if (response.error) {
            reject(new Error(response.error.message ?? "Gateway error"));
          } else {
            resolve(true);
          }
        } catch {
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
}
