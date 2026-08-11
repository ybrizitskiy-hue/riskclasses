import { isAdminRequest } from '../lib/admin.js';
import {
  loadReasoningConfig,
  normalizeReasoningConfig,
  saveReasoningConfig,
  validateReasoningConfig,
} from '../lib/reasoning-config.js';

export async function onRequestGet(context) {
  if (!(await isAdminRequest(context.request, context.env))) return json({ ok: false, error: 'Admin unlock required.' }, 401);
  const config = await loadReasoningConfig(context.env);
  return json({ ok: true, config, validation: validateReasoningConfig(config) });
}

export async function onRequestPost(context) {
  if (!(await isAdminRequest(context.request, context.env))) return json({ ok: false, error: 'Admin unlock required.' }, 401);
  let body;
  try { body = await context.request.json(); } catch { return json({ ok: false, error: 'Invalid JSON request.' }, 400); }
  if ((body?.action || 'validate') !== 'validate') return json({ ok: false, error: 'Unsupported reasoning action.' }, 400);

  const config = normalizeReasoningConfig(body?.config);
  const validation = validateReasoningConfig(config);
  return json({ ok: validation.valid, config, validation }, validation.valid ? 200 : 400);
}

export async function onRequestPut(context) {
  if (!(await isAdminRequest(context.request, context.env))) return json({ ok: false, error: 'Admin unlock required.' }, 401);
  let body;
  try { body = await context.request.json(); } catch { return json({ ok: false, error: 'Invalid JSON request.' }, 400); }
  if (body?.action !== 'publish') return json({ ok: false, error: 'action must be publish.' }, 400);

  const current = await loadReasoningConfig(context.env);
  const candidate = normalizeReasoningConfig(body?.config);
  const validation = validateReasoningConfig(candidate);
  if (!validation.valid) return json({ ok: false, error: 'Reasoning configuration failed validation.', validation }, 400);
  if (candidate.version === current.version) candidate.version = `${current.version || 'reasoning'}-r${new Date().toISOString().replace(/[:.]/g, '-')}`;

  try {
    const saved = await saveReasoningConfig(context.env, candidate);
    return json({ ok: true, config: saved, validation: validateReasoningConfig(saved) });
  } catch (error) {
    return json({ ok: false, error: error?.message || 'Could not save reasoning configuration.', validation: error?.validation || validation }, 500);
  }
}

function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
}
