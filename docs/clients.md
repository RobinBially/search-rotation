# MCP client setup

[← Back to README](../README.md)

Requires Node.js 20.3+ and Git. All examples install directly from GitHub; no npm account is needed. The version tag keeps installations reproducible.

## Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.search-rotation]
command = "npx"
args = ["-y", "--allow-git=all", "github:RobinBially/search-rotation#v0.3.0"]
```

## Claude Desktop and Cursor

Add to Claude Desktop's MCP configuration or Cursor's `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "search-rotation": {
      "command": "npx",
      "args": ["-y", "--allow-git=all", "github:RobinBially/search-rotation#v0.3.0"]
    }
  }
}
```

## Claude Code

```sh
claude mcp add search-rotation -- npx -y --allow-git=all github:RobinBially/search-rotation#v0.3.0
```

## OpenCode V2

Add this entry under `mcp.servers`:

```json
"search-rotation": {
  "type": "local",
  "command": ["npx", "-y", "--allow-git=all", "github:RobinBially/search-rotation#v0.3.0"],
  "codemode": true
}
```

## Local install or release archive

If installed locally, use `search-rotation` as the command. A prebuilt archive is also available under [GitHub Releases](https://github.com/RobinBially/search-rotation/releases/latest):

```sh
npm install -g ./search-rotation-0.3.0.tgz
```

`--allow-git=all` permits Git dependencies in npm 12. Older npm versions may display a warning for this option. npm/npx are package tools here; the package is distributed on GitHub.

For remote HTTP access, authentication and advanced settings, see the [operations guide (German)](operations.md).
