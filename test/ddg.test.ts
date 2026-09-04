import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDdgHtml } from "../src/engines/duckduckgo.js";

const FIXTURE = `
<div class="results">
  <div class="result">
    <h2><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fmodelcontextprotocol.io%2F&amp;rut=abc">Model Context Protocol</a></h2>
    <a class="result__snippet" href="#">Das &amp; MCP ist ein offenes Protokoll &quot;f&uuml;r&quot; Tools.</a>
  </div>
  <div class="result">
    <h2><a class="result__a" href="https://example.com/mcp">MCP direkt</a></h2>
    <a class="result__snippet" href="#">Zweiter Treffer</a>
  </div>
</div>`;

test("parseDdgHtml extrahiert Titel, URL (uddg entpackt) und Snippet", () => {
  const items = parseDdgHtml(FIXTURE);
  assert.equal(items.length, 2);
  assert.equal(items[0].url, "https://modelcontextprotocol.io/");
  assert.equal(items[0].title, "Model Context Protocol");
  assert.ok(items[0].snippet?.includes('"für"'));
  assert.equal(items[1].url, "https://example.com/mcp");
  assert.equal(items[1].snippet, "Zweiter Treffer");
});

test("parseDdgHtml liefert leere Liste ohne Treffer", () => {
  assert.deepEqual(parseDdgHtml("<html><body>anomaly captcha</body></html>"), []);
});
