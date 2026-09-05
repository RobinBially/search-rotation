## v0.4.2 — Developer attribution and LocalFoundry branding

search-rotation lives on [Robin Bially’s GitHub profile](https://github.com/RobinBially/search-rotation), alongside the rest of his portfolio. LocalFoundry remains the shared tool brand.

- README and package metadata link directly to the developer and canonical source repository.
- GitHub installation examples keep the neutral LocalFoundry URL, which redirects to the personal repository. Keep the old organization repository path unused to preserve that redirect.
- No runtime or configuration changes. Git author, committer and tagger metadata use GitHub noreply addresses.

```sh
npx -y --allow-git=all github:localfoundry/search-rotation#v0.4.2
```

Alternatively, install the prebuilt `search-rotation-0.4.2.tgz` release asset and verify it with `SHA256SUMS`.
Reconnect each MCP client after updating.
