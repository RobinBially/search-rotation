import { createRequire } from "node:module";

// Version aus package.json — einzige Quelle, kein doppeltes Pflegen beim Bumpen.
// Resolution: dist/version.js → ../package.json (liegt im npm-Paket und im Repo immer neben dist).
const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

export const VERSION = pkg.version;
