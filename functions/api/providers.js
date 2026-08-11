import { isAdminRequest } from '../lib/admin.js';
import {
  isManagedCustomProfile,
  loadProviderConfig,
  normalizeProviderConfig,
  saveProviderConfig,
  validateProviderConfig,
} from '../lib/provider-config.js';
import { callAiJson, publicProfileStatus } from '../lib/ai-client.js';
import {
  customProviderAddressChanged,
  syncManagedCustomProviders,
} from '../lib/cloudflare-provider-admin.js';

const TEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: { status: { type: 'string', enum: ['ok'] } },
};

export async function onRequestGet(context) {
  if (!(await isAdminRequest(context.request, context.env))) return json({ ok: false, error: 'Admin unlock required.' }, 401);
  const config = await loadProviderConfig(context.env);
  const validation = validateProviderConfig(config, context.env);
  return json({
    ok: true,
    config,
    validation,
    environment: environmentSummary(context.env, config),
    profiles: (config.profiles || []).map((profile) => publicProfileStatus(context.env, config, profile)),
  });
}

export async function onRequestPost(context) {
  if (!(await isAdminRequest(context.request, context.env))) return json({ ok: false, error: 'Admin unlock required.' }, 401);
  let body;
  try { body = await context.request.json(); } catch { return json({ ok: false, error: 'Invalid JSON request.' }, 400); }

  const action = body?.action || 'validate';
  const config = normalizeProviderConfig(body?.config || await loadProviderConfig(context.env), context.env);
  const validation = validateProviderConfig(config, context.env);
  if (action === 'validate') return json({ ok: validation.valid, validation, config }, validation.valid ? 200 : 400);
  if (!['test', 'sync'].includes(action)) return json({ ok: false, error: 'Unsupported provider action.' }, 400);
  if (!validation.valid) return json({ ok: false, validation, error: 'Provider configuration must validate before testing or syncing.' }, 400);

  const profileId = String(body?.profileId || '');
  const profile = (config.profiles || []).find((item) => item.id === profileId);
  if (!profile) return json({ ok: false, error: 'Provider profile not found.' }, 404);

  if (action === 'sync') {
    if (!isManagedCustomProfile(profile)) return json({ ok: false, error: 'This profile does not have a managed custom-provider Base URL.' }, 400);
    const sync = await syncManagedCustomProviders(context.env, config, { profileIds: [profileId] });
    return json(sync.ok ? { ok: true, sync } : { ok: false, error: sync.error, sync }, sync.ok ? 200 : (sync.status || 502));
  }

  let sync = null;
  if (isManagedCustomProfile(profile) && context.env.CF_AI_GATEWAY_ADMIN_TOKEN) {
    sync = await syncManagedCustomProviders(context.env, config, { profileIds: [profileId] });
    if (!sync.ok) return json({ ok: false, error: `Could not synchronize provider address before test. ${sync.error}`, sync }, sync.status || 502);
  }

  const input = [
    { role: 'developer', content: [{ type: 'input_text', text: 'This is a connectivity test. Return exactly the requested JSON object.' }] },
    { role: 'user', content: [{ type: 'input_text', text: 'Return {"status":"ok"}.' }] },
  ];
  const result = await callAiJson({
    env: context.env,
    config,
    profile,
    reasoning: 'low',
    stage: 'provider-test',
    input,
    schema: TEST_SCHEMA,
    schemaName: 'provider_connectivity_test',
    useWeb: false,
    promptCacheKey: '',
  });
  if (!result.ok || result.result?.status !== 'ok') return json({ ok: false, error: result.error || 'Provider returned an unexpected test result.', telemetry: result.telemetry || null, sync }, result.status || 502);
  return json({
    ok: true,
    result: 'ok',
    endpoint: publicProfileStatus(context.env, config, profile).endpoint,
    telemetry: result.telemetry || null,
    sync,
  });
}

export async function onRequestPut(context) {
  if (!(await isAdminRequest(context.request, context.env))) return json({ ok: false, error: 'Admin unlock required.' }, 401);
  let body;
  try { body = await context.request.json(); } catch { return json({ ok: false, error: 'Invalid JSON request.' }, 400); }
  if (body?.action !== 'publish') return json({ ok: false, error: 'action must be publish.' }, 400);

  const current = await loadProviderConfig(context.env);
  const candidate = normalizeProviderConfig(body?.config, context.env);
  const validation = validateProviderConfig(candidate, context.env);
  if (!validation.valid) return json({ ok: false, error: 'Provider configuration failed validation.', validation }, 400);
  if (candidate.version === current.version) candidate.version = `${current.version || 'providers'}-r${new Date().toISOString().replace(/[:.]/g, '-')}`;

  let sync = { ok: true, changed: false, results: [] };
  if (customProviderAddressChanged(current, candidate)) {
    if (!context.env.CF_AI_GATEWAY_ADMIN_TOKEN) {
      return json({
        ok: false,
        error: 'A custom provider Base URL was added or changed. Add the CF_AI_GATEWAY_ADMIN_TOKEN secret with AI Gateway Edit/Write permission, then publish again.',
        validation,
      }, 503);
    }
    sync = await syncManagedCustomProviders(context.env, candidate);
    if (!sync.ok) return json({ ok: false, error: `Could not synchronize custom provider address. ${sync.error}`, validation, sync }, sync.status || 502);
  }

  try {
    const saved = await saveProviderConfig(context.env, candidate);
    return json({
      ok: true,
      config: saved,
      validation: validateProviderConfig(saved, context.env),
      environment: environmentSummary(context.env, saved),
      profiles: saved.profiles.map((profile) => publicProfileStatus(context.env, saved, profile)),
      sync,
    });
  } catch (error) {
    return json({ ok: false, error: error?.message || 'Could not save provider configuration.', validation: error?.validation || validation, sync }, 500);
  }
}

function environmentSummary(env, config) {
  return {
    openAiKeyConfigured: Boolean(env.OPENAI_API_KEY),
    cloudflareGatewayTokenConfigured: Boolean(env.CF_AI_GATEWAY_TOKEN),
    cloudflareGatewayAdminTokenConfigured: Boolean(env.CF_AI_GATEWAY_ADMIN_TOKEN),
    adminSigningSecretConfigured: Boolean(env.RISK_ADMIN_SIGNING_SECRET),
    envAccountIdConfigured: Boolean(env.CF_ACCOUNT_ID),
    envAccountId: env.CF_ACCOUNT_ID || '',
    effectiveAccountId: config?.cloudflare?.accountId || env.CF_ACCOUNT_ID || '',
    effectiveGatewayId: config?.cloudflare?.gatewayId || env.CF_AI_GATEWAY_ID || 'default',
  };
}

function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
}
