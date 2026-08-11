import { getGlobalRoutingMode } from '../lib/runtime-config.js';
import {
  getModeProfiles,
  loadProviderConfig,
  profileRuntimeStatus,
  routingLabels,
  validateProviderConfig,
} from '../lib/provider-config.js';

const RULES_KEY = 'custom-gpt-v2';

export async function onRequestGet(context) {
  const apiKeyConfigured = Boolean(context.env.OPENAI_API_KEY);
  const cloudflareGatewayTokenConfigured = Boolean(context.env.CF_AI_GATEWAY_TOKEN);
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
  const providerConfig = await loadProviderConfig(context.env);
  const providerValidation = validateProviderConfig(providerConfig, context.env);
  const route = getModeProfiles(providerConfig, globalRoutingMode);
  const extractionStatus = profileRuntimeStatus(context.env, providerConfig, route.extraction);
  const primaryStatus = profileRuntimeStatus(context.env, providerConfig, route.primary);
  const ok = rulesConfigured && providerValidation.valid && extractionStatus.ready && primaryStatus.ready;

  return Response.json({
    ok,
    service: 'risk-class-analyst-v3',
    routing: {
      globalMode: globalRoutingMode,
      globallyManaged: true,
      modeSelectorAdminOnly: true,
      modes: ['auto', 'economy', 'quality'],
      costTelemetryAdminOnly: true,
      labels: routingLabels(providerConfig),
      providerConfigVersion: providerConfig.version,
      extraction: { profile: route.extraction?.label || null, model: route.extraction?.model || null },
      primary: { profile: route.primary?.label || null, model: route.primary?.model || null },
      research: { profile: route.research?.label || null, model: route.research?.model || null },
      escalation: { profile: route.escalation?.label || null, model: route.escalation?.model || null },
    },
    providers: {
      valid: providerValidation.valid,
      profileCount: providerConfig.profiles?.length || 0,
      openAiKeyConfigured: apiKeyConfigured,
      cloudflareGatewayTokenConfigured,
      extractionReady: extractionStatus.ready,
      primaryReady: primaryStatus.ready,
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
