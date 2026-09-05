## v0.3.2 — Dashboard identity and MCP icons

This hotfix uses the existing dashboard logo consistently in the README and MCP server metadata.

- Added self-contained, theme-specific PNG icons to MCP initialization metadata. Icons work without a dashboard connection or external image host; display depends on client support.
- Added SVG and PNG logo assets, light/dark wordmarks, and a monochrome variant based on the original dashboard symbol.
- Updated the README branding and pinned installation examples to v0.3.2.

### Install or update

```sh
npx -y --allow-git=all github:RobinBially/search-rotation#v0.3.2
```

Alternatively, install the prebuilt `search-rotation-0.3.2.tgz` release asset. Verify it with the included `SHA256SUMS`. No npm account is needed.

Reconnect the MCP server in each harness after updating to load the new version and icon metadata. Saved configuration, credentials, and history are retained.

Validation: 175 automated tests, TypeScript build, visual inspection of logo exports, and package installation with an MCP handshake and all four tools.
