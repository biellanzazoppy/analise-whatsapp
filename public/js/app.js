// public/js/app.js

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  loading: false,
  routeLabels: {},
};

// ── Init ───────────────────────────────────────────────────────────────────
(async () => {
  try {
    const routes = await api("/api/routes");
    routes.forEach((r) => (state.routeLabels[r.key] = r.label));
    renderRouteList(routes);
  } catch {}
})();

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
});

// ── API helper ─────────────────────────────────────────────────────────────
async function api(url, body) {
  const opts = body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : {};
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json();
}

// ── Sidebar helpers ────────────────────────────────────────────────────────
function renderRouteList(routes) {
  document.getElementById("routeList").innerHTML = routes
    .map((r) => `<li class="route-item"><span class="method-tag">${r.method}</span>${r.label}</li>`)
    .join("");
}

window.toggleVisibility = function (id, btn) {
  const input = document.getElementById(id);
  const isPassword = input.type === "password";
  input.type = isPassword ? "text" : "password";
  btn.style.opacity = isPassword ? "1" : "0.5";
};

// ── Main flow ──────────────────────────────────────────────────────────────
window.run = async function () {
  if (state.loading) return;

  const token = document.getElementById("token").value.trim();
  const wabaId = document.getElementById("wabaId").value.trim();

  if (!token || !wabaId) {
    showError("Preencha o Bearer Token e o WABA ID.");
    return;
  }

  setLoading(true);

  const main = document.getElementById("main");
  main.innerHTML = "";

  // 1. Status: consultando
  const statusEl = createStatusBar("loading", "Consultando APIs...");
  main.appendChild(statusEl);

  let queryResult;
  try {
    queryResult = await api("/api/query", { token, wabaId });
  } catch (err) {
    updateStatusBar(statusEl, "error", `Erro na consulta: ${err.message}`);
    setLoading(false);
    return;
  }

  const successCount = Object.keys(queryResult.data ?? {}).length;
  const failCount = Object.keys(queryResult.errors ?? {}).length;
  const hasErrors = failCount > 0;

  updateStatusBar(
    statusEl,
    hasErrors ? "warn" : "ok",
    `${successCount} rota(s) OK${hasErrors ? `, ${failCount} com erro` : ""}`,
  );

  // 2. Bloco IA — aparece já com cursor piscando
  const aiEl = createAiBlock();
  main.appendChild(aiEl);
  const aiBody = aiEl.querySelector(".ai-body");

  // 3. Cards de dados
  const grid = document.createElement("div");
  grid.className = "data-grid";
  buildDataCards(queryResult, grid);
  main.appendChild(grid);

  // 4. Streaming da análise
  setButtonLabel("Analisando...");

  try {
    await streamAnalysis(queryResult, (text) => {
      appendAiText(aiBody, text);
    });
    aiBody.innerHTML = renderMarkdown(aiBody.dataset.raw ?? "");
  } catch (err) {
    aiBody.innerHTML = `<span style="color:var(--red)">Erro na análise: ${err.message}</span>`;
  }

  setLoading(false);
};

// ── UI factories ───────────────────────────────────────────────────────────
function createStatusBar(type, text) {
  const el = document.createElement("div");
  el.className = "status-bar";
  el.innerHTML = `
    <div class="status-dot ${type}"></div>
    <span class="status-text">${text}</span>
    <span class="status-meta" id="statusMeta"></span>
  `;
  return el;
}

function updateStatusBar(el, type, text) {
  el.querySelector(".status-dot").className = `status-dot ${type}`;
  el.querySelector(".status-text").textContent = text;
}

function createAiBlock() {
  const el = document.createElement("div");
  el.className = "ai-block";
  el.innerHTML = `
    <div class="ai-header">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm0 18a8 8 0 110-16 8 8 0 010 16zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>
      Análise — GPT
    </div>
    <div class="ai-body" data-raw=""><span class="cursor"></span></div>
  `;
  return el;
}

function buildDataCards(queryResult, container) {
  for (const [key, data] of Object.entries(queryResult.data ?? {})) {
    container.appendChild(makeCard(key, data, true));
  }
  for (const [key, err] of Object.entries(queryResult.errors ?? {})) {
    container.appendChild(makeCard(key, err, false));
  }
}

function makeCard(key, data, ok) {
  const label = state.routeLabels[key] ?? key;
  const id = `body-${key}`;
  const el = document.createElement("div");
  el.className = `data-card${ok ? "" : " has-error"}`;
  el.innerHTML = `
    <div class="card-header open" onclick="toggleCard('${key}')">
      <div class="card-label">${label}</div>
      <span class="card-badge ${ok ? "ok" : "fail"}">${ok ? "OK" : "ERRO"}</span>
      <svg class="chevron open" id="chev-${key}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
    <div class="card-body open" id="${id}">
      <pre>${colorizeJson(data)}</pre>
    </div>
  `;
  return el;
}

window.toggleCard = function (key) {
  const body = document.getElementById(`body-${key}`);
  const chev = document.getElementById(`chev-${key}`);
  const header = body.previousElementSibling;
  body.classList.toggle("open");
  chev.classList.toggle("open");
  header.classList.toggle("open");
};

// ── AI streaming ───────────────────────────────────────────────────────────
async function streamAnalysis(queryResult, onChunk) {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ queryResult: { ...queryResult, dbFields: state.dbFields ?? {} } }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? res.statusText);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const payload = JSON.parse(line.slice(6));
        if (payload.done) return;
        if (payload.error) throw new Error(payload.error);
        if (payload.text) onChunk(payload.text);
      } catch (e) {
        if (e.message !== "JSON") throw e;
      }
    }
  }
}

function appendAiText(el, text) {
  el.dataset.raw = (el.dataset.raw ?? "") + text;
  // Renderiza em tempo real com markdown simples
  el.innerHTML = renderMarkdown(el.dataset.raw) + '<span class="cursor"></span>';
}

// ── Markdown básico (negrito, listas, quebras) ─────────────────────────────
function renderMarkdown(text) {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^#{1,3} (.+)$/gm, "<strong>$1</strong>")
    .replace(/^[\-\*] (.+)$/gm, "• $1")
    .replace(/\n/g, "<br>");
}

// ── JSON syntax highlight ──────────────────────────────────────────────────
function colorizeJson(obj) {
  const raw = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return raw
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"([^"]+)":/g, '<span class="jk">"$1"</span>:')
    .replace(/: "([^"]*?)"/g, ': <span class="jv">"$1"</span>')
    .replace(/: (true|false)/g, ': <span class="jb">$1</span>')
    .replace(/: (null)/g, ': <span class="js">$1</span>')
    .replace(/: (-?\d+\.?\d*)/g, ': <span class="jn">$1</span>');
}

// ── Loading state ──────────────────────────────────────────────────────────
function setLoading(on) {
  state.loading = on;
  const btn = document.getElementById("runBtn");
  const spinner = document.getElementById("spinner");
  const icon = btn.querySelector(".btn-icon");
  btn.disabled = on;
  spinner.style.display = on ? "block" : "none";
  icon.style.display = on ? "none" : "block";
  if (!on) setButtonLabel("Consultar e Analisar");
}

function setButtonLabel(text) {
  document.getElementById("btnLabel").textContent = text;
}

function showError(msg) {
  const main = document.getElementById("main");
  main.innerHTML = `<div class="empty"><p style="color:var(--red)">${msg}</p></div>`;
}

// ── DB Fields state ────────────────────────────────────────────────────────
state.dbFields = {};

// ── Drop zone: drag & drop + paste ────────────────────────────────────────
const dropZone = document.getElementById("dropZone");

dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => { e.preventDefault(); dropZone.classList.remove("dragover"); const f = e.dataTransfer.files[0]; if (f) handleFile(f); });

// Colar print com Ctrl+V / Cmd+V
document.addEventListener("paste", (e) => {
  const item = [...e.clipboardData.items].find(i => i.type.startsWith("image/"));
  if (item) handleFile(item.getAsFile());
});

window.handleFile = async function (file) {
  if (!file || !file.type.startsWith("image/")) return;

  setDropState("loading", "Extraindo campos...");

  const base64 = await toBase64(file);
  const imageBase64 = base64.split(",")[1];

  try {
    const res = await fetch("/api/extract-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64, mimeType: file.type }),
    });

    const json = await res.json();

    if (!res.ok || json.error) {
      setDropState("idle", `Erro: ${json.error}`);
      return;
    }

    state.dbFields = json.fields;
    renderDbFields(json.fields);
    setDropState("done", "Campos extraídos ✓");
  } catch (e) {
    setDropState("idle", "Erro ao processar imagem.");
  }
};

function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function setDropState(state, label) {
  const dz = document.getElementById("dropZone");
  dz.classList.remove("loading", "done", "dragover");
  if (state === "loading") dz.classList.add("loading");
  if (state === "done") dz.classList.add("done");
  document.getElementById("dropLabel").textContent = label;
}

function renderDbFields(fields) {
  const keys = ["businessName","scenario","status","syncAttempt","errorMessage","active","qualityRating","phoneStatus"];
  keys.forEach(k => {
    const el = document.getElementById(`f-${k}`);
    if (el) el.textContent = fields[k] != null ? String(fields[k]) : "—";
  });
  document.getElementById("dbFields").style.display = "block";
}

window.clearDb = function () {
  state.dbFields = {};
  const keys = ["businessName","scenario","status","syncAttempt","errorMessage","active","qualityRating","phoneStatus"];
  keys.forEach(k => { const el = document.getElementById(`f-${k}`); if (el) el.textContent = "—"; });
  document.getElementById("dbFields").style.display = "none";
  setDropState("idle", "Cole ou selecione um print do banco");
  document.getElementById("fileInput").value = "";
};
