## v0.3.1 — Keyless search and dashboard fixes

Tavily and Parallel now work without API keys for web search. Quota displays distinguish locally counted calls from provider balances, and dashboard layout and drag-and-drop bugs are fixed.

### Added

- Tavily keyless search via its anonymous-access header, using our own client identity.
- Parallel keyless search through its hosted MCP endpoint, with cancellation and normalized results.
- Search-only capability reporting for anonymous Tavily/Parallel access. Fetch uses their direct APIs when a key is configured.
- Engine configuration reloads across harness processes sharing the same configuration directory.

### Fixed

- Unknown quotas show local successful calls without invented caps or misleading 100% progress rings. Removed Exa's assumed 1,400-request allowance.
- Firecrawl's key badge reflects the configured credentials; remote balances are labeled as account balances rather than calendar-month quotas.
- Key-required engines without credentials are disabled. DuckDuckGo HTML is now opt-in.
- Responsive quota layouts, native drag-and-drop, readable disabled-engine forms, history empty states, and language/theme labels.
- English is now the default UI language; saved language preferences are preserved.
- Updated English README, actual dashboard screenshot, provider-access documentation and multi-harness/update guidance.

### Install or update

```sh
npx -y --allow-git=all github:RobinBially/search-rotation#v0.3.1
```

Alternatively, install the prebuilt `search-rotation-0.3.1.tgz` asset. The release includes `SHA256SUMS`. Distribution is through GitHub; no npm account is required.

Reconnect the MCP server in each harness after updating. Existing processes keep running their previous code. Saved credentials and history are retained; explicitly disabled engines stay disabled, so enable Tavily/Parallel in the dashboard if an older configuration disabled them.

Validation: 174 automated tests, package installation/MCP handshake, live anonymous searches through both new adapters, and browser checks of dashboard interactions on desktop, tablet and mobile. Local page extraction is not included in this release.
