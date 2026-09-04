"use strict";

const $ = (s) => document.querySelector(s);

const state = { meta: null, config: null, status: [], dragFrom: null, historyOpen: new Set() };

/* ---------- i18n ---------- */

const I18N = {
  de: {
    "sub.text": "Round-Robin-Websuche über Gratis-Kontingente",
    "search.title": "Such-Rotation",
    "search.subtitle": "Reihenfolge per Drag & Drop — Round Robin startet oben",
    "fetch.title": "Fetch-Rotation",
    "fetch.subtitle": "Seiten abrufen / als Markdown extracten",
    "setup.title": "MCP-Setup",
    "snippet.remote": "Remote (Streamable HTTP)",
    "btn.copy": "Kopieren",
    "btn.copied": "Kopiert ✓",
    "btn.save": "Speichern",
    "btn.refresh": "Jetzt aktualisieren",
    "btn.testSearch": "Suche testen",
    "btn.testFetch": "Fetch testen",
    "key.clear": "Key löschen",
    "key.replace": "Key ersetzen (leer = unverändert) · aktuell: {masked}",
    "key.set": "API-Key hinterlegen",
    "extra.set": "(gesetzt)",
    "signup": "Gratis-Key ↗",
    "test.running": "… teste …",
    "test.okSearch": "{count} Ergebnisse · {ms} ms",
    "test.okFetch": "{chars} Zeichen · {ms} ms",
    "badge.keyless": "ohne Key nutzbar",
    "badge.quota": "Quota-API",
    "cap.search": "Suche",
    "cap.fetch": "Fetch",
    "quota.local": "{used} / {limit} (lokal gezählt)",
    "quota.remote": "{used} / {limit} (remote)",
    "quota.none": "kein festes Kontingent",
    "quota.error": "Remote-Quota: {error}",
    "notice.nokeys": "Hinweis: Noch kein API-Key hinterlegt. Ohne Keys laufen nur die IP-basierten Engines (Firecrawl, Jina, DuckDuckGo) — und meist nur wenige Requests. Empfehlung: Tavily, Parallel und Exa registrieren (kostenlos, Links auf den Karten).",
    "history.title": "Verlauf",
    "history.subtitle": "Suchanfragen & Fetches · aktualisiert alle 5 s",
    "history.clear": "Verlauf leeren",
    "history.confirm": "Verlauf wirklich leeren?",
    "history.empty": "Noch keine Einträge.",
    "hist.search": "Suche",
    "hist.fetch": "Fetch",
    "hist.failed": "fehlgeschlagen",
    "hist.results": "{n} Treffer",
    "hist.chars": "{n} Zeichen",
    "hist.attempts": "Versuchs-Kette",
    "active": "aktiv",
    "fetch.inactive": "inaktiv (Schalter in der Such-Sektion)",
    "footer.quota": "Quota-Zähler: lokal pro Kalendermonat · Remote-Quota wo verfügbar (5 Min Cache)",
    "footer.auto": "Verlauf: Poll alle 5 s · Quotas: alle 30 s",
    "api.unauthorized": "401 — diese Dashboard-URL mit <code>?token=…</code> öffnen (steht im Server-Log).",
  },
  en: {
    "sub.text": "Round-robin web search across free-tier quotas",
    "search.title": "Search rotation",
    "search.subtitle": "Drag & drop to reorder — round robin starts at the top",
    "fetch.title": "Fetch rotation",
    "fetch.subtitle": "Fetch pages / extract as markdown",
    "setup.title": "MCP setup",
    "snippet.remote": "Remote (Streamable HTTP)",
    "btn.copy": "Copy",
    "btn.copied": "Copied ✓",
    "btn.save": "Save",
    "btn.refresh": "Refresh now",
    "btn.testSearch": "Test search",
    "btn.testFetch": "Test fetch",
    "key.clear": "Delete key",
    "key.replace": "Replace key (empty = keep current) · current: {masked}",
    "key.set": "Enter API key",
    "extra.set": "(set)",
    "signup": "Free key ↗",
    "test.running": "… testing …",
    "test.okSearch": "{count} results · {ms} ms",
    "test.okFetch": "{chars} chars · {ms} ms",
    "badge.keyless": "works without key",
    "badge.quota": "Quota API",
    "cap.search": "search",
    "cap.fetch": "fetch",
    "quota.local": "{used} / {limit} (counted locally)",
    "quota.remote": "{used} / {limit} (remote)",
    "quota.none": "no fixed quota",
    "quota.error": "Remote quota: {error}",
    "notice.nokeys": "Note: No API key stored yet. Without keys only the IP-based engines (Firecrawl, Jina, DuckDuckGo) work — usually just a few requests. Recommended: register Tavily, Parallel and Exa (free, links on the cards).",
    "history.title": "History",
    "history.subtitle": "Searches & fetches · refreshed every 5 s",
    "history.clear": "Clear history",
    "history.confirm": "Really clear the history?",
    "history.empty": "No entries yet.",
    "hist.search": "Search",
    "hist.fetch": "Fetch",
    "hist.failed": "failed",
    "hist.results": "{n} results",
    "hist.chars": "{n} chars",
    "hist.attempts": "Attempt chain",
    "active": "active",
    "fetch.inactive": "inactive (toggle in the search section)",
    "footer.quota": "Quota counters: local per calendar month · remote quota where available (5 min cache)",
    "footer.auto": "History: 5 s polling · quotas: every 30 s",
    "api.unauthorized": "401 — open this dashboard URL with <code>?token=…</code> (see server log).",
  },
  zh: {
    "sub.text": "在多个免费配额之间轮询搜索",
    "search.title": "搜索轮换",
    "search.subtitle": "拖拽排序 — 轮询从最上方开始",
    "fetch.title": "抓取轮换",
    "fetch.subtitle": "抓取网页 / 提取为 Markdown",
    "setup.title": "MCP 配置",
    "snippet.remote": "远程（Streamable HTTP）",
    "btn.copy": "复制",
    "btn.copied": "已复制 ✓",
    "btn.save": "保存",
    "btn.refresh": "立即刷新",
    "btn.testSearch": "测试搜索",
    "btn.testFetch": "测试抓取",
    "key.clear": "删除密钥",
    "key.replace": "替换密钥（留空 = 保持不变）· 当前：{masked}",
    "key.set": "输入 API 密钥",
    "extra.set": "（已设置）",
    "signup": "免费密钥 ↗",
    "test.running": "… 测试中 …",
    "test.okSearch": "{count} 条结果 · {ms} 毫秒",
    "test.okFetch": "{chars} 字符 · {ms} 毫秒",
    "badge.keyless": "无需密钥",
    "badge.quota": "配额 API",
    "cap.search": "搜索",
    "cap.fetch": "抓取",
    "quota.local": "{used} / {limit}（本地计数）",
    "quota.remote": "{used} / {limit}（远程）",
    "quota.none": "无固定配额",
    "quota.error": "远程配额：{error}",
    "notice.nokeys": "提示：尚未保存任何 API 密钥。没有密钥时只有基于 IP 的引擎（Firecrawl、Jina、DuckDuckGo）可用——通常次数很少。建议注册 Tavily、Parallel 和 Exa（免费，见各卡片链接）。",
    "history.title": "历史记录",
    "history.subtitle": "搜索与抓取 · 每 5 秒刷新",
    "history.clear": "清空历史",
    "history.confirm": "确定要清空历史吗？",
    "history.empty": "暂无记录。",
    "hist.search": "搜索",
    "hist.fetch": "抓取",
    "hist.failed": "失败",
    "hist.results": "{n} 条结果",
    "hist.chars": "{n} 字符",
    "hist.attempts": "尝试链",
    "active": "启用",
    "fetch.inactive": "停用（在搜索区切换）",
    "footer.quota": "配额计数：按自然月本地统计 · 可用时会拉取远程配额（5 分钟缓存）",
    "footer.auto": "历史：每 5 秒轮询 · 配额：每 30 秒",
    "api.unauthorized": "401 — 请使用带 <code>?token=…</code> 的地址打开此面板（见服务器日志）。",
  },
  hi: {
    "sub.text": "निःशुल्क कोटा में राउंड-रॉबिन वेब खोज",
    "search.title": "खोज रोटेशन",
    "search.subtitle": "क्रम बदलने के लिए ड्रैग करें — राउंड रॉबिन ऊपर से शुरू",
    "fetch.title": "फ़ेच रोटेशन",
    "fetch.subtitle": "पेज प्राप्त करें / Markdown में निकालें",
    "setup.title": "MCP सेटअप",
    "snippet.remote": "रिमोट (Streamable HTTP)",
    "btn.copy": "कॉपी",
    "btn.copied": "कॉपी हो गया ✓",
    "btn.save": "सहेजें",
    "btn.refresh": "अभी रीफ़्रेश करें",
    "btn.testSearch": "खोज परीक्षण",
    "btn.testFetch": "फ़ेच परीक्षण",
    "key.clear": "कुंजी हटाएँ",
    "key.replace": "कुंजी बदलें (खाली = अपरिवर्तित) · वर्तमान: {masked}",
    "key.set": "API कुंजी दर्ज करें",
    "extra.set": "(सेट)",
    "signup": "निःशुल्क कुंजी ↗",
    "test.running": "… परीक्षण चल रहा है …",
    "test.okSearch": "{count} परिणाम · {ms} ms",
    "test.okFetch": "{chars} अक्षर · {ms} ms",
    "badge.keyless": "कुंजी के बिना चलता है",
    "badge.quota": "कोटा API",
    "cap.search": "खोज",
    "cap.fetch": "फ़ेच",
    "quota.local": "{used} / {limit} (स्थानीय गणना)",
    "quota.remote": "{used} / {limit} (रिमोट)",
    "quota.none": "कोई निश्चित कोटा नहीं",
    "quota.error": "रिमोट कोटा: {error}",
    "notice.nokeys": "नोट: अभी कोई API कुंजी संग्रहीत नहीं है। कुंजी के बिना केवल IP-आधारित इंजन (Firecrawl, Jina, DuckDuckGo) चलते हैं — और आमतौर पर कुछ ही अनुरोध। अनुशंसा: Tavily, Parallel और Exa पंजीकृत करें (निःशुल्क, कार्ड पर लिंक)।",
    "history.title": "इतिहास",
    "history.subtitle": "खोजें और फ़ेच · हर 5 सेकंड में अपडेट",
    "history.clear": "इतिहास साफ़ करें",
    "history.confirm": "क्या वाकई इतिहास साफ़ करना है?",
    "history.empty": "अभी कोई प्रविष्टि नहीं।",
    "hist.search": "खोज",
    "hist.fetch": "फ़ेच",
    "hist.failed": "विफल",
    "hist.results": "{n} परिणाम",
    "hist.chars": "{n} अक्षर",
    "hist.attempts": "प्रयास श्रृंखला",
    "active": "सक्रिय",
    "fetch.inactive": "निष्क्रिय (खोज अनुभाग में स्विच करें)",
    "footer.quota": "कोटा गणना: स्थानीय कैलेंडर माह प्रति · रिमोट कोटा जहाँ उपलब्ध (5 मिनट कैश)",
    "footer.auto": "इतिहास: हर 5 सेकंड पोल · कोटा: हर 30 सेकंड",
    "api.unauthorized": "401 — इस डैशबोर्ड URL को <code>?token=…</code> के साथ खोलें (सर्वर लॉग में है)।",
  },
  es: {
    "sub.text": "Búsqueda web round-robin entre cuotas gratuitas",
    "search.title": "Rotación de búsqueda",
    "search.subtitle": "Arrastra para ordenar — el round robin empieza arriba",
    "fetch.title": "Rotación de fetch",
    "fetch.subtitle": "Obtener páginas / extraer como markdown",
    "setup.title": "Configuración MCP",
    "snippet.remote": "Remoto (Streamable HTTP)",
    "btn.copy": "Copiar",
    "btn.copied": "Copiado ✓",
    "btn.save": "Guardar",
    "btn.refresh": "Actualizar ahora",
    "btn.testSearch": "Probar búsqueda",
    "btn.testFetch": "Probar fetch",
    "key.clear": "Eliminar clave",
    "key.replace": "Reemplazar clave (vacío = sin cambios) · actual: {masked}",
    "key.set": "Introducir clave API",
    "extra.set": "(configurado)",
    "signup": "Clave gratis ↗",
    "test.running": "… probando …",
    "test.okSearch": "{count} resultados · {ms} ms",
    "test.okFetch": "{chars} caracteres · {ms} ms",
    "badge.keyless": "funciona sin clave",
    "badge.quota": "API de cuota",
    "cap.search": "búsqueda",
    "cap.fetch": "fetch",
    "quota.local": "{used} / {limit} (conteo local)",
    "quota.remote": "{used} / {limit} (remoto)",
    "quota.none": "sin cuota fija",
    "quota.error": "Cuota remota: {error}",
    "notice.nokeys": "Aviso: aún no hay claves API guardadas. Sin claves solo funcionan los motores basados en IP (Firecrawl, Jina, DuckDuckGo) y normalmente pocas peticiones. Recomendación: regístrate en Tavily, Parallel y Exa (gratis, enlaces en las tarjetas).",
    "history.title": "Historial",
    "history.subtitle": "Búsquedas y fetches · actualizado cada 5 s",
    "history.clear": "Borrar historial",
    "history.confirm": "¿Seguro que quieres borrar el historial?",
    "history.empty": "Aún no hay entradas.",
    "hist.search": "Búsqueda",
    "hist.fetch": "Fetch",
    "hist.failed": "fallido",
    "hist.results": "{n} resultados",
    "hist.chars": "{n} caracteres",
    "hist.attempts": "Cadena de intentos",
    "active": "activo",
    "fetch.inactive": "inactivo (interruptor en la sección de búsqueda)",
    "footer.quota": "Contadores de cuota: local por mes natural · cuota remota cuando está disponible (caché 5 min)",
    "footer.auto": "Historial: cada 5 s · cuotas: cada 30 s",
    "api.unauthorized": "401 — abre esta URL del panel con <code>?token=…</code> (está en el log del servidor).",
  },
  fr: {
    "sub.text": "Recherche web round-robin sur les quotas gratuits",
    "search.title": "Rotation de recherche",
    "search.subtitle": "Glisser-déposer pour réordonner — le round robin commence en haut",
    "fetch.title": "Rotation de récupération",
    "fetch.subtitle": "Récupérer des pages / extraire en markdown",
    "setup.title": "Configuration MCP",
    "snippet.remote": "Distant (Streamable HTTP)",
    "btn.copy": "Copier",
    "btn.copied": "Copié ✓",
    "btn.save": "Enregistrer",
    "btn.refresh": "Actualiser maintenant",
    "btn.testSearch": "Tester la recherche",
    "btn.testFetch": "Tester le fetch",
    "key.clear": "Supprimer la clé",
    "key.replace": "Remplacer la clé (vide = inchangée) · actuelle : {masked}",
    "key.set": "Saisir la clé API",
    "extra.set": "(défini)",
    "signup": "Clé gratuite ↗",
    "test.running": "… test en cours …",
    "test.okSearch": "{count} résultats · {ms} ms",
    "test.okFetch": "{chars} caractères · {ms} ms",
    "badge.keyless": "sans clé",
    "badge.quota": "API de quota",
    "cap.search": "recherche",
    "cap.fetch": "fetch",
    "quota.local": "{used} / {limit} (compté localement)",
    "quota.remote": "{used} / {limit} (distant)",
    "quota.none": "pas de quota fixe",
    "quota.error": "Quota distant : {error}",
    "notice.nokeys": "Remarque : aucune clé API enregistrée. Sans clés, seuls les moteurs basés sur IP fonctionnent (Firecrawl, Jina, DuckDuckGo) — et rarement plus de quelques requêtes. Recommandé : inscrivez-vous sur Tavily, Parallel et Exa (gratuit, liens sur les cartes).",
    "history.title": "Historique",
    "history.subtitle": "Recherches et fetchs · actualisé toutes les 5 s",
    "history.clear": "Vider l'historique",
    "history.confirm": "Vider vraiment l'historique ?",
    "history.empty": "Aucune entrée pour le moment.",
    "hist.search": "Recherche",
    "hist.fetch": "Fetch",
    "hist.failed": "échec",
    "hist.results": "{n} résultats",
    "hist.chars": "{n} caractères",
    "hist.attempts": "Chaîne d'essais",
    "active": "actif",
    "fetch.inactive": "inactif (interrupteur dans la section recherche)",
    "footer.quota": "Compteurs de quota : local par mois calendaire · quota distant si disponible (cache 5 min)",
    "footer.auto": "Historique : toutes les 5 s · quotas : toutes les 30 s",
    "api.unauthorized": "401 — ouvrez cette URL du tableau de bord avec <code>?token=…</code> (voir journal du serveur).",
  },
};

let lang = localStorage.getItem("sr_lang") || (navigator.language || "de").slice(0, 2).toLowerCase();
if (!I18N[lang]) lang = "de";

function t(key, vars) {
  let s = (I18N[lang] && I18N[lang][key]) || I18N.de[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll("{" + k + "}", String(v));
  }
  return s;
}

function applyI18n() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  $("#lang").value = lang;
}

/* ---------- helpers ---------- */

function esc(s) {
  const d = document.createElement("div");
  d.textContent = String(s ?? "");
  return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const params = new URLSearchParams(location.search);
if (params.get("token")) {
  localStorage.setItem("sr_token", params.get("token"));
  params.delete("token");
  history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params.toString() : ""));
}

async function api(path, opts = {}) {
  const token = localStorage.getItem("sr_token") || "";
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    document.body.innerHTML = '<main><p class="error">' + t("api.unauthorized") + "</p></main>";
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
  loadHistory().catch(() => {});
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
    '<span class="bar-label">' + esc(label) + " · " + pct + "%</span>"
  );
}

function quotaHtml(st) {
  if (!st || !st.id) return "";
  if (st.remoteError) return '<span class="quota-err">' + esc(t("quota.error", { error: st.remoteError })) + "</span>";
  if (st.remote && st.remote.limit) {
    const rem = st.remote.remaining !== undefined ? st.remote.remaining : st.remote.limit - (st.remote.used || 0);
    return bar(
      Math.max(0, Math.round((100 * rem) / st.remote.limit)),
      t("quota.remote", { used: st.remote.used ?? "?", limit: st.remote.limit }),
    );
  }
  if (st.monthlyLimit > 0) {
    const used = (st.used?.search || 0) + (st.used?.fetch || 0);
    return bar(
      Math.max(0, Math.round((100 * (st.monthlyLimit - used)) / st.monthlyLimit)),
      t("quota.local", { used, limit: st.monthlyLimit }),
    );
  }
  return '<span class="quota-free">' + esc(t("quota.none")) + "</span>";
}

let putChain = Promise.resolve();
/**
 * PUTs serialisieren; der bodyBuilder läuft erst zur Ausführungszeit gegen
 * den dann aktuellen state.config — schnelle Klicks überschreiben sich so
 * nicht mehr gegenseitig mit Stale-Snapshots.
 */
function queuePut(bodyBuilder) {
  putChain = putChain
    .then(() => api("/api/config", { method: "PUT", body: bodyBuilder(state.config) }))
    .then((r) => {
      state.config = r.config;
      render();
    })
    .catch((err) => {
      if (err.message !== "unauthorized") alert(err.message);
    });
  return putChain;
}

/* ---------- rendering ---------- */

function render() {
  applyI18n();
  $("#version").textContent = "v" + state.meta.version;
  $("#configpath").textContent = state.meta.configPath;

  const anyKey = (state.config.engines || []).some((e) => e.hasKey);
  const notice = $("#notice");
  if (!anyKey) {
    notice.textContent = t("notice.nokeys");
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
  // Ungespeicherte Eingaben über das Re-Render retten (render() läuft auch bei fremden PUT-Responses)
  const saved = {};
  wrap.querySelectorAll(".keyinput").forEach((el) => {
    if (el.value) saved["key:" + el.dataset.id] = el.value;
  });
  wrap.querySelectorAll(".extrainput").forEach((el) => {
    if (el.value) saved["extra:" + el.dataset.id + ":" + el.dataset.extra] = el.value;
  });
  wrap.innerHTML = "";
  for (const e of state.config.engines) {
    const m = metaOf(e.id);
    const st = statusOf(e.id);

    const card = document.createElement("div");
    card.className = "card" + (e.enabled ? "" : " off");
    card.draggable = true;
    card.dataset.id = e.id;

    const caps = (m.capabilities || []).map((c) => t("cap." + c)).join(" · ");
    const head = document.createElement("div");
    head.className = "head";
    head.innerHTML =
      '<span class="handle" title="Drag">≡</span>' +
      '<label class="switch"><input type="checkbox" data-act="toggle"' + (e.enabled ? " checked" : "") +
      '><span></span></label>' +
      '<span class="name">' + esc(m.label || e.id) + "</span>" +
      (m.keyless === "ip" ? '<span class="badge ip">' + esc(t("badge.keyless")) + "</span>" : "") +
      (m.quotaEndpoint ? '<span class="badge quota">' + esc(t("badge.quota")) + "</span>" : "") +
      '<span class="caps">' + esc(caps) + "</span>";
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
      (e.hasKey ? esc(t("key.replace", { masked: e.keyMasked })) : esc(t("key.set"))) +
      '">' +
      '<button data-act="save-key">' + esc(t("btn.save")) + "</button>" +
      (e.hasKey ? '<button data-act="clear-key" title="' + esc(t("key.clear")) + '">✕</button>' : "") +
      '<button data-act="test-search">' + esc(t("btn.testSearch")) + "</button>" +
      '<a class="signup" href="' + esc(m.signupUrl || m.homepage || "#") + '" target="_blank" rel="noreferrer">' + esc(t("signup")) + "</a>";
    card.appendChild(keyRow);

    for (const f of m.extraFields || []) {
      const row = document.createElement("div");
      row.className = "keyrow extra";
      row.innerHTML =
        '<input type="text" class="extrainput" data-id="' + esc(e.id) + '" data-extra="' + esc(f.key) +
        '" placeholder="' + esc(f.label) + (e.extrasSet && e.extrasSet[f.key] ? " " + esc(t("extra.set")) : "") + '">' +
        '<button data-act="save-extra">' + esc(t("btn.save")) + "</button>";
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
  // Gesicherte Eingaben zurückschreiben
  wrap.querySelectorAll(".keyinput").forEach((el) => {
    const v = saved["key:" + el.dataset.id];
    if (v) el.value = v;
  });
  wrap.querySelectorAll(".extrainput").forEach((el) => {
    const v = saved["extra:" + el.dataset.id + ":" + el.dataset.extra];
    if (v) el.value = v;
  });
  enableDrag(wrap, (from, to) => {
    const ids = state.config.engines.map((e) => e.id);
    reorder(ids, from, to);
    queuePut((cfg) => ({
      engines: ids.map((id) => ({ id, enabled: cfg.engines.find((x) => x.id === id).enabled })),
      fetchOrder: cfg.fetchOrder,
      settings: { port: cfg.settings.port },
    }));
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
      '<span class="caps">' + esc(e.enabled ? t("active") : t("fetch.inactive")) + "</span>" +
      '<span class="quota-inline" data-quota="' + esc(id) + '">' + quotaHtml(st) + "</span>" +
      '<button data-act="test-fetch">' + esc(t("btn.testFetch")) + "</button>";
    wrap.appendChild(row);
  }
  enableDrag(wrap, (from, to) => {
    const order = [...state.config.fetchOrder];
    reorder(order, from, to);
    queuePut((cfg) => ({
      engines: cfg.engines.map((e) => ({ id: e.id, enabled: e.enabled })),
      fetchOrder: order,
      settings: { port: cfg.settings.port },
    }));
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
    "URL: " + remoteUrl + "\n" + "Authorization: Bearer <token>";
}

/* ---------- history ---------- */

async function loadHistory() {
  const data = await api("/api/history?limit=50");
  renderHistory(data.entries || []);
}

function renderHistory(entries) {
  const wrap = $("#history-list");
  if (!entries.length) {
    wrap.innerHTML = '<span class="muted">' + esc(t("history.empty")) + "</span>";
    return;
  }
  wrap.innerHTML = "";
  for (const e of entries) {
    const key = e.ts;
    const det = document.createElement("details");
    det.className = "hist" + (e.ok ? "" : " fail");
    det.dataset.key = key;
    if (state.historyOpen.has(key)) det.open = true;
    det.addEventListener("toggle", () => {
      if (det.open) state.historyOpen.add(key);
      else state.historyOpen.delete(key);
    });

    const failChips = (e.attempts || [])
      .filter((a) => !a.ok)
      .map((a) => '<span class="chip fail" title="' + esc(a.error || "") + '">' + esc(a.engine) + "</span>")
      .join("");
    const engineHtml =
      (e.engine ? '<span class="chip ok">' + esc(e.engine) + "</span>" : "") + failChips;
    const meta =
      e.ok && e.kind === "search" && e.result?.count !== undefined
        ? t("hist.results", { n: e.result.count })
        : e.ok && e.result?.chars !== undefined
          ? t("hist.chars", { n: e.result.chars })
          : "";

    const summary = document.createElement("summary");
    summary.innerHTML =
      '<span class="htime">' + esc(new Date(e.ts).toLocaleTimeString()) + "</span>" +
      '<span class="hkind ' + esc(e.kind) + '">' + esc(t(e.kind === "search" ? "hist.search" : "hist.fetch")) + "</span>" +
      '<span class="hinput" title="' + esc(e.input) + '">' + esc(e.input) + "</span>" +
      engineHtml +
      (e.ok
        ? '<span class="ok">' + esc(meta) + " · " + esc(e.ms) + " ms</span>"
        : '<span class="error">' + esc(t("hist.failed")) + " · " + esc(e.ms) + " ms</span>");
    det.appendChild(summary);

    const body = document.createElement("div");
    body.className = "histbody";
    let html = "";
    if (e.error) html += '<p class="error">' + esc(e.error) + "</p>";
    if ((e.attempts || []).length) {
      html +=
        "<p><strong>" + esc(t("hist.attempts")) + ":</strong></p><ul class='att'>" +
        e.attempts
          .map((a) => "<li>" + esc(a.engine) + " — " + (a.ok ? "✓" : "✗ " + esc(a.error || "")) + " (" + a.ms + " ms)</li>")
          .join("") +
        "</ul>";
    }
    if (e.result?.items?.length) {
      html +=
        "<ul class='hitems'>" +
        e.result.items
          .map(
            (i) =>
              "<li><a href='" + esc(i.url) + "' target='_blank' rel='noreferrer'>" + esc(i.title || i.url) + "</a>" +
              (i.snippet ? "<span class='muted'> — " + esc(i.snippet.slice(0, 200)) + "</span>" : "") + "</li>",
          )
          .join("") +
        "</ul>";
    }
    if (e.result?.markdown) html += "<pre>" + esc(e.result.markdown.slice(0, 2000)) + "</pre>";
    body.innerHTML = html;
    det.appendChild(body);
    wrap.appendChild(det);
  }
}

/* ---------- drag & drop ---------- */

function enableDrag(container, onReorder) {
  // Idempotent: Listener nur EINMAL pro Container registrieren (Re-Renders
  // aktualisieren nur den Callback) — sonst akkumulieren Listener pro Render.
  if (container.__dragInit) {
    container.__dragOnReorder = onReorder;
    return;
  }
  container.__dragInit = true;
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
    if (toEl && from && from !== toEl.dataset.id && container.__dragOnReorder) {
      container.__dragOnReorder(from, toEl.dataset.id);
    }
  });
}

function reorder(list, from, to) {
  const i = list.indexOf(from);
  const j = list.indexOf(to);
  if (i < 0 || j < 0) return;
  list.splice(j, 0, list.splice(i, 1)[0]);
}

/* ---------- events ---------- */

$("#lang").addEventListener("change", (ev) => {
  lang = ev.target.value;
  localStorage.setItem("sr_lang", lang);
  applyI18n();
  render();
  loadHistory().catch(() => {});
});

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
    copyBtn.textContent = t("btn.copied");
    setTimeout(() => (copyBtn.textContent = t("btn.copy")), 1500);
    return;
  }

  if (ev.target.closest("#history-clear")) {
    if (confirm(t("history.confirm"))) {
      await api("/api/history", { method: "DELETE" });
      state.historyOpen.clear();
      loadHistory().catch(() => {});
    }
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
      const input = host.querySelector(".extrainput[data-extra]");
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
      out.innerHTML = esc(t("test.running"));
      const r = await api("/api/test", { method: "POST", body: { id, kind } });
      if (r.ok) {
        out.innerHTML =
          '<span class="ok">✓ ' +
          esc(kind === "search" ? t("test.okSearch", { count: r.count, ms: r.ms }) : t("test.okFetch", { chars: r.chars, ms: r.ms })) +
          "</span>" +
          (r.preview ? "<pre>" + esc(r.preview) + "</pre>" : "");
      } else {
        out.innerHTML = '<span class="error">✗ ' + esc(r.error) + "</span>";
      }
    }
  } catch (err) {
    if (err.message !== "unauthorized") alert(err.message);
  }
});

async function autoRefreshQuotas() {
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

setInterval(() => {
  if (!document.hidden) loadHistory().catch(() => {});
}, 5000);
setInterval(() => {
  if (!document.hidden) autoRefreshQuotas();
}, 30000);
$("#refresh").addEventListener("click", () => load().catch(() => {}));

load().catch((e) => {
  if (e.message !== "unauthorized") {
    $("#notice").textContent = "Fehler: " + e.message;
    $("#notice").classList.remove("hidden");
  }
});
