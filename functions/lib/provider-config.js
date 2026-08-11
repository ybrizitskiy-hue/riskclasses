export const PROVIDER_CONFIG_KEY = 'ai-provider-config-v1';
export const PROVIDER_SCHEMA_VERSION = 1;

const TRANSPORTS = new Set(['openai-direct', 'cloudflare-rest', 'cloudflare-provider']);
const PROTOCOLS = new Set(['responses', 'chat-completions']);
const PROFILE_ID_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/;
const PROVIDER_SLUG_RE = /^(?:custom-)?[a-z0-9][a-z0-9-]{0,62}$/;
const ALIAS_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const MODES = ['auto', 'economy', 'quality'];
const ROUTE_ROLES = ['extraction', 'primary', 'research', 'escalation'];

export function defaultProviderConfig(env = {}) {
  const luna = env.OPENAI_LUNA_MODEL || 'gpt-5.6-luna';
  const terra = env.OPENAI_TERRA_MODEL || 'gpt-5.6-terra';
  const extract = env.OPENAI_EXTRACT_MODEL || luna;
  const profiles = [
    openAiProfile('openai-luna-direct', 'OpenAI Luna', luna, { input: 1, cached: 0.1, output: 6, webSearch: 0.01 }),
    openAiProfile('openai-terra-direct', 'OpenAI Terra', terra, { input: 2.5, cached: 0.25, output: 15, webSearch: 0.01 }),
  ];
  if (extract !== luna) {
    profiles.unshift(openAiProfile('openai-extract-direct', 'OpenAI extraction', extract, null));
  }
  const extractionId = extract === luna ? 'openai-luna-direct' : 'openai-extract-direct';
  return {
    schemaVersion: PROVIDER_SCHEMA_VERSION,
    version: 'providers-v1',
    cloudflare: {
      accountId: '',
      gatewayId: env.CF_AI_GATEWAY_ID || 'default',
    },
    profiles,
    routes: {
      economy: { extraction: extractionId, primary: 'openai-luna-direct', research: null, escalation: null },
      auto: { extraction: extractionId, primary: 'openai-luna-direct', research: null, escalation: 'openai-terra-direct' },
      quality: { extraction: extractionId, primary: 'openai-terra-direct', research: null, escalation: null },
    },
  };
}

function openAiProfile(id, label, model, pricing) {
  return {
    id,
    label,
    transport: 'openai-direct',
    protocol: 'responses',
    model,
    providerSlug: 'openai',
    pathPrefix: '',
    byokAlias: '',
    capabilities: {
      vision: true,
      jsonSchema: true,
      reasoning: true,
      webSearch: true,
      promptCache: true,
      store: true,
    },
    pricing: normalizePricing(pricing),
  };
}

export async function loadProviderConfig(env, { persistDefault = false } = {}) {
  const kv = env?.RISK_RULES;
  if (kv && typeof kv.get === 'function') {
    try {
      const raw = await kv.get(PROVIDER_CONFIG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const validation = validateProviderConfig(parsed, env);
        if (validation.valid) return normalizeProviderConfig(parsed, env);
      }
    } catch {
      // Fall through to a backwards-compatible direct OpenAI configuration.
    }
  }
  const fallback = defaultProviderConfig(env);
  if (persistDefault && kv && typeof kv.put === 'function') {
    try { await kv.put(PROVIDER_CONFIG_KEY, JSON.stringify(fallback)); } catch { /* non-fatal */ }
  }
  return fallback;
}

export async function saveProviderConfig(env, value) {
  const validation = validateProviderConfig(value, env);
  if (!validation.valid) {
    const error = new Error(validation.errors.join(' '));
    error.validation = validation;
    throw error;
  }
  const kv = env?.RISK_RULES;
  if (!kv || typeof kv.put !== 'function') throw new Error('RISK_RULES KV binding does not support writes.');
  const normalized = normalizeProviderConfig(value, env);
  if (!normalized.version || normalized.version === 'providers-v1') {
    normalized.version = `providers-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  }
  await kv.put(PROVIDER_CONFIG_KEY, JSON.stringify(normalized));
  return normalized;
}

export function validateProviderConfig(value, env = {}) {
  const errors = [];
  const warnings = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: ['Provider configuration must be a JSON object.'], warnings, stats: {} };
  }
  if (Number(value.schemaVersion) !== PROVIDER_SCHEMA_VERSION) errors.push(`schemaVersion must be ${PROVIDER_SCHEMA_VERSION}.`);
  const profiles = Array.isArray(value.profiles) ? value.profiles : [];
  if (!profiles.length) errors.push('At least one AI provider profile is required.');
  if (profiles.length > 16) errors.push('A maximum of 16 provider profiles is supported.');

  const ids = new Set();
  let cloudflareProfiles = 0;
  for (const profile of profiles) {
    if (!profile || typeof profile !== 'object') { errors.push('Each provider profile must be an object.'); continue; }
    const id = String(profile.id || '').trim();
    if (!PROFILE_ID_RE.test(id)) errors.push(`Invalid provider profile id "${id || '(blank)'}".`);
    if (ids.has(id)) errors.push(`Duplicate provider profile id "${id}".`);
    ids.add(id);
    if (!String(profile.label || '').trim()) errors.push(`Profile ${id || '(blank)'} needs a label.`);
    if (!TRANSPORTS.has(profile.transport)) errors.push(`Profile ${id || '(blank)'} has unsupported transport "${profile.transport}".`);
    if (!PROTOCOLS.has(profile.protocol)) errors.push(`Profile ${id || '(blank)'} has unsupported protocol "${profile.protocol}".`);
    if (!String(profile.model || '').trim()) errors.push(`Profile ${id || '(blank)'} needs a model name.`);

    if (profile.transport === 'cloudflare-rest' || profile.transport === 'cloudflare-provider') cloudflareProfiles += 1;
    if (profile.transport === 'cloudflare-provider') {
      if (!PROVIDER_SLUG_RE.test(String(profile.providerSlug || '').trim())) errors.push(`Profile ${id} needs a valid Cloudflare provider slug.`);
      const prefix = String(profile.pathPrefix || '').trim();
      if (prefix.includes('..') || prefix.includes('://') || prefix.includes('?') || prefix.includes('#')) errors.push(`Profile ${id} has an unsafe path prefix.`);
    }
    const alias = String(profile.byokAlias || '').trim();
    if (alias && !ALIAS_RE.test(alias)) errors.push(`Profile ${id} has an invalid BYOK alias.`);

    const caps = profile.capabilities || {};
    for (const key of ['vision','jsonSchema','reasoning','webSearch','promptCache','store']) {
      if (typeof caps[key] !== 'boolean') errors.push(`Profile ${id} capability ${key} must be true or false.`);
    }
    if (profile.protocol === 'chat-completions' && caps.webSearch) warnings.push(`Profile ${id}: generic Chat Completions routing does not expose the OpenAI Responses web_search tool; web search will be disabled.`);
    if (!caps.jsonSchema) warnings.push(`Profile ${id}: JSON Schema is disabled, so the server will rely on prompt-only JSON output and strict parsing.`);
    validatePricing(profile.pricing, id, errors);
  }

  const cloudflare = value.cloudflare || {};
  const accountId = String(cloudflare.accountId || env.CF_ACCOUNT_ID || '').trim();
  const gatewayId = String(cloudflare.gatewayId || env.CF_AI_GATEWAY_ID || 'default').trim();
  if (cloudflareProfiles && !accountId) errors.push('Cloudflare Account ID is required when a Cloudflare provider profile is used.');
  if (cloudflareProfiles && !/^[a-zA-Z0-9_-]{3,64}$/.test(gatewayId)) errors.push('Cloudflare Gateway ID is invalid.');

  const routes = value.routes || {};
  for (const mode of MODES) {
    const route = routes[mode];
    if (!route || typeof route !== 'object') { errors.push(`Missing ${mode} routing configuration.`); continue; }
    for (const role of ROUTE_ROLES) {
      const ref = route[role];
      if ((role === 'extraction' || role === 'primary') && !ref) errors.push(`${mode}.${role} must select a provider profile.`);
      if (ref != null && ref !== '' && !ids.has(String(ref))) errors.push(`${mode}.${role} references unknown profile "${ref}".`);
    }
    const extractProfile = profiles.find((profile) => profile?.id === route.extraction);
    if (extractProfile && !extractProfile.capabilities?.vision) errors.push(`${mode}.extraction profile ${extractProfile.id} must have Vision enabled.`);
  }

  if (!env.OPENAI_API_KEY && profiles.some((profile) => profile.transport === 'openai-direct')) {
    warnings.push('Direct OpenAI profiles require the OPENAI_API_KEY Cloudflare secret at runtime.');
  }
  if (!env.CF_AI_GATEWAY_TOKEN && cloudflareProfiles) {
    warnings.push('Cloudflare profiles require the CF_AI_GATEWAY_TOKEN Cloudflare secret at runtime.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: { profileCount: profiles.length, cloudflareProfiles, routeModes: MODES.length },
  };
}

export function normalizeProviderConfig(value, env = {}) {
  const source = JSON.parse(JSON.stringify(value || defaultProviderConfig(env)));
  source.schemaVersion = PROVIDER_SCHEMA_VERSION;
  source.version = String(source.version || 'providers-v1').trim();
  source.cloudflare = {
    accountId: String(source.cloudflare?.accountId || '').trim(),
    gatewayId: String(source.cloudflare?.gatewayId || env.CF_AI_GATEWAY_ID || 'default').trim() || 'default',
  };
  source.profiles = (Array.isArray(source.profiles) ? source.profiles : []).map((profile) => ({
    id: String(profile.id || '').trim(),
    label: String(profile.label || '').trim(),
    transport: profile.transport,
    protocol: profile.protocol,
    model: String(profile.model || '').trim(),
    providerSlug: String(profile.providerSlug || '').trim(),
    pathPrefix: String(profile.pathPrefix || '').trim().replace(/^\/+|\/+$/g, ''),
    byokAlias: String(profile.byokAlias || '').trim(),
    capabilities: {
      vision: Boolean(profile.capabilities?.vision),
      jsonSchema: Boolean(profile.capabilities?.jsonSchema),
      reasoning: Boolean(profile.capabilities?.reasoning),
      webSearch: Boolean(profile.capabilities?.webSearch),
      promptCache: Boolean(profile.capabilities?.promptCache),
      store: Boolean(profile.capabilities?.store),
    },
    pricing: normalizePricing(profile.pricing),
  }));
  source.routes = {};
  for (const mode of MODES) {
    const route = value?.routes?.[mode] || {};
    source.routes[mode] = {
      extraction: route.extraction || null,
      primary: route.primary || null,
      research: route.research || null,
      escalation: route.escalation || null,
    };
  }
  return source;
}

export function providerMap(config) {
  return new Map((config?.profiles || []).map((profile) => [profile.id, profile]));
}

export function getModeProfiles(config, mode) {
  const selectedMode = MODES.includes(mode) ? mode : 'auto';
  const map = providerMap(config);
  const route = config?.routes?.[selectedMode] || config?.routes?.auto || {};
  const resolve = (id) => id ? map.get(id) || null : null;
  return {
    mode: selectedMode,
    extraction: resolve(route.extraction),
    primary: resolve(route.primary),
    research: resolve(route.research),
    escalation: resolve(route.escalation),
  };
}

export function effectiveCloudflareAccountId(config, env = {}) {
  return String(config?.cloudflare?.accountId || env.CF_ACCOUNT_ID || '').trim();
}

export function effectiveGatewayId(config, env = {}) {
  return String(config?.cloudflare?.gatewayId || env.CF_AI_GATEWAY_ID || 'default').trim() || 'default';
}

export function profileRuntimeStatus(env, config, profile) {
  if (!profile) return { ready: false, reason: 'Profile not found.' };
  if (profile.transport === 'openai-direct') {
    return env.OPENAI_API_KEY ? { ready: true, credential: 'OPENAI_API_KEY' } : { ready: false, reason: 'OPENAI_API_KEY is not configured.' };
  }
  const accountId = effectiveCloudflareAccountId(config, env);
  if (!accountId) return { ready: false, reason: 'Cloudflare Account ID is missing.' };
  if (!env.CF_AI_GATEWAY_TOKEN) return { ready: false, reason: 'CF_AI_GATEWAY_TOKEN is not configured.' };
  return { ready: true, credential: 'CF_AI_GATEWAY_TOKEN', accountId, gatewayId: effectiveGatewayId(config, env) };
}

export function routingLabels(config) {
  const map = providerMap(config);
  const label = (id) => map.get(id)?.label || id || '—';
  const result = {};
  for (const mode of MODES) {
    const route = config?.routes?.[mode] || {};
    const parts = [label(route.primary)];
    if (route.research && route.research !== route.primary) parts.push(label(route.research));
    if (route.escalation && route.escalation !== route.research && route.escalation !== route.primary) parts.push(label(route.escalation));
    result[mode] = parts.filter(Boolean).join(' → ');
  }
  return result;
}

function normalizePricing(pricing) {
  const src = pricing && typeof pricing === 'object' ? pricing : {};
  return {
    input: nullableNumber(src.input),
    cached: nullableNumber(src.cached),
    output: nullableNumber(src.output),
    webSearch: nullableNumber(src.webSearch),
  };
}

function nullableNumber(value) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function validatePricing(pricing, id, errors) {
  if (pricing == null) return;
  if (typeof pricing !== 'object' || Array.isArray(pricing)) { errors.push(`Profile ${id} pricing must be an object.`); return; }
  for (const key of ['input','cached','output','webSearch']) {
    const value = pricing[key];
    if (value === '' || value == null) continue;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) errors.push(`Profile ${id} pricing.${key} must be a non-negative number or blank.`);
  }
}
