# Distribution and listings

Where search-rotation is published or listed, who keeps each channel current, and
what still needs attention. Snapshot: 2026-09-26.

## Channels

| Channel | Entry | Kept current by | State |
| --- | --- | --- | --- |
| npm | `search-rotation` | release workflow, trusted publishing | 0.4.10 |
| Homebrew | `brew install robin-bially/tap/search-rotation` | release script writes the formula | 0.4.10 |
| Official MCP Registry | `io.github.robin-bially/search-rotation` | release workflow, GitHub OIDC | active, 0.4.10 |
| GitHub releases | tag, tarball and checksum | release script | v0.4.10 |
| Glama | [directory entry](https://glama.ai/mcp/servers/robin-bially/search-rotation-mcp), rated A | Glama indexes the repository on its own | listed; Glama followed the rename on its own |
| mcpservers.org | [submission](https://mcpservers.org/de/submit) from 2026-09-26 | reviewed by the site | in review, up to two weeks |
| PulseMCP | — | ingests the official registry | submissions paused, not listed yet |
| [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers/pull/15171) | Search & Data Extraction | maintainers | pull request open, listing checks done |
| [YuzeHao2023/Awesome-MCP-Servers](https://github.com/YuzeHao2023/Awesome-MCP-Servers/pull/550) | Search & Web | maintainers | pull request open |
| [ever-works/awesome-mcp-servers](https://github.com/ever-works/awesome-mcp-servers/pull/188) | Web Search | maintainers | pull request open |

Channels that build on the official registry follow a release by themselves, so a
release needs no manual work for them.

## What a release updates

`VERSION=x.y.z ./scripts/release.sh --publish` runs the checks, bumps the version,
commits and tags, creates the GitHub release, packs the tarball with its checksum,
writes the formula in `robin-bially/homebrew-tap`, and waits until npm serves the
new version. The published release triggers
[`.github/workflows/publish.yml`](../.github/workflows/publish.yml), which pushes
the package to npm with provenance and then registers the same version in the
official MCP Registry from `server.json` and the `mcpName` field of
`package.json`.

Three details are easy to forget:

- `server.json` and `mcpName` must name the same server; `test/registry-manifest.test.ts` fails when they drift apart.
- The registry limits `description` to 100 characters.
- The registry verifies ownership through the published npm package, so a manifest can only be registered once that version exists on npm. The workflow skips an already published version, which makes a re-run safe.

## Recurring checks

- After a release: `npm view search-rotation version` and the [registry entry](https://registry.modelcontextprotocol.io/?q=io.github.robin-bially%2Fsearch-rotation) should both show the new version. The release script already waits for npm.
- Dependency and tap maintenance runs outside this repository on a biweekly schedule.
- Open externally: mcpservers.org reviews the submission, PulseMCP is paused, the three list pull requests wait for their maintainers, and Glama re-crawls repositories at its own pace.

## Deliberately not used

Directories that require a new account before a submission (Glama's own form,
mcp.so) are skipped. The Glama listing exists because Glama indexes public GitHub
repositories without a submission; it picked up the repository rename by itself.
