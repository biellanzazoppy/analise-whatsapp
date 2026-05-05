// src/queryService.js
const axios = require("axios");
const ROUTES = require("../config/routes");

function interpolate(str, params) {
  return str.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
}

function buildError(err) {
  return {
    message: err.message,
    status: err.response?.status ?? null,
    detail: err.response?.data ?? null,
  };
}

/**
 * Executa todas as rotas.
 * Rotas marcadas com dependsOn aguardam a rota pai para extrair parâmetros dinâmicos.
 */
async function queryAll(token, wabaId) {
  const params = { wabaId };
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const data = {};
  const errors = {};

  // Separa rotas independentes das dependentes
  const independent = ROUTES.filter(r => !r.dependsOn);
  const dependent   = ROUTES.filter(r =>  r.dependsOn);

  // 1. Executa rotas independentes em paralelo
  const settled = await Promise.allSettled(
    independent.map(route =>
      axios({ method: route.method, url: interpolate(route.url, params), headers, timeout: 15000 })
        .then(r => ({ key: route.key, data: r.data }))
    )
  );

  settled.forEach((result, i) => {
    const { key } = independent[i];
    if (result.status === "fulfilled") data[key] = result.value.data;
    else errors[key] = buildError(result.reason);
  });

  // 2. Resolve parâmetros dinâmicos a partir dos resultados anteriores
  // phone_number_id vem do primeiro número da rota phone_numbers
  if (data.phone_numbers?.data?.[0]?.id) {
    params.phone_number_id = data.phone_numbers.data[0].id;
  }

  // 3. Executa rotas dependentes em paralelo (se tiver os parâmetros necessários)
  if (dependent.length > 0) {
    const depSettled = await Promise.allSettled(
      dependent.map(route => {
        const url = interpolate(route.url, params);
        // Se ainda houver placeholder não resolvido, pula
        if (url.includes("{")) {
          return Promise.reject(new Error(`Parâmetro não disponível para a rota "${route.key}". Verifique se a rota phone_numbers retornou dados.`));
        }
        return axios({ method: route.method, url, headers, timeout: 15000 })
          .then(r => ({ key: route.key, data: r.data }));
      })
    );

    depSettled.forEach((result, i) => {
      const { key } = dependent[i];
      if (result.status === "fulfilled") data[key] = result.value.data;
      else errors[key] = buildError(result.reason);
    });
  }

  return { data, errors };
}

module.exports = { queryAll, ROUTES };
