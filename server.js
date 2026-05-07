// server.js
require("dotenv").config();

const express = require("express");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { queryAll, ROUTES } = require("./src/queryService");
const { analyzeWithStream } = require("./src/aiService");

const app = express();

// ── Segurança: headers HTTP ────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
    },
  },
}));

// ── Segurança: rate limiting ───────────────────────────────────────────────
const queryLimit = rateLimit({
  windowMs: 60 * 1000,       // janela de 1 minuto
  max: 20,                   // máx 20 consultas por IP por minuto
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas requisições. Aguarde 1 minuto." },
});

const analyzeLimit = rateLimit({
  windowMs: 60 * 1000,       // janela de 1 minuto
  max: 10,                   // máx 10 análises por IP por minuto (custo OpenAI)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas análises solicitadas. Aguarde 1 minuto." },
});

// ── Middlewares ────────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── GET /api/routes ────────────────────────────────────────────────────────
app.get("/api/routes", (_, res) => {
  res.json(ROUTES.map(({ key, label, method }) => ({ key, label, method })));
});

// ── POST /api/query ────────────────────────────────────────────────────────
app.post("/api/query", queryLimit, async (req, res) => {
  const { token, wabaId } = req.body ?? {};
  if (!token?.trim() || !wabaId?.trim()) {
    return res.status(400).json({ error: "token e wabaId são obrigatórios." });
  }
  try {
    const result = await queryAll(token.trim(), wabaId.trim());
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/analyze ──────────────────────────────────────────────────────
app.post("/api/analyze", analyzeLimit, async (req, res) => {
  const { queryResult } = req.body ?? {};

  if (!queryResult) {
    return res.status(400).json({ error: "queryResult é obrigatório." });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY não configurada no servidor." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  try {
    await analyzeWithStream(queryResult, (text) => send({ text }));
    send({ done: true });
  } catch (err) {
    const detail = err.response?.data?.error?.message ?? err.message;
    send({ error: detail });
  }

  res.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  ⚡ WABA Analyzer  →  http://localhost:${PORT}\n`);
  if (!process.env.OPENAI_API_KEY) {
    console.warn("  ⚠ OPENAI_API_KEY não encontrada. Copie .env.example para .env e configure.\n");
  }
});
