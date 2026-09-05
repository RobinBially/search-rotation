## v0.3.3 — Configurable result counts and clearer tool discovery

Choose a custom search result count or let each provider use its own default. Discover all four MCP tools in the dashboard and get clearer engine status information.

### Added

- Dashboard setting for a custom result count (1–20) or **Provider default**. Explicit `numResults` tool arguments take precedence. Existing and fresh configurations retain 8 until changed.
- Provider-default mode omits the result-count parameter from upstream requests. Result counts can vary across rotation and failover; DuckDuckGo returns the results parsed from its HTML page, and Parallel hosted MCP uses its own result set.
- English/German **MCP Tools** dashboard tab with parameter explanations and copyable examples.

### Improved

- `engine_status` returns structured facts and equivalent JSON text. Configuration, per-capability key requirements, historical errors, local usage and provider account balances are clearly separated. This is not a live health check.
- Provider icons are bundled locally, so dashboard logos no longer depend on external image requests.
- README screenshots automatically follow light/dark mode and now display the real provider logos. The capture script checks that logos loaded successfully.
- Firecrawl's omitted-count cost estimate uses its documented 10-result default (estimated 2 credits); explicit counts above 10 are estimated at 4 credits. Anonymous provider balances remain unknown.

### Install or update

```sh
npx -y --allow-git=all github:RobinBially/search-rotation#v0.3.3
```

Alternatively, install the prebuilt `search-rotation-0.3.3.tgz` release asset and verify it with `SHA256SUMS`. Distribution is through GitHub; no npm account is required.

Reconnect the MCP server in each harness after updating. Configuration, credentials and history are retained. The status tool's text format has changed to JSON; integrations parsing the previous human-readable lines should use `structuredContent` or the new JSON text.

Validation: 186 automated tests; TypeScript build; package installation and MCP handshake; browser checks of settings persistence, provider/custom modes, and desktop/mobile layouts; regenerated light/dark screenshots.
