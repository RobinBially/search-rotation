import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig, type ConfigDefaults } from "../src/config.js";

const defaults: ConfigDefaults = {
  knownIds: ["tavily", "firecrawl", "parallel", "exa", "google-cse", "jina", "duckduckgo"],
  searchOrder: ["tavily", "firecrawl", "parallel", "exa", "google-cse", "duckduckgo"],
  fetchOrder: ["jina", "firecrawl", "parallel", "tavily", "exa"],
  defaultEnabled: { "google-cse": false },
};

test("Frische Config enthält auch fetch-only Engines (Jina)", () => {
  const cfg = normalizeConfig(null, defaults);
  const ids = cfg.engines.map((e) => e.id);
  assert.ok(ids.includes("jina"), "jina muss in engines sein, sonst wird sie nie gefetcht");
  assert.deepEqual(cfg.fetchOrder, defaults.fetchOrder);
  assert.equal(cfg.engines.find((e) => e.id === "google-cse")?.enabled, false);
});

test("Keys, Reihenfolge und Settings bleiben erhalten, neue Engines werden angehängt", () => {
  const cfg = normalizeConfig(
    {
      engines: [
        { id: "firecrawl", enabled: true, apiKey: "fc-xxx" },
        { id: "tavily", enabled: false },
      ],
      fetchOrder: ["tavily", "jina", "firecrawl"],
      settings: { port: 7000, token: "abc", monthlyLimits: { tavily: 500 } },
    },
    defaults,
  );
  assert.deepEqual(cfg.engines.map((e) => e.id).slice(0, 2), ["firecrawl", "tavily"]);
  assert.equal(cfg.engines.find((e) => e.id === "firecrawl")?.apiKey, "fc-xxx");
  assert.equal(cfg.engines.find((e) => e.id === "tavily")?.enabled, false);
  assert.ok(cfg.engines.find((e) => e.id === "jina"));
  assert.deepEqual(cfg.fetchOrder, ["tavily", "jina", "firecrawl", "parallel", "exa"]);
  assert.equal(cfg.settings.port, 7000);
  assert.equal(cfg.settings.token, "abc");
  assert.deepEqual(cfg.settings.monthlyLimits, { tavily: 500 });
});

test("Unbekannte Engine-Ids werden verworfen, Defaults greifen", () => {
  const cfg = normalizeConfig({ engines: [{ id: "nope", enabled: true }, { id: "exa" }] }, defaults);
  assert.equal(cfg.engines.some((e) => e.id === "nope"), false);
  assert.equal(cfg.engines.find((e) => e.id === "exa")?.enabled, true);
});
