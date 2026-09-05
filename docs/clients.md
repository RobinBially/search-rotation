# MCP client setup

[← Back to README](../README.md)

Requires Node.js 20.3+ and Git. All examples install directly from GitHub; no npm account is needed. The version tag keeps installations reproducible.

## Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.search-rotation]
command = "npx"
args = ["-y", "--allow-git=all", "github:RobinBially/search-rotation#v0.3.2"]
```

## Claude Desktop and Cursor

Add to Claude Desktop's MCP configuration or Cursor's `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "search-rotation": {
      "command": "npx",
      "args": ["-y", "--allow-git=all", "github:RobinBially/search-rotation#v0.3.2"]
    }
  }
}
```

## Claude Code

```sh
claude mcp add search-rotation -- npx -y --allow-git=all github:RobinBially/search-rotation#v0.3.2
```

## OpenCode V2

Add this entry under `mcp.servers`:

```json
"search-rotation": {
  "type": "local",
  "command": ["npx", "-y", "--allow-git=all", "github:RobinBially/search-rotation#v0.3.2"],
  "codemode": true
}
```

## Local install or release archive

If installed locally, use `search-rotation` as the command. A prebuilt archive is also available under [GitHub Releases](https://github.com/RobinBially/search-rotation/releases/latest):

```sh
npm install -g ./search-rotation-0.3.2.tgz
```

`--allow-git=all` permits Git dependencies in npm 12. Older npm versions may display a warning for this option. npm/npx are package tools here; the package is distributed on GitHub.

For remote HTTP access, authentication and advanced settings, see the [operations guide (German)](operations.md).

## Multiple harnesses and updates

Each stdio client starts its own server process. Its dashboard binds to the configured port (6277 by default), or the next free port up to 20 ports higher. `open_dashboard` opens the dashboard belonging to that process; it does not attach to another harness's process.

Processes using the same `SEARCH_ROTATION_HOME` share configuration and counters. Engine settings reload before requests; port and authentication changes require a restart. Rotation cursors, cooldowns and in-flight reservations are per process, so strict-free mode is not a global spending lock across harnesses.

After updating the package, reconnect the MCP server in every harness. An existing process continues to run its old code and report its old version until restarted. For `MCP error -32000: Connection closed`, inspect the child process's stderr and verify Node.js, executable permissions and the configured command. A successful build alone does not update an already running process.
