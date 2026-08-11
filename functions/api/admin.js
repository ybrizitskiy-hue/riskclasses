import {
  adminCookie,
  adminSessionSeconds,
  clearAdminCookie,
  createAdminSession,
  isAdminConfigured,
  isAdminRequest,
  verifyAdminPin,
} from '../lib/admin.js';
import { getGlobalRoutingMode, setGlobalRoutingMode } from '../lib/runtime-config.js';

export async function onRequestGet(context) {
  const configured = isAdminConfigured(context.env);
  const admin = configured ? await isAdminRequest(context.request, context.env) : false;
  const globalRoutingMode = await getGlobalRoutingMode(context.env);
  return json({ ok: true, configured, admin, globalRoutingMode }, 200);
}

export async function onRequestPost(context) {
  if (!isAdminConfigured(context.env)) {
    return json({
      ok: false,
      configured: false,
      admin: false,
      error: 'Admin PIN is not configured in Cloudflare. Add the RISK_ADMIN_PIN secret and redeploy.',
    }, 503);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON request.' }, 400);
  }

  if (!verifyAdminPin(body?.pin, context.env)) {
    return json({ ok: false, configured: true, admin: false, error: 'Incorrect PIN.' }, 401);
  }

  const token = await createAdminSession(context.env);
  const globalRoutingMode = await getGlobalRoutingMode(context.env);
  return json({
    ok: true,
    configured: true,
    admin: true,
    globalRoutingMode,
    expiresInSeconds: adminSessionSeconds(),
  }, 200, { 'set-cookie': adminCookie(token) });
}

export async function onRequestPut(context) {
  if (!isAdminConfigured(context.env)) {
    return json({ ok: false, error: 'Admin PIN is not configured.' }, 503);
  }
  if (!(await isAdminRequest(context.request, context.env))) {
    return json({ ok: false, error: 'Admin unlock required.' }, 401);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON request.' }, 400);
  }

  if (!['auto', 'economy', 'quality'].includes(body?.routingMode)) {
    return json({ ok: false, error: 'routingMode must be auto, economy, or quality.' }, 400);
  }

  try {
    const globalRoutingMode = await setGlobalRoutingMode(context.env, body.routingMode);
    return json({ ok: true, admin: true, globalRoutingMode }, 200);
  } catch (error) {
    return json({ ok: false, error: error?.message || 'Could not save global routing mode.' }, 500);
  }
}

export async function onRequestDelete() {
  return json({ ok: true, admin: false }, 200, { 'set-cookie': clearAdminCookie() });
}

function json(value, status = 200, extraHeaders = {}) {
  return Response.json(value, {
    status,
    headers: {
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}
