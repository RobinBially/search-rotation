import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { bearer, cap, HttpError, httpJson, httpText, USER_AGENT } from "../src/engines/base.js";
import { parseDdgHtml } from "../src/engines/duckduckgo.js";

// ---------------------------------------------------------------------------
// Lokaler Mock-Server (node:http, ephemeral Port via listen(0))
// ---------------------------------------------------------------------------

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

function startServer(handler: Handler): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function urlOf(server: http.Server, path = "/"): string {
  const addr = server.address() as AddressInfo;
  return `http://127.0.0.1:${addr.port}${path}`;
}

/** Schließt den Server und wirft offene Keep-Alive-Verbindungen (undici-Pool) weg. */
async function closeServer(server: http.Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

// ---------------------------------------------------------------------------
// httpJson
// ---------------------------------------------------------------------------

test("httpJson: parst JSON, setzt accept/user-agent und leitet init weiter", async (t) => {
  let seen: { method?: string; accept?: string; ua?: string; body?: string } = {};
  const server = await startServer(async (req, res) => {
    seen = {
      method: req.method,
      accept: req.headers.accept,
      ua: req.headers["user-agent"],
      body: await readBody(req),
    };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, answer: "42" }));
  });
  t.after(() => closeServer(server));

  const j = await httpJson<{ ok: boolean; answer: string }>(urlOf(server), {
    method: "POST",
    body: JSON.stringify({ query: "mcp" }),
  });

  assert.deepEqual(j, { ok: true, answer: "42" });
  assert.equal(seen.method, "POST");
  assert.equal(seen.accept, "application/json");
  assert.equal(seen.ua, USER_AGENT);
  assert.equal(seen.body, JSON.stringify({ query: "mcp" }));
});

test("httpJson: Non-JSON-Body → Fehler mit Host-Angabe, kein HttpError", async (t) => {
  const server = await startServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end("<html>Wartungsseite</html>");
  });
  t.after(() => closeServer(server));

  await assert.rejects(
    () => httpJson(urlOf(server)),
    (err: unknown) =>
      err instanceof Error &&
      !(err instanceof HttpError) &&
      /kein JSON/.test(err.message) &&
      err.message.includes("127.0.0.1"),
  );
});

test("httpJson: HTTP 429/500 → HttpError mit Status, Body und URL", async (t) => {
  const server = await startServer((req, res) => {
    if (req.url === "/429") {
      res.writeHead(429, { "content-type": "text/plain" });
      res.end("rate limited");
      return;
    }
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("kaputt");
  });
  t.after(() => closeServer(server));

  await assert.rejects(
    () => httpJson(urlOf(server, "/429")),
    (err: unknown) => {
      assert.ok(err instanceof HttpError, "erwartet HttpError");
      assert.equal((err as HttpError).status, 429);
      assert.equal((err as HttpError).body, "rate limited");
      assert.equal((err as HttpError).url, urlOf(server, "/429"));
      assert.match(err.message, /HTTP 429 von 127\.0\.0\.1/);
      return true;
    },
  );

  await assert.rejects(
    () => httpText(urlOf(server, "/boom")),
    (err: unknown) => err instanceof HttpError && (err as HttpError).status === 500,
  );
});

// ---------------------------------------------------------------------------
// httpText
// ---------------------------------------------------------------------------

test("httpText: liefert Textkörper; Fehler-Body landet im HttpError", async (t) => {
  const server = await startServer((req, res) => {
    if (req.url === "/err") {
      res.writeHead(503, { "content-type": "text/plain" });
      res.end("Detail: Dienst gerade überlastet");
      return;
    }
    res.setHeader("content-type", "text/plain");
    res.end("Hallo Markdown-Welt");
  });
  t.after(() => closeServer(server));

  assert.equal(await httpText(urlOf(server)), "Hallo Markdown-Welt");

  await assert.rejects(
    () => httpText(urlOf(server, "/err")),
    (err: unknown) =>
      err instanceof HttpError &&
      (err as HttpError).status === 503 &&
      (err as HttpError).body.includes("überlastet"),
  );
});

test("httpText: Timeout via opts.timeoutMs (Server antwortet erst nach 200 ms)", async (t) => {
  const server = await startServer((req, res) => {
    res.on("error", () => {});
    setTimeout(() => {
      try {
        res.end("zu spät");
      } catch {
        /* Socket evtl. schon vom Client weg */
      }
    }, 200);
  });
  t.after(() => closeServer(server));

  const started = Date.now();
  await assert.rejects(
    () => httpText(urlOf(server), {}, { timeoutMs: 50 }),
    (err: unknown) => err instanceof Error && err.name === "TimeoutError",
  );
  assert.ok(Date.now() - started < 150, "Timeout muss vor der Server-Antwort (200 ms) zuschlagen");
});

test("httpText: externer AbortSignal-Abbruch → AbortError", async (t) => {
  const server = await startServer((req, res) => {
    res.on("error", () => {});
    setTimeout(() => {
      try {
        res.end("zu spät");
      } catch {
        /* egal */
      }
    }, 300);
  });
  t.after(() => closeServer(server));

  const ac = new AbortController();
  const pending = httpText(urlOf(server), {}, { signal: ac.signal });
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(pending, (err: unknown) => err instanceof Error && err.name === "AbortError");
});

// ---------------------------------------------------------------------------
// bearer / cap
// ---------------------------------------------------------------------------

test("bearer: mit Key Bearer-Header, ohne Key leeres Objekt", () => {
  assert.deepEqual(bearer("sk-test-123"), { authorization: "Bearer sk-test-123" });
  assert.deepEqual(bearer(), {});
  assert.deepEqual(bearer(""), {});
});

test("cap: Clamps — 0→1, 25→20, undefined/NaN→fallback, Brüche gerundet", () => {
  assert.equal(cap(0), 1);
  assert.equal(cap(25), 20);
  assert.equal(cap(undefined), 8);
  assert.equal(cap(NaN), 8);
  assert.equal(cap(-10), 1);
  assert.equal(cap(3.7), 4);
  assert.equal(cap(Infinity), 8); // nicht endlich → fallback
  assert.equal(cap(undefined, 5), 5); // eigener fallback
  assert.equal(cap(undefined, 8, 5), 5); // eigener max
  assert.equal(cap(100, 8, 50), 50);
});

// ---------------------------------------------------------------------------
// parseDdgHtml (Edge-Cases)
// ---------------------------------------------------------------------------

test("parseDdgHtml: uddg-Entpackung inkl. kodierter Query-Parameter und &amp;-Separator", () => {
  const html = `<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage%3Fq%3D1%26lang%3Dde&amp;rut=abc">Externe Seite</a>`;
  const items = parseDdgHtml(html);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://example.com/page?q=1&lang=de");
  assert.equal(items[0].title, "Externe Seite");
});

test("parseDdgHtml: doppelte Spaces, HTML-Tags im Snippet, numerische Entities", () => {
  const html = `
    <a class="result__a"   href="https://example.com/1">Titel\tmit\nvielen    Spaces</a>
    <a class="result__snippet" href="#">Erstens <b>fett</b> und &#39;zitiert&#39;, &#x27;hex&#x27; &amp; mehr</a>`;
  const items = parseDdgHtml(html);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Titel mit vielen Spaces");
  assert.equal(items[0].snippet, "Erstens fett und 'zitiert', 'hex' & mehr");
});

test("parseDdgHtml: fehlende Snippets → snippet undefined; leerer Titel → Fallback", () => {
  const html = `
    <a class="result__a" href="https://example.com/ohne-snippet">Ohne Snippet</a>
    <a class="result__a" href="https://example.com/leer"></a>`;
  const items = parseDdgHtml(html);
  assert.deepEqual(items, [
    { title: "Ohne Snippet", url: "https://example.com/ohne-snippet", snippet: undefined },
    { title: "(ohne Titel)", url: "https://example.com/leer", snippet: undefined },
  ]);
});

test("parseDdgHtml: fehlendes Snippet verschiebt die Zuordnung nicht", () => {
  const html = `
    <a class="result__a" href="https://a.example">Erster Treffer</a>
    <a class="result__a" href="https://b.example">Zweiter Treffer</a>
    <a class="result__snippet" href="#">Gehört inhaltlich zum zweiten Treffer</a>`;
  const items = parseDdgHtml(html);
  assert.equal(items[0].snippet, undefined);
  assert.equal(items[1].snippet, "Gehört inhaltlich zum zweiten Treffer");
});

test("parseDdgHtml: cappt auf 20 Ergebnisse", () => {
  const html = Array.from(
    { length: 25 },
    (_, i) => `<a class="result__a" href="https://example.com/${i}">T${i}</a>`,
  ).join("");
  const items = parseDdgHtml(html);
  assert.equal(items.length, 20);
  assert.equal(items[0].url, "https://example.com/0");
  assert.equal(items[19].url, "https://example.com/19");
});

test("parseDdgHtml: uddg mit defekten Prozent-Sequenzen → Fallback auf Rohwert, kein Throw", () => {
  const html = `<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F100%zz&rut=x">Kaputte Kodierung</a>`;
  const items = parseDdgHtml(html);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https%3A%2F%2Fexample.com%2F100%zz");
});

test("httpJson erhält Header aus einer Headers-Instanz", async (t) => {
  const server = await startServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ probe: req.headers["x-probe"] ?? null }));
  });
  t.after(() => closeServer(server));

  const j = await httpJson<{ probe: string | null }>(urlOf(server), {
    headers: new Headers({ "x-probe": "ping" }),
  });
  assert.equal(j.probe, "ping");
});
