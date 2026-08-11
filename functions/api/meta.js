const RULES_KEY = 'custom-gpt-v2';

export async function onRequestGet(context) {
  const apiKeyConfigured = Boolean(context.env.OPENAI_API_KEY);
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

  const ok = apiKeyConfigured && rulesConfigured;
  return Response.json({
    ok,
    service: 'risk-class-analyst-v2',
    model: context.env.OPENAI_MODEL || 'gpt-5.6-terra',
    reasoning: 'medium',
    webSearch: true,
    apiKeyConfigured,
    rulesConfigured,
    rulesVersion,
  }, {
    status: ok ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
