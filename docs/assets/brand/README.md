# Search Rotation identity

The existing dashboard logo: an open orbit with a central dot. Geometry matches `#i-logo` in `static/index.html`; colors match the theme accents in `static/style.css`.

- `icon.svg`: transparent primary symbol, using the light-background palette.
- `icon-dark.svg` / `icon-light.svg`: solid tiles for avatars.
- `icon-mono.svg`: single-color symbol; inherits `currentColor` when inlined.
- `wordmark-dark.svg` / `wordmark-light.svg`: outlined lettering for dark / light backgrounds.
- `icon-dark-128.png` / `icon-light-128.png`: transparent, theme-specific MCP server icons, embedded as data URIs during initialization.
- Other PNG exports: 32, 128, and 512 px primary icons; 512 px tiles.
- `preview.png`: overview with small-size samples.

Dark-theme gradient: `#8b7cf7` → `#4dd8e6`.
Light-theme gradient: `#6d5ae8` → `#0e95b3`.

Preserve the open ring, central dot, orientation, and proportions. Keep clear space around the symbol. MCP clients decide whether and where server icons are displayed; providing metadata does not guarantee a visible icon in every client.

The original symbol is covered by the repository's MIT license. The wordmark uses outlined Manrope lettering (SIL Open Font License; see `FONT-LICENSE.txt`); no font installation is required to display it.
