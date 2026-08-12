import { isAdminRequest } from '../lib/admin.js';
import {
  RULES_KEY,
  archiveRulesBundle,
  diffRulesBundles,
  listRulesHistory,
  loadCurrentRulesBundle,
  loadHistoryBundle,
  preparePublishedBundle,
  unwrapBundle,
  validateRulesBundle,
} from '../lib/rules-bundle.js';

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (auth) return auth;
  const kv = context.env.RISK_RULES;
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') {
    return json({ ok: false, error: 'RISK_RULES KV binding must support read/write access.' }, 503);
  }

  const bundle = await loadCurrentRulesBundle(kv, { migrateLegacy: true });
  if (!bundle) return json({ ok: false, error: `Could not load ${RULES_KEY}.` }, 503);
  const validation = validateRulesBundle(bundle);
  const history = await listRulesHistory(kv);
  return json({ ok: true, bundle, validation, history, gptGuide: gptGuide(bundle.version) });
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context);
  if (auth) return auth;
  const kv = context.env.RISK_RULES;
  const current = await loadCurrentRulesBundle(kv, { migrateLegacy: true });
  if (!current) return json({ ok: false, error: 'Current rules bundle is unavailable.' }, 503);

  let body;
  try { body = await context.request.json(); } catch { return json({ ok: false, error: 'Invalid JSON request.' }, 400); }
  const candidate = unwrapBundle(body?.bundle ?? body);
  const validation = validateRulesBundle(candidate);
  const diff = candidate && typeof candidate === 'object' ? diffRulesBundles(current, candidate) : null;
  return json({ ok: validation.valid, validation, diff, candidateVersion: String(candidate?.version || '') }, validation.valid ? 200 : 400);
}

export async function onRequestPut(context) {
  const auth = await requireAdmin(context);
  if (auth) return auth;
  const kv = context.env.RISK_RULES;
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') {
    return json({ ok: false, error: 'RISK_RULES KV binding must support read/write access.' }, 503);
  }

  let body;
  try { body = await context.request.json(); } catch { return json({ ok: false, error: 'Invalid JSON request.' }, 400); }
  const action = String(body?.action || 'publish');
  const current = await loadCurrentRulesBundle(kv, { migrateLegacy: true });
  if (!current) return json({ ok: false, error: 'Current rules bundle is unavailable.' }, 503);

  if (action === 'rollback') {
    const snapshot = await loadHistoryBundle(kv, body?.historyKey);
    if (!snapshot) return json({ ok: false, error: 'Selected history snapshot is unavailable.' }, 404);
    const validation = validateRulesBundle(snapshot);
    if (!validation.valid) return json({ ok: false, error: 'History snapshot failed validation.', validation }, 400);
    await archiveRulesBundle(kv, current, `before rollback to ${snapshot.version || 'history'}`);
    const restored = { ...snapshot, updatedAt: new Date().toISOString(), restoredFromHistoryAt: new Date().toISOString() };
    await kv.put(RULES_KEY, JSON.stringify(restored));
    return json({
      ok: true,
      action: 'rollback',
      bundle: restored,
      validation: validateRulesBundle(restored),
      history: await listRulesHistory(kv),
      diff: diffRulesBundles(current, restored),
    });
  }

  if (action !== 'publish') return json({ ok: false, error: 'action must be publish or rollback.' }, 400);
  const prepared = preparePublishedBundle(body?.bundle, current);
  if (!prepared) return json({ ok: false, error: 'No rules bundle supplied.' }, 400);
  const validation = validateRulesBundle(prepared);
  if (!validation.valid) return json({ ok: false, error: 'Rules bundle failed validation.', validation }, 400);
  const diff = diffRulesBundles(current, prepared);
  if (!diff.changed) return json({ ok: false, error: 'No rule changes detected.' }, 400);

  await archiveRulesBundle(kv, current, `before publish ${prepared.version}`);
  await kv.put(RULES_KEY, JSON.stringify(prepared));
  return json({
    ok: true,
    action: 'publish',
    bundle: prepared,
    validation,
    diff,
    history: await listRulesHistory(kv),
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { 'allow': 'GET,POST,PUT,OPTIONS' } });
}

async function requireAdmin(context) {
  if (!(await isAdminRequest(context.request, context.env))) {
    return json({ ok: false, error: 'Admin unlock required.' }, 401);
  }
  return null;
}

function gptGuide(version) {
  return `You are editing the complete managed Risk Class JSON bundle currently at version ${version || 'unknown'}. The JSON bundle is the sole sportsbook rule authority; application code is only a generic interpreter and must not be treated as a fallback rule source. Apply only the requested rule changes. Preserve all unrelated instructions, knowledge, deterministic rules, resultPolicies, resultTransforms, IDs, regexes, provider filters and brand mappings exactly. Keep schemaVersion=1. Do not invent, remove or alter operational exceptions or review policies unless explicitly requested. Return the COMPLETE updated JSON file, not a patch, explanation, markdown fence or abbreviated excerpt. Update the version field to a new meaningful version.`;
}

function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
}
