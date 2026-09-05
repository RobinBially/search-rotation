## v0.4.0 — Search time filters and compatible-provider rotation

Limit web searches to a relative period or explicit dates. Rotation and failover now select providers that support the requested filter and configured access mode, without silently falling back to an unfiltered search.

### Added

- `web_search` parameters: `timeRange` (`day`, `week`, `month`, `year`), `startDate`, and `endDate` (`YYYY-MM-DD`). Invalid calendar dates, reversed bounds, and mixing relative and explicit filters are rejected before provider requests.
- Native date mapping for Tavily, Firecrawl, and Exa's direct API with a key. One-sided bounds use Tavily or keyed Exa; incompatible providers and access modes are skipped.
- Separate rotation cursors for compatible provider pools, preserving quota priorities, cooldowns, strict-free rules, and failover.
- Publication dates in search output when available, and the requested period in history.
- Updated README and English/German dashboard tool help, with examples and the provider support matrix.

### Date semantics

Relative windows resolve once per request into UTC dates, from 1/7/30/365 days ago through today. They have day precision, not rolling-hour precision. Provider semantics differ: Tavily can filter publication or update dates, Exa uses estimated publication dates, and Firecrawl uses its search index's date interpretation. Exact boundary inclusion follows the provider.

### Install or update

```sh
npx -y --allow-git=all github:RobinBially/search-rotation#v0.4.0
```

Alternatively, install the prebuilt `search-rotation-0.4.0.tgz` release asset and verify it with `SHA256SUMS`. Distribution is through GitHub; no npm account is required.

Reconnect the MCP server in each client after updating to load the new tool schema. Existing configuration, credentials, and history are retained. Searches without time arguments continue to use all otherwise eligible providers.

Validation: 197 automated tests; TypeScript build; package installation and MCP handshake with all four tools; independent subagent review of the diff and official provider parameter documentation. Provider requests are covered by mocked wire tests; live filtering behavior and exact date boundaries remain to be validated against real results.
