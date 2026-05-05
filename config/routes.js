// config/routes.js
// Use {wabaId} e {phone_number_id} como placeholders.
// Rotas com dependsOn aguardam a rota pai antes de executar.

module.exports = [
  // ── Independentes (executam em paralelo) ──────────────────────────────────

  {
    key: "phone_numbers",
    label: "Números de Telefone",
    method: "GET",
    url: "https://graph.facebook.com/v19.0/{wabaId}/phone_numbers",
  },
  {
    key: "waba_full",
    label: "WABA — Detalhes Completos",
    method: "GET",
    url: "https://graph.facebook.com/v19.0/{wabaId}?fields=account_review_status,currency,timezone_id,message_template_namespace,ownership_type,on_behalf_of_business_info,health_status",
  },
  {
    key: "subscribed_apps",
    label: "Webhooks Inscritos",
    method: "GET",
    url: "https://graph.facebook.com/v19.0/{wabaId}/subscribed_apps",
  },
  {
    key: "message_templates",
    label: "Templates",
    method: "GET",
    url: "https://graph.facebook.com/v19.0/{wabaId}/message_templates",
  },

  // ── Dependentes de phone_number_id (executam após phone_numbers) ──────────

  {
    key: "phone_number_detail",
    label: "Número — Detalhes",
    method: "GET",
    url: "https://graph.facebook.com/v19.0/{phone_number_id}?fields=display_phone_number,platform_type,account_mode,is_on_biz_app",
    dependsOn: "phone_numbers",
  },
];
