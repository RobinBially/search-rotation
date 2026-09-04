import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { EngineContext } from "../types.js";
import { VERSION } from "../version.js";

export async function withHostedMcp<T>(endpoint: string, ctx: EngineContext, timeoutMs: number, fn: (client: Client, signal: AbortSignal) => Promise<T>): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
  signal.throwIfAborted();
  const client = new Client({ name: "search-rotation", version: VERSION });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    // Der SDK-Request-Abbruch allein beendet keinen hängenden HTTP-Handshake.
    fetch: (input, init) => {
      const inputSignal = input instanceof Request ? input.signal : undefined;
      const signals = [signal, init?.signal, inputSignal].filter((s): s is AbortSignal => Boolean(s));
      return fetch(input, { ...init, signal: AbortSignal.any(signals) });
    },
  });
  try {
    await client.connect(transport, { signal, timeout: timeoutMs });
    return await fn(client, signal);
  } finally {
    await client.close().catch(() => {});
  }
}

