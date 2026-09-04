# search-rotation

Websuche als MCP-Server mit **Round Robin über die Gratis-Kontingente mehrerer Such-APIs** — plus Dashboard für Keys, Reihenfolge, Toggles und Kontingent-Überblick.

Eine Engine = ~1.000 Gratis-Anfragen/Monat. Sieben Engines rotiert = **~10.000+/Monat**, mit automatischem Failover und Qualität, die über gescrapte SERPs (SearXNG & Co.) deutlich hinausgeht.

## Engines & Gratis-Kontingente (verifiziert, Stand 2026-09)

| Engine | Suche | Fetch | Gratis/Monat | Quota-Endpunkt | Ohne Key |
|---|---|---|---|---|---|
| Tavily | ✅ | ✅ | 1.000 Credits | ✅ `/usage` | ❌ |
| Firecrawl | ✅ | ✅ | 1.000 Credits | ✅ `credit-usage` | ⚠️ IP-basiert, winzig |
| Parallel | ✅ | ✅ | **5.000 Requests** + $5 | ❌ | ❌ |
| Exa | ✅ | ✅ | ~1.400 ($10 Guthaben) | ❌ | ❌ |
| Google PSE | ✅ | — | ~3.000 (100/Tag) | ❌ | ❌ (Key + CX nötig, standardmäßig aus) |
| Jina Reader | — | ✅ | unbegrenzt-ish | ❌ | ✅ IP-basiert (~20 RPM) |
| DuckDuckGo | ✅ | — | unbegrenzt-ish | ❌ | ✅ inoffiziell, zerbrechlich |

## Wie die Rotation arbeitet

1. Round Robin startet bei der obersten aktivierten Engine (Reihenfolge im Dashboard).
2. Engines mit **< 10 % Restkontingent** rutschen ans Ende, **erschöpfte** werden nur noch als letzte Instanz versucht.
3. Fehler (401/403/429/5xx/Timeout) → nächste Engine, transparent im Ergebnis (`Failover after: …`).
4. Restkontingent: Remote vom Anbieter (Tavily, Firecrawl — 5 Min Cache), sonst lokal pro Kalendermonat gezählt.
5. `engine`-Parameter pinnt eine Engine vorne, Failover bleibt aktiv.

## Schnellstart (Codex / Claude / Cursor)

```bash
npx -y search-rotation
```

**Codex** — `~/.codex/config.toml`:

```toml
[mcp_servers.search-rotation]
command = "npx"
args = ["-y", "search-rotation"]
```

**Claude Desktop / Claude Code** — `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "search-rotation": { "command": "npx", "args": ["-y", "search-rotation"] }
  }
}
```

Der stdio-Server startet **im selben Prozess** ein lokales Dashboard (`http://127.0.0.1:6277`, Link steht im Server-Log; der Agent kann es über das Tool `open_dashboard` öffnen). Dort: Keys hinterlegen, Reihenfolge ziehen, Engines togglen, Kontingente sehen, Engines live testen.

## Remote-Betrieb (Streamable HTTP)

```bash
npx -y search-rotation --http --port 6277 --token <geheim>
```

Client-Config (Claude):

```json
{
  "mcpServers": {
    "search-rotation": {
      "url": "http://dein-host:6277/mcp",
      "headers": { "Authorization": "Bearer <geheim>" }
    }
  }
}
```

Der Token schützt `/mcp`, das Dashboard und die API. **Wichtig:** Ohne Keys nutzen Firecrawl/Exa die Server-Egress-IP — auf VPS okay, hinter Cloudflare/Lambda unbrauchbar (geteilte IPs).

## MCP-Tools

| Tool | Zweck |
|---|---|
| `web_search` | Normalisierte Suche ({title, url, snippet}), optional `numResults`/`engine` |
| `fetch_url` | Seite als Markdown, eigene Fetch-Rotation |
| `engine_status` | Engines, Position, Restkontingente, Keys, letzte Fehler |
| `open_dashboard` | Öffnet das Dashboard im Browser |

## Konfiguration

Datei: `~/.config/search-rotation/config.json` (0600, wird vom Dashboard gepflegt). Override: `SEARCH_ROTATION_HOME`. Reihenfolge = Array-Reihenfolge (`engines` = Suche, `fetchOrder` = Fetch). Token zusätzlich via `--token` oder `SEARCH_ROTATION_TOKEN`.

## Entwicklung

```bash
npm install
npm run build        # tsc → dist/
npm test             # Router- und Parser-Tests (node:test)
npm run dev          # HTTP-Modus mit tsx
```

Projektstruktur: `src/engines/*` (Adapter mit `search`/`fetchUrl`/`remoteQuota`), `src/router.ts` (Round Robin, Failover, Quota-Ranking), `src/mcp/*` (Tools + Streamable-HTTP-Transport), `src/web/*` + `static/` (Dashboard), `src/index.ts` (CLI, stdio/HTTP-Modus).

## LICENSE

MIT
