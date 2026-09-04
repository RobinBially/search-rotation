"use strict";

const $ = (s) => document.querySelector(s);

const state = { meta: null, config: null, status: [], dragFrom: null };

// Token aus ?token=… übernehmen und aus der Adresszeile entfernen
const params = new URLSearchParams(location.search);
if (params.get("token")) {
  localStorage.setItem("sr_token", params.get("token"));
  params.delete("token");
  history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params.toString() : ""));
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = String(s ?? "");
  return d.innerHTML;
}

async function api(path, opts = {}) {
  const token = localStorage.getItem("sr_token") || "";
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    document.body.innerHTML =
      '<main><p class="error">401 — diese Dashboard-URL mit <code>?token=…</code> öffnen (steht im Server-Log).</p></main>';
    throw new Error("unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function refreshStatus() {
  const s = await api("/api/status");
  state.status = s.engines;
}

async function load() {
  state.meta = await api("/api/meta");
  state.config = await api("/api/config");
  await refreshStatus();
  render();
}

function statusOf(id) {
  return state.status.find((e) => e.id === id) || {};
}
function metaOf(id) {
  return (state.config.enginesMeta || []).find((m) => m.id === id) || {};
}
function cfgOf(id) {
  return (state.config.engines || []).find((e) => e.id === id) || {};
}

function bar(pct, label) {
  const cls = pct > 40 ? "ok" : pct > 10 ? "warn" : "crit";
  return (
    '<div class="bar"><div class="fill ' + cls + '" style="width:' + pct + '%"></div></div>' +
    '<span class="bar-label">' + esc(label) + " · " + pct + "% frei</span>"
  );
}

function quotaHtml(st) {
  if (!st || !st.id) return "";
  if (st.remoteError) return '<span class="quota-err">Remote-Quota: ' + esc(st.remoteError) + "</span>";
  if (st.remote && st.remote.limit) {
    const rem = st.remote.remaining !== undefined ? st.remote.remaining : st.remote.limit - (st.remote.used || 0);
    return bar(
      Math.max(0, Math.round((100 * rem) / st.remote.limit)),
      (st.remote.used ?? "?") + " / " + st.remote.limit + " (remote)",
    );
  }
  if (st.monthlyLimit > 0) {
    const used = (st.used?.search || 0) + (st.used?.fetch || 0);
    return bar(
      Math.max(0, Math.round((100 * (st.monthlyLimit - used)) / st.monthlyLimit)),
      used + " / " + st.monthlyLimit + " (lokal gezählt)",
    );
  }
  return '<span class="quota-free">kein festes Kontingent</span>';
}

function putConfig(engines, fetchOrder) {
  const eng = engines || state.config.engines.map((e) => ({ id: e.id, enabled: e.enabled }));
  return api("/api/config", {
    method: "PUT",
    body: {
      engines: eng,
      fetchOrder: fetchOrder || state.config.fetchOrder,
      settings: { port: state.config.settings.port },
    },
  }).then((r) => {
    state.config = r.config;
    render();
  });
}

function render() {
  $("#version").textContent = "v" + state.meta.version;
  $("#configpath").textContent = state.meta.configPath;

  const anyKey = (state.config.engines || []).some((e) => e.hasKey);
  const notice = $("#notice");
  if (!anyKey) {
    notice.textContent =
      "Hinweis: Noch kein API-Key hinterlegt. Ohne Keys laufen nur die IP-basierten Engines (Firecrawl, Jina, DuckDuckGo) — und meist nur wenige Requests. Empfehlung: Tavily, Parallel und Exa registrieren (kostenlos, Links auf den Karten).";
    notice.classList.remove("hidden");
  } else {
    notice.classList.add("hidden");
  }

  renderSearch();
  renderFetch();
  renderSnippets();
}

function renderSearch() {
  const wrap = $("#search-engines");
  wrap.innerHTML = "";
  for (const e of state.config.engines) {
    const m = metaOf(e.id);
    const st = statusOf(e.id);

    const card = document.createElement("div");
    card.className = "card" + (e.enabled ? "" : " off");
    card.draggable = true;
    card.dataset.id = e.id;

    const head = document.createElement("div");
    head.className = "head";
    head.innerHTML =
      '<span class="handle" title="Ziehen zum Sortieren">≡</span>' +
      '<label class="switch"><input type="checkbox" data-act="toggle"' + (e.enabled ? " checked" : "") +
      '><span></span></label>' +
      '<span class="name">' + esc(m.label || e.id) + "</span>" +
      (m.keyless === "ip" ? '<span class="badge ip">ohne Key nutzbar</span>' : "") +
      (m.quotaEndpoint ? '<span class="badge quota">Quota-API</span>' : "") +
      '<span class="caps">' + (m.capabilities || []).join(" · ") + "</span>";
    card.appendChild(head);

    const quota = document.createElement("div");
    quota.className = "quota";
    quota.dataset.quota = e.id;
    quota.innerHTML = quotaHtml(st);
    card.appendChild(quota);

    const keyRow = document.createElement("div");
    keyRow.className = "keyrow";
    keyRow.innerHTML =
      '<input type="password" class="keyinput" data-id="' + esc(e.id) + '" placeholder="' +
      (e.hasKey ? "Key ersetzen (leer = unverändert) · aktuell: " + esc(e.keyMasked) : "API-Key hinterlegen") +
      '">' +
      '<button data-act="save-key">Speichern</button>' +
      (e.hasKey ? '<button data-act="clear-key" title="Key löschen">✕</button>' : "") +
      '<button data-act="test-search">Suche testen</button>' +
      '<a class="signup" href="' + esc(m.signupUrl || m.homepage || "#") + '" target="_blank" rel="noreferrer">Gratis-Key ↗</a>';
    card.appendChild(keyRow);

    for (const f of m.extraFields || []) {
      const row = document.createElement("div");
      row.className = "keyrow extra";
      row.innerHTML =
        '<input type="text" class="extrainput" data-id="' + esc(e.id) + '" data-extra="' + esc(f.key) +
        '" placeholder="' + esc(f.label) + (e.extrasSet && e.extrasSet[f.key] ? " (gesetzt)" : "") + '">' +
        '<button data-act="save-extra">Speichern</button>';
      card.appendChild(row);
    }

    const testOut = document.createElement("div");
    testOut.className = "testout";
    testOut.dataset.testout = e.id;
    card.appendChild(testOut);

    if (m.notes) {
      const notes = document.createElement("div");
      notes.className = "notes";
      notes.textContent = m.notes;
      card.appendChild(notes);
    }

    wrap.appendChild(card);
  }
  enableDrag(wrap, (from, to) => {
    const ids = state.config.engines.map((e) => e.id);
    reorder(ids, from, to);
    putConfig(ids.map((id) => ({ id, enabled: state.config.engines.find((x) => x.id === id).enabled })));
  });
}

function renderFetch() {
  const wrap = $("#fetch-engines");
  wrap.innerHTML = "";
  for (const id of state.config.fetchOrder) {
    const m = metaOf(id);
    const e = cfgOf(id);
    const st = statusOf(id);
    const row = document.createElement("div");
    row.className = "row" + (e.enabled ? "" : " off");
    row.draggable = true;
    row.dataset.id = id;
    row.innerHTML =
      '<span class="handle">≡</span>' +
      '<span class="name">' + esc(m.label || id) + "</span>" +
      '<span class="caps">' + (e.enabled ? "aktiv" : "inaktiv (Schalter in der Such-Sektion)") + "</span>" +
      '<span class="quota-inline" data-quota="' + esc(id) + '">' + quotaHtml(st) + "</span>" +
      '<button data-act="test-fetch">Fetch testen</button>';
    wrap.appendChild(row);
  }
  enableDrag(wrap, (from, to) => {
    const order = [...state.config.fetchOrder];
    reorder(order, from, to);
    putConfig(undefined, order);
  });
}

function renderSnippets() {
  const remoteUrl = location.origin + "/mcp";
  $("#snip-codex").textContent =
    '[mcp_servers.search-rotation]\ncommand = "npx"\nargs = ["-y", "search-rotation"]';
  $("#snip-claude").textContent = JSON.stringify(
    { mcpServers: { "search-rotation": { command: "npx", args: ["-y", "search-rotation"] } } },
    null,
    2,
  );
  $("#snip-remote").textContent =
    "URL: " + remoteUrl + "\nHeader: Authorization: Bearer <token>   (nur wenn ein Token gesetzt ist)";
}

function enableDrag(container, onReorder) {
  container.addEventListener("dragstart", (ev) => {
    const el = ev.target.closest("[draggable]");
    if (!el) return;
    state.dragFrom = el.dataset.id;
    el.classList.add("dragging");
    ev.dataTransfer.effectAllowed = "move";
    try {
      ev.dataTransfer.setData("text/plain", el.dataset.id);
    } catch {}
  });
  container.addEventListener("dragend", (ev) => {
    const el = ev.target.closest("[draggable]");
    if (el) el.classList.remove("dragging");
  });
  container.addEventListener("dragover", (ev) => ev.preventDefault());
  container.addEventListener("drop", (ev) => {
    ev.preventDefault();
    const toEl = ev.target.closest("[draggable]");
    const from = state.dragFrom;
    state.dragFrom = null;
    if (toEl && from && from !== toEl.dataset.id) onReorder(from, toEl.dataset.id);
  });
}

function reorder(list, from, to) {
  const i = list.indexOf(from);
  const j = list.indexOf(to);
  if (i < 0 || j < 0) return;
  list.splice(j, 0, list.splice(i, 1)[0]);
}

document.addEventListener("change", (ev) => {
  if (ev.target.matches && ev.target.matches('input[data-act="toggle"]')) {
    const id = ev.target.closest("[data-id]").dataset.id;
    const engines = state.config.engines.map((e) =>
      e.id === id ? { id, enabled: ev.target.checked } : { id: e.id, enabled: e.enabled },
    );
    putConfig(engines).catch((err) => alert(err.message));
  }
});

document.addEventListener("click", async (ev) => {
  const copyBtn = ev.target.closest("button[data-copy]");
  if (copyBtn) {
    navigator.clipboard.writeText(document.getElementById(copyBtn.dataset.copy).textContent);
    copyBtn.textContent = "Kopiert ✓";
    setTimeout(() => (copyBtn.textContent = "Kopieren"), 1500);
    return;
  }

  const btn = ev.target.closest("button[data-act]");
  if (!btn) return;
  const host = btn.closest("[data-id]");
  if (!host) return;
  const id = host.dataset.id;
  const act = btn.dataset.act;

  try {
    if (act === "save-key") {
      const input = host.querySelector(".keyinput");
      const engines = state.config.engines.map((e) =>
        e.id === id ? { id, enabled: e.enabled, apiKey: input.value } : { id: e.id, enabled: e.enabled },
      );
      await putConfig(engines);
    } else if (act === "clear-key") {
      const engines = state.config.engines.map((e) =>
        e.id === id ? { id, enabled: e.enabled, apiKey: null } : { id: e.id, enabled: e.enabled },
      );
      await putConfig(engines);
    } else if (act === "save-extra") {
      const input = host.querySelector('.extrainput[data-extra]');
      const key = input.dataset.extra;
      const value = input.value.trim();
      const engines = state.config.engines.map((e) =>
        e.id === id
          ? { id, enabled: e.enabled, extra: { [key]: value ? value : null } }
          : { id: e.id, enabled: e.enabled },
      );
      await putConfig(engines);
    } else if (act === "test-search" || act === "test-fetch") {
      const kind = act === "test-search" ? "search" : "fetch";
      const out = document.querySelector('[data-testout="' + id + '"]');
      out.innerHTML = "… teste …";
      const r = await api("/api/test", { method: "POST", body: { id, kind } });
      if (r.ok) {
        out.innerHTML =
          '<span class="ok">✓ ' +
          (kind === "search" ? r.count + " Ergebnisse" : r.chars + " Zeichen") +
          " · " + r.ms + " ms</span>" +
          (r.preview ? "<pre>" + esc(r.preview) + "</pre>" : "");
      } else {
        out.innerHTML = '<span class="error">✗ ' + esc(r.error) + "</span>";
      }
    }
  } catch (err) {
    if (err.message !== "unauthorized") alert(err.message);
  }
});

async function autoRefresh() {
  try {
    await refreshStatus();
  } catch {
    return;
  }
  for (const st of state.status) {
    document.querySelectorAll('[data-quota="' + st.id + '"]').forEach((el) => {
      el.innerHTML = quotaHtml(st);
    });
  }
}

setInterval(autoRefresh, 30000);
$("#refresh").addEventListener("click", () => load().catch(() => {}));

load().catch((e) => {
  if (e.message !== "unauthorized") {
    $("#notice").textContent = "Fehler: " + e.message;
    $("#notice").classList.remove("hidden");
  }
});
