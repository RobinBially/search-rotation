# Provider access and quota accounting

Verified against provider documentation on 2026-09-05.

| Provider | Without an API key? | Default without credentials | Evidence / limitation |
| --- | --- | --- | --- |
| Exa | Yes, through its hosted MCP server | Enabled | [Official MCP guide](https://docs.exa.ai/reference/exa-mcp): free casual use; search and fetch. Direct REST API requires a key. No known account balance or fixed request allowance for anonymous access. |
| Firecrawl | Yes, search and scrape | Enabled | [Keyless rate limits](https://docs.firecrawl.dev/rate-limits#keyless-no-api-key) explicitly cover REST and hosted MCP. Shared IP/day request and credit limits; general API introduction still says authentication is required. |
| Jina Reader | Yes, page extraction | Enabled | [Reader documentation](https://jina.ai/reader/): anonymous rate limits; fetch only in this server. |
| DuckDuckGo HTML | Yes | Disabled (opt-in) | [Non-JavaScript search](https://duckduckgo.com/duckduckgo-help-pages/features/non-javascript): public HTML interface, not an officially supported search API. Can block automated traffic. |
| Tavily | Yes for search, using a keyless-access header | Enabled (search only) | [OpenCode 2 implementation](https://github.com/anomalyco/opencode/blob/b09a74591cbd4d2ea1488e56177898a13f21278d/packages/core/src/plugin/websearch/tavily.ts); independently verified without credentials. Standard quickstart only describes authenticated access. |
| Parallel | Yes for search via hosted MCP | Enabled (search only) | [OpenCode 2 implementation](https://github.com/anomalyco/opencode/blob/b09a74591cbd4d2ea1488e56177898a13f21278d/packages/core/src/plugin/websearch/parallel.ts); independently verified without credentials. Authenticated requests use the direct REST API. |
| Google CSE | No; API key and search-engine ID required | Disabled | [API overview](https://developers.google.com/custom-search/v1/overview): existing customers only; scheduled discontinuation January 1, 2027. |

“Without a key” never means unlimited. Rate limits and balances may be shared with other users behind the same public IP.

The dashboard distinguishes:

- **Provider account balance:** fetched with a configured key where supported. Firecrawl's billing period is not assumed to be a calendar month. Cached snapshots may include estimated consumption since the last refresh.
- **Local successful calls:** this installation's successful search/fetch calls in the current UTC calendar month. Failed calls are counted separately. This is not the provider's total consumption; other clients, shared IP traffic and potentially billed failed requests are not observable.
- **Unknown allowance:** no progress percentage or invented cap. Exa's former approximation of 1,400 requests has been removed, including for authenticated access. Explicit configured limits are local budgets, not verified provider balances.

Existing engines that require credentials are disabled when their key is absent. Configured keys and explicit disabled settings are preserved.

## OpenCode 2 implementation check

The installed `opencode2 v0.0.0-beta-18684` binary contains the same keyless branches as the linked beta source. These are built-in web-search plugins, not an installation of search-rotation.

- Tavily: POST `https://api.tavily.com/search`, `X-Tavily-Access-Mode: keyless`, basic search, 3 chunks per source. OpenCode identifies itself through `X-Client-Name: opencode2`; our independent test used `search-rotation` instead, without Authorization or an API key, and returned HTTP 200 with 3 results.
- Parallel: MCP `https://search.parallel.ai/mcp`, tool `web_search`, arguments `objective` and `search_queries`. No Authorization header without configured credentials. Independent SDK test using client name search-rotation returned 10 results. Tool discovery also exposed `web_fetch`, which was not tested.

This proves anonymous search access at verification time, not unlimited usage or support for every extraction endpoint. No account balance or cap is inferred. search-rotation now implements both anonymous search paths. Without credentials, these engines are omitted from fetch rotation and expose search only in the dashboard. With credentials, search and fetch use their direct APIs.

## Result count

In **Engines → Rotation settings**, choose **Custom count** (1–20) or **Provider default**. Existing and fresh configurations retain 8 until changed. An explicit `numResults` tool argument overrides this setting. Provider default omits the count from upstream requests; result counts may differ after rotation or failover. DuckDuckGo returns all results parsed from its HTML page; Parallel's hosted MCP returns its own result set (explicit counts are applied locally). Google CSE still caps explicit requests at 10.

Firecrawl documents a default of 10 results, so our cost estimate for an omitted count is 2 credits, not an assumed dashboard count. Explicit counts above 10 are estimated at 4 credits. Source: https://docs.firecrawl.dev/api-reference/endpoint/search . Anonymous provider balances remain unknown; local successful-call counters do not measure their true credit consumption.
