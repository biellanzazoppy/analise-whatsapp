// public/js/app.js

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  loading: false,
  routeLabels: {},
  dbFields: {},
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

  console.log("[run] iniciando consulta para wabaId:", wabaId);
  setLoading(true);

  const dataPanel = document.getElementById("dataPanel");
  const aiBody = document.getElementById("aiBody");

  // Reset UI
  document.getElementById("emptyState").style.display = "none";
  aiBody.dataset.raw = "";
  aiBody.innerHTML = '<span class="cursor"></span>';

  // Remove cards anteriores
  const oldGrid = document.getElementById("dataGrid");
  if (oldGrid) oldGrid.remove();
  const oldStatus = document.getElementById("statusBar");
  if (oldStatus) oldStatus.remove();

  // 1. Status bar
  const statusEl = createStatusBar("loading", "Consultando APIs...");
  statusEl.id = "statusBar";
  dataPanel.appendChild(statusEl);

  let queryResult;
  try {
    console.log("[run] chamando /api/query...");
    queryResult = await api("/api/query", { token, wabaId });
    console.log("[run] queryResult recebido:", queryResult);
  } catch (err) {
    console.error("[run] erro em /api/query:", err.message);
    updateStatusBar(statusEl, "error", `Erro na consulta: ${err.message}`);
    setLoading(false);
    return;
  }

  const successCount = Object.keys(queryResult.data ?? {}).length;
  const failCount = Object.keys(queryResult.errors ?? {}).length;
  console.log("[run] rotas OK:", successCount, "| com erro:", failCount);
  updateStatusBar(
    statusEl,
    failCount > 0 ? "warn" : "ok",
    `${successCount} rota(s) OK${failCount > 0 ? `, ${failCount} com erro` : ""}`
  );

  // 2. Cards de dados
  const grid = document.createElement("div");
  grid.className = "data-grid";
  grid.id = "dataGrid";
  buildDataCards(queryResult, grid);
  dataPanel.appendChild(grid);

  // 3. Stream da IA
  setButtonLabel("Analisando...");
  console.log("[run] iniciando streamAnalysis...");

  try {
    await streamAnalysis(queryResult, (text) => {
      console.log("[onChunk] texto recebido:", JSON.stringify(text), "| raw acumulado:", aiBody.dataset.raw.length + text.length, "chars");
      aiBody.dataset.raw += text;
      aiBody.innerHTML = renderMarkdown(aiBody.dataset.raw) + '<span class="cursor"></span>';
      console.log("[onChunk] innerHTML atualizado, tamanho:", aiBody.innerHTML.length);
    });
    console.log("[run] stream finalizado. raw.length:", aiBody.dataset.raw.length);
    aiBody.innerHTML = renderMarkdown(aiBody.dataset.raw ?? "");
    if (!aiBody.dataset.raw) {
      aiBody.innerHTML = '<span class="ai-placeholder">Nenhum conteúdo recebido da IA.</span>';
    }
  } catch (err) {
    console.error("[run] erro no stream:", err.message);
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
  `;
  return el;
}

function updateStatusBar(el, type, text) {
  el.querySelector(".status-dot").className = `status-dot ${type}`;
  el.querySelector(".status-text").textContent = text;
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
  console.log("[stream] chamando POST /api/analyze...");
  const body = JSON.stringify({ queryResult: { ...queryResult, dbFields: state.dbFields ?? {} } });
  console.log("[stream] body size:", body.length, "chars");

  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  console.log("[stream] resposta HTTP:", res.status, res.statusText, "| ok:", res.ok);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error("[stream] erro HTTP:", err);
    throw new Error(err.error ?? res.statusText);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let chunkCount = 0;

  console.log("[stream] iniciando leitura SSE...");

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      console.log("[stream] reader.done=true. chunks processados:", chunkCount);
      break;
    }

    chunkCount++;
    const raw = decoder.decode(value, { stream: true });
    console.log(`[stream] chunk #${chunkCount} (${raw.length} bytes):`, JSON.stringify(raw.slice(0, 200)));

    buffer += raw;
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      console.log("[stream] linha SSE:", line);
      try {
        const payload = JSON.parse(line.slice(6));
        console.log("[stream] payload parseado:", payload);
        if (payload.done) {
          console.log("[stream] payload.done=true → encerrando");
          return;
        }
        if (payload.error) {
          console.error("[stream] payload.error:", payload.error);
          throw new Error(payload.error);
        }
        if (payload.text) {
          console.log("[stream] chamando onChunk com:", JSON.stringify(payload.text));
          onChunk(payload.text);
        }
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
        console.warn("[stream] SyntaxError ao parsear linha, ignorando:", line);
      }
    }
  }
}

// ── Markdown ───────────────────────────────────────────────────────────────
function renderMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "§STRONG§$1§/STRONG§")
    .replace(/^#{1,3} (.+)$/gm, "§STRONG§$1§/STRONG§")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/§STRONG§(.+?)§\/STRONG§/g, "<strong>$1</strong>")
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
  const emptyState = document.getElementById("emptyState");
  emptyState.style.display = "flex";
  emptyState.querySelector("p").style.color = "var(--red)";
  emptyState.querySelector("p").textContent = msg;
}

// ── DB Fields ──────────────────────────────────────────────────────────────
const dropZone = document.getElementById("dropZone");

dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => { e.preventDefault(); dropZone.classList.remove("dragover"); const f = e.dataTransfer.files[0]; if (f) handleFile(f); });

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

function setDropState(st, label) {
  const dz = document.getElementById("dropZone");
  dz.classList.remove("loading", "done", "dragover");
  if (st === "loading") dz.classList.add("loading");
  if (st === "done") dz.classList.add("done");
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