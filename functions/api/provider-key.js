import { isAdminRequest } from '../lib/admin.js';
import { syncManagedCustomProviders } from '../lib/cloudflare-provider-admin.js';
import {
  customProviderSlug,
  effectiveCloudflareAccountId,
  effectiveGatewayId,
  isManagedCustomProfile,
  loadProviderConfig,
  normalizeProviderConfig,
  validateProviderConfig,
} from '../lib/provider-config.js';

export async function onRequestPost({ request, env }) {
  if (!(await isAdminRequest(request, env))) return failure('Admin unlock required.', 401);
  const url = new URL(request.url);
  if (url.protocol !== 'https:' || request.headers.get('origin') !== url.origin ||
      !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
    return failure('Save the key from the Risk Classes admin page.', 403);
  }

  const token = String(env.CF_AI_GATEWAY_KEYS_TOKEN || env.CF_AI_GATEWAY_ADMIN_TOKEN || '').trim();
  if (!token) return failure('In-app key storage is not enabled. Set up the Cloudflare key-management credential once.', 503);
  const body = await request.json().catch(() => null);
  const secret = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
  if (!secret || secret.length > 4096 || /[\u0000-\u0020\u007f]/.test(secret)) {
    return failure('Enter a valid API key without spaces or line breaks.', 400);
  }
  if (!Array.isArray(body.config?.profiles) || body.config.profiles.some(profile => !profile || typeof profile !== 'object')) {
    return failure('Provider configuration is missing or invalid.', 400);
  }

  const published = await loadProviderConfig(env);
  const config = normalizeProviderConfig(body.config, env);
  if (!validateProviderConfig(config, env).valid) {
    return failure('Complete the provider settings and fix any validation errors first.', 400);
  }
  const profile = config.profiles.find(item => item.id === body.profileId);
  if (profile?.transport !== 'cloudflare-provider' || !profile.byokAlias) {
    return failure('Select a Gateway provider and enter a key alias.', 400);
  }
  const account = effectiveCloudflareAccountId(published, env);
  const gateway = effectiveGatewayId(published, env);
  if (!account || account !== effectiveCloudflareAccountId(config, env) || gateway !== effectiveGatewayId(config, env)) {
    return failure('Use the published Cloudflare account and gateway when adding a key.', 400);
  }

  const storeUrl = new URL(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai-gateway/gateways/${encodeURIComponent(gateway)}/provider_configs`);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const signal = AbortSignal.timeout(15000);
  const providerSlug = customProviderSlug(profile);
  if (!providerSlug) return failure('Enter a valid provider slug.', 400);
  const matches = record => record?.alias === profile.byokAlias && record.provider_slug === providerSlug;
  try {
    storeUrl.searchParams.set('per_page', '100');
    for (let page = 1; ; page++) {
      storeUrl.searchParams.set('page', String(page));
      const response = await fetch(storeUrl, { headers, signal, redirect: 'error' });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.success !== true || !Array.isArray(data.result)) return cloudflareFailure(response.status);
      if (data.result.some(matches)) return failure('A key already uses this alias for the provider. Choose a new alias.', 409);
      if (data.result_info?.total_pages ? page >= data.result_info.total_pages : data.result.length < 100) break;
    }
    if (isManagedCustomProfile(profile)) {
      const sync = await syncManagedCustomProviders(env, config, { profileIds: [profile.id], createOnly: true, signal });
      if (!sync.ok) return failure(sync.status === 409 ? sync.error : 'Cloudflare could not register the custom provider address.', sync.status || 502);
    }
    storeUrl.search = '';
    const response = await fetch(storeUrl, {
      method: 'POST', headers, signal, redirect: 'error',
      body: JSON.stringify({ secret, alias: profile.byokAlias, provider_slug: providerSlug, default_config: false }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.success !== true || !matches(data.result)) return cloudflareFailure(response.status);
    return json({ ok: true, alias: profile.byokAlias }, 201);
  } catch {
    return failure('Could not confirm key storage with Cloudflare. Check the alias before trying again.', 502);
  }
}

function cloudflareFailure(status) {
  if (status === 401 || status === 403) return failure('Cloudflare denied key management. Check the key-management token permissions.', 503);
  if (status === 409) return failure('A key already uses this alias for the provider. Choose a new alias.', 409);
  return failure(`Cloudflare could not save or verify the key (HTTP ${status}).`, 502);
}

function failure(error, status) {
  return json({ ok: false, error }, status);
}

function json(body, status) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}
