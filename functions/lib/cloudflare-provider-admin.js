import {
  customProviderSlug,
  effectiveCloudflareAccountId,
  isManagedCustomProfile,
} from './provider-config.js';

export async function syncManagedCustomProviders(env, config, { profileIds = null } = {}) {
  const profiles = (config?.profiles || []).filter((profile) => {
    if (!isManagedCustomProfile(profile)) return false;
    return !profileIds || profileIds.includes(profile.id);
  });
  if (!profiles.length) return { ok: true, changed: false, results: [] };

  const token = String(env?.CF_AI_GATEWAY_ADMIN_TOKEN || '').trim();
  if (!token) return { ok: false, status: 503, error: 'CF_AI_GATEWAY_ADMIN_TOKEN is required to create or update Cloudflare Custom Provider addresses.' };
  const accountId = effectiveCloudflareAccountId(config, env);
  if (!accountId) return { ok: false, status: 400, error: 'Cloudflare Account ID is required to synchronize custom providers.' };

  const listed = await cloudflareRequest(env, accountId, 'GET', '/ai-gateway/custom-providers?per_page=100');
  if (!listed.ok) return listed;
  const existing = Array.isArray(listed.data?.result) ? listed.data.result : [];
  const results = [];
  let changed = false;

  for (const profile of profiles) {
    const slug = customProviderSlug(profile);
    const found = existing.find((item) => String(item?.slug || '') === slug);
    const desired = {
      name: String(profile.label || profile.id || slug),
      slug,
      base_url: String(profile.baseUrl),
      enable: true,
      description: 'Managed by Risk Class Analyst AI Provider Manager.',
    };

    if (!found) {
      const created = await cloudflareRequest(env, accountId, 'POST', '/ai-gateway/custom-providers', desired);
      if (!created.ok) return { ...created, error: `${profile.label}: ${created.error}` };
      results.push({ profileId: profile.id, action: 'created', id: created.data?.result?.id || '', slug, baseUrl: desired.base_url });
      existing.push(created.data?.result || desired);
      changed = true;
      continue;
    }

    const needsUpdate =
      String(found.base_url || '').replace(/\/+$/g, '') !== desired.base_url.replace(/\/+$/g, '') ||
      String(found.name || '') !== desired.name ||
      found.enable === false;
    if (!needsUpdate) {
      results.push({ profileId: profile.id, action: 'unchanged', id: found.id || '', slug, baseUrl: desired.base_url });
      continue;
    }

    const updated = await cloudflareRequest(env, accountId, 'PATCH', `/ai-gateway/custom-providers/${encodeURIComponent(found.id)}`, desired);
    if (!updated.ok) return { ...updated, error: `${profile.label}: ${updated.error}` };
    results.push({ profileId: profile.id, action: 'updated', id: found.id || '', slug, baseUrl: desired.base_url });
    changed = true;
  }

  return { ok: true, changed, results };
}

export function customProviderAddressChanged(currentConfig, nextConfig) {
  const before = new Map((currentConfig?.profiles || []).map((profile) => [profile.id, profile]));
  for (const profile of nextConfig?.profiles || []) {
    if (!isManagedCustomProfile(profile)) continue;
    const previous = before.get(profile.id);
    if (!previous || !isManagedCustomProfile(previous)) return true;
    if (String(previous.providerSlug || '') !== String(profile.providerSlug || '')) return true;
    if (String(previous.baseUrl || '').replace(/\/+$/g, '') !== String(profile.baseUrl || '').replace(/\/+$/g, '')) return true;
    if (String(previous.label || '') !== String(profile.label || '')) return true;
  }
  return false;
}

async function cloudflareRequest(env, accountId, method, path, body) {
  let response;
  try {
    response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${env.CF_AI_GATEWAY_ADMIN_TOKEN}`,
        'content-type': 'application/json',
      },
      body: body == null ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    return { ok: false, status: 502, error: `Could not reach Cloudflare Custom Providers API: ${error?.message || String(error)}` };
  }
  const data = await response.json().catch(() => ({}));
  if (response.ok && data?.success !== false) return { ok: true, status: response.status, data };
  const messages = [];
  for (const item of data?.errors || []) if (item?.message) messages.push(item.message);
  if (data?.error?.message) messages.push(data.error.message);
  return { ok: false, status: response.status, error: messages[0] || `Cloudflare Custom Providers API returned HTTP ${response.status}.`, data };
}
