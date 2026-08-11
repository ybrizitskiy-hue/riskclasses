import {
  adminCookie,
  adminSessionSeconds,
  clearAdminCookie,
  createAdminSession,
  isAdminConfigured,
  isAdminRequest,
  verifyAdminPin,
} from '../lib/admin.js';

export async function onRequestGet(context) {
  const configured = isAdminConfigured(context.env);
  const admin = configured ? await isAdminRequest(context.request, context.env) : false;
  return json({ ok: true, configured, admin }, 200);
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
  return json({
    ok: true,
    configured: true,
    admin: true,
    expiresInSeconds: adminSessionSeconds(),
  }, 200, { 'set-cookie': adminCookie(token) });
}

export async function onRequestDelete() {
  return json({ ok: true, admin: false }, 200, { 'set-cookie': clearAdminCookie() });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

function json(value, status = 200, extraHeaders = {}) {
  return Response.json(value, {
    status,
    headers: {
      ...corsHeaders(),
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}
