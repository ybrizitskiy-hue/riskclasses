const CONFIG_KEY = 'runtime-config-v1';
const ALLOWED_MODES = new Set(['auto', 'economy', 'quality']);

export function normalizeRoutingMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return ALLOWED_MODES.has(mode) ? mode : 'auto';
}

export async function getGlobalRoutingMode(env) {
  const kv = env?.RISK_RULES;
  if (!kv || typeof kv.get !== 'function') return 'auto';
  try {
    const raw = await kv.get(CONFIG_KEY);
    if (!raw) return 'auto';
    const parsed = JSON.parse(raw);
    return normalizeRoutingMode(parsed?.routingMode);
  } catch {
    return 'auto';
  }
}

export async function setGlobalRoutingMode(env, routingMode) {
  const kv = env?.RISK_RULES;
  if (!kv || typeof kv.put !== 'function') {
    throw new Error('RISK_RULES KV binding does not support writes.');
  }
  const normalized = normalizeRoutingMode(routingMode);
  await kv.put(CONFIG_KEY, JSON.stringify({
    routingMode: normalized,
    updatedAt: new Date().toISOString(),
  }));
  return normalized;
}

export function runtimeConfigKey() {
  return CONFIG_KEY;
}
