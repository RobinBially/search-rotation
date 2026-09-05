## v0.4.1 — LocalFoundry distribution

search-rotation is now distributed under the LocalFoundry umbrella.

- GitHub installation commands, documentation and package links use `localfoundry/search-rotation`.
- The package author and copyright attribution use LocalFoundry.
- Dashboard setup snippets pin the running server version instead of installing an unversioned branch.
- The MCP server name, executable, tools and configuration directory remain `search-rotation`; existing keys and history do not need migration.

### Install or update

```sh
npx -y --allow-git=all github:localfoundry/search-rotation#v0.4.1
```

Alternatively, install the prebuilt `search-rotation-0.4.1.tgz` release asset and verify it with `SHA256SUMS`.
Reconnect the MCP server in each client after updating. Distribution is through GitHub; no npm account is required.
