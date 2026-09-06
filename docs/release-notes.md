## v0.4.7 — Clearer dashboard usage, budgets, and activity

Engine call counts are now visible with or without an API key. Search, fetch, and error counts are displayed separately from provider credits, so services such as Firecrawl remain easy to inspect even when a quota API is available.

- Show monthly local engine attempts and their search/fetch/error breakdown consistently across the overview and engine cards.
- Rename Engine Health to Engine Usage & Budget, with explicit remaining percentages, budget units, and quota-source explanations.
- Add accessible activity-bar details for each two-hour window, including tool calls and per-engine attempts with fallbacks. Correct the 48-hour boundary and disclose the retained-history limit.
- Include failed fallback attempts in engine history filters; distinguish empty history from filter misses and add full timestamps to history tooltips.
- Refresh local call counts even when the quota percentage does not change. Empty history no longer implies a 0% error rate, and exhausted budgets have truly empty bars.
- Expand MCP setup by default, improve tablet/mobile navigation, and refresh the English light/dark README screenshots using demo data.

No configuration migration is required. Reconnect MCP clients after updating.

```sh
brew update && brew upgrade localfoundry/tap/search-rotation
```

Or run the pinned GitHub version:

```sh
npx -y --allow-git=all github:localfoundry/search-rotation#v0.4.7
```
