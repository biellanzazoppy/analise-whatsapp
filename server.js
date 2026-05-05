// server.js
require("dotenv").config();

const express = require("express");
const axios = require("axios");
const path = require("path");
const { queryAll, ROUTES } = require("./src/queryService");
const { analyzeWithStream } = require("./src/aiService");

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── GET /api/routes ────────────────────────────────────────────────────────
app.get("/api/routes", (_, res) => {
  res.json(ROUTES.map(({ key, label, method }) => ({ key, label, method })));
});

// ── POST /api/query ────────────────────────────────────────────────────────
app.post("/api/query", async (req, res) => {
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

// ── POST /api/extract-image ────────────────────────────────────────────────
// Recebe um print do banco (base64) e extrai os campos necessários via GPT Vision
app.post("/api/extract-image", async (req, res) => {
  const { imageBase64, mimeType } = req.body ?? {};

  if (!imageBase64) {
    return res.status(400).json({ error: "imageBase64 é obrigatório." });
  }

  const prompt = `Você receberá um print de uma consulta no banco de dados da Zoppy (tabelas WppAccounts e/ou WppAccountPhoneNumbers).
Extraia APENAS os seguintes campos, se visíveis na imagem:

WppAccounts: scenario, status, syncAttempt, errorMessage, active, businessName
WppAccountPhoneNumbers: qualityRating, status (renomeie para phoneStatus)

Retorne SOMENTE um JSON válido, sem texto adicional, sem markdown, sem explicações.
Exemplo: {"scenario":"integrated","status":"failed","syncAttempt":0,"errorMessage":null,"active":true,"businessName":"EMPRESA X","qualityRating":"GREEN","phoneStatus":"VERIFIED"}
Se um campo não estiver visível na imagem, omita-o do JSON.`;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o",
        max_tokens: 256,
        temperature: 0,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: {
              url: `data:${mimeType || "image/png"};base64,${imageBase64}`,
              detail: "low"
            }}
          ]
        }]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const raw = response.data.choices[0].message.content.trim();
    const json = JSON.parse(raw.replace(/```json|```/g, "").trim());
    res.json({ fields: json });
  } catch (err) {
    const detail = err.response?.data?.error?.message ?? err.message;
    res.status(500).json({ error: detail });
  }
});

// ── POST /api/analyze ──────────────────────────────────────────────────────
app.post("/api/analyze", async (req, res) => {
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