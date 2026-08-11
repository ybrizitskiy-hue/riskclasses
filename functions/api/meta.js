import { getGlobalRoutingMode } from '../lib/runtime-config.js';

const RULES_KEY = 'custom-gpt-v2';

export async function onRequestGet(context) {
  const apiKeyConfigured = Boolean(context.env.OPENAI_API_KEY);
  const adminPinConfigured = Boolean(context.env.RISK_ADMIN_PIN);
  const kvConfigured = Boolean(context.env.RISK_RULES && typeof context.env.RISK_RULES.get === 'function');
  let rulesConfigured = false;
  let rulesVersion = null;

  if (kvConfigured) {
    try {
      const raw = await context.env.RISK_RULES.get(RULES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        rulesConfigured = Boolean(parsed?.instructions && parsed?.knowledge);
        rulesVersion = parsed?.version || null;
      }
    } catch {
      rulesConfigured = false;
    }
  }

  const globalRoutingMode = await getGlobalRoutingMode(context.env);
  const ok = apiKeyConfigured && rulesConfigured;
  return Response.json({
    ok,
    service: 'risk-class-analyst-v2',
    routing: {
      globalMode: globalRoutingMode,
      globallyManaged: true,
      modeSelectorAdminOnly: true,
      modes: ['auto', 'economy', 'quality'],
      costTelemetryAdminOnly: true,
      extraction: { model: context.env.OPENAI_EXTRACT_MODEL || 'gpt-5.6-luna', reasoning: 'low' },
      economy: { model: context.env.OPENAI_LUNA_MODEL || 'gpt-5.6-luna', reasoning: 'medium' },
      auto: {
        primaryModel: context.env.OPENAI_LUNA_MODEL || 'gpt-5.6-luna',
        escalationModel: context.env.OPENAI_TERRA_MODEL || 'gpt-5.6-terra',
        reasoning: 'medium',
      },
      quality: { model: context.env.OPENAI_TERRA_MODEL || 'gpt-5.6-terra', reasoning: 'medium' },
      promptCacheRetention: '24h',
      webSearchOnlyForUnresolved: true,
    },
    apiKeyConfigured,
    adminPinConfigured,
    rulesConfigured,
    rulesVersion,
  }, {
    status: ok ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
