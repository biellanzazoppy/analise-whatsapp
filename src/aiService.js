// src/aiService.js
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const CONTEXT = fs.readFileSync(
  path.join(__dirname, "../config/context.md"),
  "utf-8"
);

function sanitize(queryResult) {
  const { data, errors } = queryResult;
  const out = {};

  for (const [key, payload] of Object.entries(data)) {
    if (!payload) continue;
    const clean = JSON.parse(JSON.stringify(payload));
    if (clean.paging) delete clean.paging;
    if (clean.data && Array.isArray(clean.data)) {
      const total = clean.data.length;
      clean.data = clean.data.slice(0, 20);
      if (total > 20) clean._truncated = `${total - 20} itens omitidos`;
    }
    out[key] = clean;
  }

  return { data: out, errors };
}

/**
 * Monta o prompt incluindo dados da Meta e, se disponíveis, campos do banco Zoppy.
 */
function buildPrompt(queryResult) {
  const clean = sanitize(queryResult);
  let prompt = `${CONTEXT}\n\n## Dados da Meta API\n\`\`\`json\n${JSON.stringify(clean)}\n\`\`\``;

  if (queryResult.dbFields && Object.keys(queryResult.dbFields).length > 0) {
    prompt += `\n\n## Dados do banco Zoppy\n\`\`\`json\n${JSON.stringify(queryResult.dbFields)}\n\`\`\``;
  }

  return prompt;
}

async function analyzeWithStream(queryResult, onChunk) {
  const prompt = buildPrompt(queryResult);

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      max_tokens: 1024,
      temperature: 0.3,
      stream: true,
      messages: [{ role: "user", content: prompt }],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      responseType: "stream",
      timeout: 60000,
    }
  );

  return new Promise((resolve, reject) => {
    let buffer = "";

    response.data.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") { resolve(); return; }
        try {
          const text = JSON.parse(raw)?.choices?.[0]?.delta?.content;
          if (text) onChunk(text);
        } catch {}
      }
    });

    response.data.on("end", resolve);
    response.data.on("error", reject);
  });
}

module.exports = { analyzeWithStream };
