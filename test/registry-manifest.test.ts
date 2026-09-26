import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relative: string) =>
  JSON.parse(readFileSync(new URL(`../${relative}`, import.meta.url), "utf8"));

const pkg = read("package.json");
const manifest = read("server.json");

// Die Registry prüft diese Angaben erst im Release-Workflow, und zwar nach dem
// npm-Publish. Ein abgelehnter Publish kostet dort einen Zyklus, also prüfen wir
// die Regeln schon im normalen Testlauf.
test("server.json trägt denselben Namen wie mcpName im Paket", () => {
  assert.equal(manifest.name, pkg.mcpName);
  assert.match(manifest.name, /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
});

test("server.json beschreibt den Server in höchstens 100 Zeichen", () => {
  assert.equal(typeof manifest.description, "string");
  assert.ok(
    manifest.description.length > 0 && manifest.description.length <= 100,
    `description ist ${manifest.description.length} Zeichen lang, erlaubt sind 100`,
  );
});

test("server.json und das npm-Paket nennen dieselbe Version", () => {
  assert.equal(manifest.version, pkg.version);
  for (const entry of manifest.packages ?? []) {
    assert.equal(entry.version, pkg.version, `Paket ${entry.identifier} weicht ab`);
  }
});

test("server.json verweist auf das Repository und beschreibt das npm-Paket", () => {
  assert.equal(manifest.repository.source, "github");
  assert.equal(
    manifest.repository.url,
    "https://github.com/robin-bially/search-rotation-mcp",
  );
  const npm = (manifest.packages ?? []).find(
    (entry: { registryType?: string }) => entry.registryType === "npm",
  );
  assert.ok(npm, "Es fehlt ein Eintrag für das npm-Paket");
  assert.equal(npm.identifier, pkg.name);
  assert.equal(npm.transport.type, "stdio");
});
