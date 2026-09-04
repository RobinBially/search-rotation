import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Hono } from "hono";
import { buildMcpServer, type McpDeps } from "./server.js";

/**
 * Mountet den MCP-Endpoint (Streamable HTTP, stateless) unter /mcp.
 * Pro Request wird eine frische Transport-/Server-Instanz erzeugt
 * (dokumentiertes Stateless-Pattern des SDK).
 */
export function mountMcpHttp(app: Hono, deps: McpDeps, security?: { allowedHosts: string[]; allowedOrigins: string[] }): void {
  app.all("/mcp", async (c) => {
    // Stateless-Modus: es gibt keinen langlebigen SSE-Kanal. Ein GET mit
    // Accept: text/event-stream würde vom Client als reconnectabler Stream
    // interpretiert → Reconnect-Loop. Deshalb sofort 405.
    if (c.req.method === "GET") {
      return c.text(
        "405 — SSE-Streaming im Stateless-Modus nicht unterstützt; JSON-RPC per POST senden.",
        405,
        { allow: "POST" },
      );
    }
    const server = buildMcpServer({ ...deps, requestSignal: c.req.raw.signal });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: security?.allowedHosts ?? ["127.0.0.1", "localhost"],
      allowedOrigins: security?.allowedOrigins ?? ["http://127.0.0.1", "http://localhost"],
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      setTimeout(() => {
        void transport.close().catch(() => {});
        void server.close().catch(() => {});
      }, 0);
    }
  });
}
