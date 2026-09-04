import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Hono } from "hono";
import { buildMcpServer, type McpDeps } from "./server.js";

/**
 * Mountet den MCP-Endpoint (Streamable HTTP, stateless) unter /mcp.
 * Pro Request wird eine frische Transport-/Server-Instanz erzeugt
 * (dokumentiertes Stateless-Pattern des SDK).
 */
export function mountMcpHttp(app: Hono, deps: McpDeps): void {
  app.all("/mcp", async (c) => {
    const server = buildMcpServer(deps);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
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
