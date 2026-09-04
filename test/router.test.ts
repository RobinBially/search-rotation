import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SearchRouter, RouterError } from "../src/router.js";
import type { EngineAdapter, PolyConfig, SearchInput, SearchOutcome } from "../src/types.js";
import { UsageStore } from "../src/usage.js";

function tmpUsage(): UsageStore {
  return new UsageStore(mkdtempSync(join(tmpdir(), "sr-test-")));
}

function cfg(engines: { id: string; enabled: boolean }[]): PolyConfig {
  return {
    version: 1,
    engines: engines.map(e => ({ ...e, apiKey: "fixture-key" })),
    fetchOrder: [],
    settings: { port: 6277, token: "", monthlyLimits: {} },
  };
}

function adapter(id: string, impl: (input: SearchInput) => Promise<SearchOutcome>): EngineAdapter {
  return {
    meta: {
      id,
      label: id,
      homepage: "https://example.com",
      signupUrl: "https://example.com",
      keyless: "no",
      capabilities: ["search"],
      monthlyFree: 1000,
      quotaEndpoint: false,
    },
    search: impl,
  };
}

test("Failover: erste Engine wirft, zweite antwortet", async () => {
  const adapters = [
    adapter("a", async () => {
      throw new Error("429 zu viele Anfragen");
    }),
    adapter("b", async () => ({ items: [{ title: "Treffer", url: "https://x.example" }] })),
  ];
  const router = new SearchRouter({ getConfig: () => cfg([{ id: "a", enabled: true }, { id: "b", enabled: true }]), usage: tmpUsage(), adapters });
  const r = await router.search({ query: "test" });
  assert.equal(r.engine, "b");
  assert.equal(r.attempts.length, 2);
  assert.equal(r.attempts[0].ok, false);
  assert.equal(r.attempts[0].error, "429 zu viele Anfragen");
  assert.equal(r.attempts[1].ok, true);
});

test("Round Robin rotiert die Startposition", async () => {
  const adapters = [adapter("a", async () => ({ items: [] })), adapter("b", async () => ({ items: [] }))];
  const router = new SearchRouter({
    getConfig: () => cfg([{ id: "a", enabled: true }, { id: "b", enabled: true }]),
    usage: tmpUsage(),
    adapters,
  });
  const r1 = await router.search({ query: "q" });
  const r2 = await router.search({ query: "q" });
  assert.notEqual(r1.engine, r2.engine);
});

test("Engine mit knappem Restkontingent wird hinten einsortiert", async () => {
  const usage = tmpUsage();
  for (let i = 0; i < 995; i++) usage.record("a", "search"); // 99,5 % von 1000 verbraucht
  const adapters = [
    adapter("a", async () => ({ items: [{ title: "aus a", url: "https://a.example" }] })),
    adapter("b", async () => ({ items: [{ title: "aus b", url: "https://b.example" }] })),
  ];
  const router = new SearchRouter({
    getConfig: () => cfg([{ id: "a", enabled: true }, { id: "b", enabled: true }]),
    usage,
    adapters,
  });
  const r = await router.search({ query: "q" });
  assert.equal(r.engine, "b");
  assert.equal(r.attempts.length, 1);
});

test("preferEngine wird zuerst probiert", async () => {
  const adapters = [adapter("a", async () => ({ items: [] })), adapter("b", async () => ({ items: [] }))];
  const router = new SearchRouter({
    getConfig: () => cfg([{ id: "a", enabled: true }, { id: "b", enabled: true }]),
    usage: tmpUsage(),
    adapters,
  });
  const r = await router.search({ query: "q" }, { preferEngine: "b" });
  assert.equal(r.engine, "b");
});

test("Deaktivierte Engines werden übersprungen", async () => {
  const adapters = [
    adapter("a", async () => ({ items: [{ title: "aus a", url: "https://a.example" }] })),
    adapter("b", async () => ({ items: [{ title: "aus b", url: "https://b.example" }] })),
  ];
  const router = new SearchRouter({
    getConfig: () => cfg([{ id: "a", enabled: false }, { id: "b", enabled: true }]),
    usage: tmpUsage(),
    adapters,
  });
  const r = await router.search({ query: "q" });
  assert.equal(r.engine, "b");
});

test("Alle Engines fehlgeschlagen → RouterError mit Attempt-Liste", async () => {
  const adapters = [
    adapter("a", async () => {
      throw new Error("kaputt");
    }),
    adapter("b", async () => {
      throw new Error("auch kaputt");
    }),
  ];
  const router = new SearchRouter({
    getConfig: () => cfg([{ id: "a", enabled: true }, { id: "b", enabled: true }]),
    usage: tmpUsage(),
    adapters,
  });
  await assert.rejects(
    () => router.search({ query: "q" }),
    (err: unknown) => err instanceof RouterError && err.attempts.length === 2,
  );
});

test("Keine aktivierte Engine → klare Fehlermeldung", async () => {
  const adapters = [adapter("a", async () => ({ items: [] }))];
  const router = new SearchRouter({
    getConfig: () => cfg([{ id: "a", enabled: false }]),
    usage: tmpUsage(),
    adapters,
  });
  await assert.rejects(() => router.search({ query: "q" }), /Keine aktivierte Such-Engine/);
});
