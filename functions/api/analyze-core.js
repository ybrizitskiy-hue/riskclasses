import { buildRuntimeIndex, classifyDeterministic } from '../lib/deterministic.js';
import { loadCurrentRulesBundle, validateRulesBundle } from '../lib/rules-bundle.js';
import {
  getModeProfiles,
  loadProviderConfig,
  profileRuntimeStatus,
  validateProviderConfig,
} from '../lib/provider-config.js';
import { callAiJson } from '../lib/ai-client.js';

const MAX_IMAGES = 4;
const MAX_TEXT_CHARS = 50000;

const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rows', 'warnings'],
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sport', 'competition'],
        properties: {
          sport: { type: 'string' },
          competition: { type: 'string' },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

const CLASSIFIER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rows', 'warnings'],
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'inputIndex', 'sport', 'competition', 'dazn', 'quinnbet', 'nti', 'basis',
          'confidence', 'sources', 'manualCheck', 'needsEscalation', 'escalationReason'
        ],
        properties: {
          inputIndex: { type: 'integer' },
          sport: { type: 'string' },
          competition: { type: 'string' },
          dazn: { type: 'string' },
          quinnbet: { type: 'string' },
          nti: { type: 'string' },
          basis: { type: 'string' },
          confidence: { type: 'string', enum: ['High', 'Medium', 'Low'] },
          sources: { type: 'array', items: { type: 'string' } },
          manualCheck: { type: 'boolean' },
          needsEscalation: { type: 'boolean' },
          escalationReason: { type: 'string' },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

export async function onRequestPost(context) {
  if (!context.env.RISK_RULES || typeof context.env.RISK_RULES.get !== 'function') {
    return json({ error: 'RISK_RULES KV binding is not configured.' }, 503);
  }

  const rulesPayload = await loadCurrentRulesBundle(context.env.RISK_RULES, { migrateLegacy: true });
  const rulesValidation = rulesPayload ? validateRulesBundle(rulesPayload) : { valid: false };
  if (!rulesPayload || !rulesValidation.valid) {
    return json({ error: 'Risk rules are missing or invalid. Open Admin → Rules Manager to validate/restore the canonical bundle.' }, 503);
  }

  const providerConfig = await loadProviderConfig(context.env);
  const providerValidation = validateProviderConfig(providerConfig, context.env);
  if (!providerValidation.valid) {
    return json({ error: 'AI provider configuration is invalid. Open Admin → AI providers and fix the configuration.' }, 503);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON request.' }, 400);
  }

  const mode = body?.mode === 'text' ? 'text' : 'image';
  const routingMode = ['auto', 'economy', 'quality'].includes(body?.routingMode) ? body.routingMode : 'auto';
  const route = getModeProfiles(providerConfig, routingMode);
  const images = Array.isArray(body?.images) ? body.images.slice(0, MAX_IMAGES) : [];
  const text = String(body?.text || '').slice(0, MAX_TEXT_CHARS);
  const telemetryCalls = [];
  const warnings = [];

  if (mode === 'image' && !images.length) return json({ error: 'Attach at least one screenshot.' }, 400);
  if (mode === 'text' && !text.trim()) return json({ error: 'Paste at least one Sport + Competition row.' }, 400);
  if (images.some((value) => !/^data:image\/(png|jpeg|webp);base64,/i.test(String(value)))) {
    return json({ error: 'Unsupported image payload. Use PNG, JPG or WebP.' }, 400);
  }

  let rows = [];
  if (mode === 'image') {
    const ready = profileRuntimeStatus(context.env, providerConfig, route.extraction);
    if (!ready.ready) return json({ error: `Extraction provider is not ready: ${ready.reason}` }, 503);
    const extraction = await extractRowsFromImages(context.env, providerConfig, route.extraction, images, telemetryCalls);
    if (!extraction.ok) return json({ error: extraction.error }, extraction.status || 502);
    rows = extraction.result.rows || [];
    warnings.push(...(extraction.result.warnings || []));
  } else {
    rows = parseTextRows(text);
    if (!rows.length) return json({ error: 'Could not identify Sport + Competition rows in the pasted text.' }, 400);
  }

  rows = rows
    .map((row, inputIndex) => ({ inputIndex, sport: String(row.sport || '').trim(), competition: String(row.competition || '').trim() }))
    .filter((row) => row.sport && row.competition);

  const runtimeIndex = buildRuntimeIndex(rulesPayload);
  const finalByIndex = new Map();
  const unresolved = [];
  let deterministicCount = 0;

  for (const row of rows) {
    const deterministic = classifyDeterministic(row, runtimeIndex);
    if (deterministic) {
      finalByIndex.set(row.inputIndex, enforceConsistency({ ...deterministic, inputIndex: row.inputIndex }));
      deterministicCount += 1;
    } else {
      unresolved.push(row);
    }
  }

  let researchCount = 0;
  let escalatedCount = 0;
  if (unresolved.length) {
    const primaryReady = profileRuntimeStatus(context.env, providerConfig, route.primary);
    if (!primaryReady.ready) return json({ error: `Primary AI provider is not ready: ${primaryReady.reason}` }, 503);

    const primary = await classifyWithProfile({
      env: context.env,
      providerConfig,
      profile: route.primary,
      rows: unresolved,
      rules: rulesPayload,
      reasoning: routingMode === 'quality' ? 'medium' : 'medium',
      stage: `${routingMode}-primary`,
      telemetryCalls,
    });
    if (!primary.ok) return json({ error: primary.error }, primary.status || 502);
    warnings.push(...(primary.result.warnings || []));

    const latest = new Map();
    for (const result of primary.result.rows || []) latest.set(result.inputIndex, enforceConsistency(result));
    let pending = unresolved.filter((input) => latest.get(input.inputIndex)?.needsEscalation);

    if (pending.length && route.research) {
      const researchReady = profileRuntimeStatus(context.env, providerConfig, route.research);
      if (researchReady.ready) {
        const research = await classifyWithProfile({
          env: context.env,
          providerConfig,
          profile: route.research,
          rows: pending,
          rules: rulesPayload,
          reasoning: 'medium',
          stage: `${routingMode}-research`,
          telemetryCalls,
        });
        if (research.ok) {
          researchCount = pending.length;
          warnings.push(...(research.result.warnings || []));
          for (const result of research.result.rows || []) latest.set(result.inputIndex, enforceConsistency(result));
          pending = pending.filter((input) => latest.get(input.inputIndex)?.needsEscalation);
        } else {
          warnings.push(`Research provider failed; previous results retained. ${research.error}`);
        }
      } else {
        warnings.push(`Research provider is not ready; previous results retained. ${researchReady.reason}`);
      }
    }

    if (pending.length && route.escalation) {
      const escalationReady = profileRuntimeStatus(context.env, providerConfig, route.escalation);
      if (escalationReady.ready) {
        const escalation = await classifyWithProfile({
          env: context.env,
          providerConfig,
          profile: route.escalation,
          rows: pending,
          rules: rulesPayload,
          reasoning: 'medium',
          stage: `${routingMode}-escalation`,
          telemetryCalls,
        });
        if (escalation.ok) {
          escalatedCount = pending.length;
          warnings.push(...(escalation.result.warnings || []));
          for (const result of escalation.result.rows || []) latest.set(result.inputIndex, enforceConsistency(result));
          pending = [];
        } else {
          warnings.push(`Escalation provider failed; previous results retained. ${escalation.error}`);
        }
      } else {
        warnings.push(`Escalation provider is not ready; previous results retained. ${escalationReady.reason}`);
      }
    }

    for (const input of unresolved) {
      const result = latest.get(input.inputIndex);
      if (result) finalByIndex.set(input.inputIndex, result);
    }
  }

  const finalRows = rows.map((input) => {
    const result = finalByIndex.get(input.inputIndex);
    if (result) return stripInternal(result, input);
    return {
      sport: input.sport,
      competition: input.competition,
      dazn: 'Manual check / missing rule',
      quinnbet: 'Manual check / missing rule',
      nti: 'Manual check / missing rule',
      basis: 'No classification result returned',
      confidence: 'Low',
      sources: ['Risk Class guide'],
      manualCheck: true,
    };
  });

  const telemetry = summarizeTelemetry({
    routingMode,
    calls: telemetryCalls,
    totalRows: rows.length,
    deterministicCount,
    unresolvedCount: unresolved.length,
    researchCount,
    escalatedCount,
    providerConfigVersion: providerConfig.version,
  });

  return json({
    rows: finalRows,
    warnings,
    telemetry,
    rulesVersion: rulesPayload.version,
    providerConfigVersion: providerConfig.version,
  }, 200, { 'cache-control': 'no-store' });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

async function extractRowsFromImages(env, providerConfig, profile, images, telemetryCalls) {
  const input = [
    {
      role: 'developer',
      content: [{
        type: 'input_text',
        text: 'Extract Sport and Competition rows from spreadsheet-like screenshots. Preserve competition text exactly as visible, including punctuation, accents, country, gender, round and qualifier text. Keep top-to-bottom order. Across consecutive overlapping screenshots, remove only obvious exact boundary-overlap duplicates. Do not classify risk classes and do not research anything. If text is unreadable, omit that row and add a warning.',
      }],
    },
    {
      role: 'user',
      content: [
        { type: 'input_text', text: `Extract every logical Sport + Competition row from ${images.length} screenshot${images.length === 1 ? '' : 's'}.` },
        ...images.map((imageUrl) => ({ type: 'input_image', image_url: imageUrl, detail: 'original' })),
      ],
    },
  ];

  const result = await callAiJson({
    env,
    config: providerConfig,
    profile,
    reasoning: 'low',
    stage: 'extract',
    input,
    schema: EXTRACTION_SCHEMA,
    schemaName: 'risk_class_row_extraction',
    useWeb: false,
    promptCacheKey: 'riskclasses-row-extraction-v2',
  });
  if (result.telemetry) telemetryCalls.push(result.telemetry);
  return result;
}

async function classifyWithProfile({ env, providerConfig, profile, rows, rules, reasoning, stage, telemetryCalls }) {
  const webAvailable = Boolean(profile?.capabilities?.webSearch && profile?.protocol === 'responses');
  const developerPrompt = buildDeveloperPrompt(rules, { webAvailable });
  const compactRows = rows.map(({ inputIndex, sport, competition }) => ({ inputIndex, sport, competition }));
  const input = [
    { role: 'developer', content: [{ type: 'input_text', text: developerPrompt }] },
    {
      role: 'user',
      content: [{
        type: 'input_text',
        text: `Classify only the rows in this JSON array. Keep inputIndex unchanged and preserve sport/competition text exactly.\n\n${JSON.stringify(compactRows)}`,
      }],
    },
  ];

  const result = await callAiJson({
    env,
    config: providerConfig,
    profile,
    reasoning,
    stage,
    input,
    schema: CLASSIFIER_SCHEMA,
    schemaName: 'risk_class_analysis',
    useWeb: true,
    promptCacheKey: `riskclasses-${rules.version || 'rules'}-${providerConfig.version || 'providers'}-${profile.id}-classifier`,
  });
  if (result.telemetry) telemetryCalls.push(result.telemetry);
  return result;
}

function buildDeveloperPrompt(rules, { webAvailable }) {
  const researchContract = webAvailable
    ? 'A web-search tool is available in this stage. Use it only when current facts such as tournament tier, tour, division, qualifier status, participant level or esports tier are genuinely needed. Do not browse merely to confirm an exact rule.'
    : 'No web-search tool is available in this stage. If the answer materially depends on a current external fact that is not established by the canonical rules, make the best cautious answer you can and set needsEscalation=true so a research-capable or stronger configured provider can review it.';
  return `${rules.instructions}\n\n--- CANONICAL KNOWLEDGE SOURCE ---\n${rules.knowledge}\n\n--- WEBSITE ROUTING CONTRACT (HARD) ---\nThe canonical instructions and knowledge above remain the authority. These rows were not resolved by the deterministic exact-rule layer, so classify them with the same approved behavior. Return only structured output. Keep inputIndex unchanged and preserve sport/competition text exactly. Always return DAZN, Quinnbet and NTI. Confidence is confidence in the FINAL three-brand answer: High => manualCheck false; Medium/Low => manualCheck true; any value containing 'rec.' cannot be High; any 'Manual check / missing rule' forces Low. Apply exact/operational rules before analogy. ${researchContract} Never invent brand overrides. Tennis Virtuals/SRL/Simulated Reality are RC H for all three while the not-offered exception is active. Set needsEscalation=true ONLY when the competition/base classification remains materially uncertain and another configured research/quality model could plausibly change the answer. Do NOT escalate merely because a brand cell is blank, a confirmed Global-based value is marked rec., or Manual check is required only for missing brand-specific guidance.`;
}

function enforceConsistency(row) {
  const values = [row?.dazn, row?.quinnbet, row?.nti].map((value) => String(value || ''));
  const hasRec = values.some((value) => /\brec\./i.test(value));
  const hasMissing = values.some((value) => /manual check|missing rule/i.test(value));
  let confidence = ['High', 'Medium', 'Low'].includes(row?.confidence) ? row.confidence : 'Low';
  if (hasMissing) confidence = 'Low';
  else if (hasRec && confidence === 'High') confidence = 'Medium';
  const manualCheck = confidence !== 'High' || hasRec || hasMissing;
  return { ...row, confidence, manualCheck };
}

function stripInternal(row, input) {
  return {
    sport: input.sport,
    competition: input.competition,
    dazn: row.dazn,
    quinnbet: row.quinnbet,
    nti: row.nti,
    basis: row.basis,
    confidence: row.confidence,
    sources: Array.isArray(row.sources) ? row.sources : [],
    manualCheck: Boolean(row.manualCheck),
  };
}

function parseTextRows(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter((line) => line.trim());
  const output = [];
  let header = null;

  for (const raw of lines) {
    const parts = splitLine(raw);
    if (parts.length < 2) continue;
    const normalized = parts.map(normalizeHeader);
    const sportIndex = normalized.findIndex((value) => value === 'sport');
    const competitionIndex = normalized.findIndex((value) => value === 'competition' || value === 'competition name');
    if (sportIndex >= 0 && competitionIndex >= 0) {
      header = { sportIndex, competitionIndex };
      continue;
    }

    let sport = '';
    let competition = '';
    if (header) {
      sport = parts[header.sportIndex] || '';
      competition = parts[header.competitionIndex] || '';
    } else if (parts.length >= 3 && isKnownSport(parts[1])) {
      sport = parts[1];
      competition = parts[2];
    } else {
      sport = parts[0];
      competition = parts[1];
    }

    sport = String(sport || '').trim();
    competition = String(competition || '').trim();
    if (sport && competition && !(/^sport$/i.test(sport) && /^competition/i.test(competition))) output.push({ sport, competition });
  }
  return output;
}

function splitLine(line) {
  if (line.includes('\t')) return line.split('\t').map((value) => value.trim());
  if (line.includes(';')) return line.split(';').map((value) => value.trim());
  return line.split(/\s{2,}/).map((value) => value.trim()).filter(Boolean);
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function isKnownSport(value) {
  return new Set([
    'american football','aussie rules','badminton','bandy','baseball','basketball','beach volley','boxing','counter strike',
    'cricket','darts','dota 2','football','futsal','golf','handball','horse racing','ice hockey','league of legends','mma',
    'rugby league','rugby union','snooker','table tennis','tennis','valorant','volleyball','water polo'
  ]).has(normalizeHeader(value));
}

function summarizeTelemetry({ routingMode, calls, totalRows, deterministicCount, unresolvedCount, researchCount, escalatedCount, providerConfigVersion }) {
  const priced = calls.every((call) => call.estimatedUsd != null && Number.isFinite(Number(call.estimatedUsd)));
  const estimatedUsd = priced ? calls.reduce((sum, call) => sum + Number(call.estimatedUsd || 0), 0) : null;
  return {
    routingMode,
    providerConfigVersion,
    totalRows,
    deterministicCount,
    aiRows: unresolvedCount,
    researchCount,
    escalatedCount,
    models: [...new Set(calls.map((call) => call.providerLabel ? `${call.providerLabel} (${call.model})` : call.model).filter(Boolean))],
    providers: [...new Set(calls.map((call) => call.providerLabel).filter(Boolean))],
    inputTokens: calls.reduce((sum, call) => sum + Number(call.inputTokens || 0), 0),
    cachedInputTokens: calls.reduce((sum, call) => sum + Number(call.cachedInputTokens || 0), 0),
    outputTokens: calls.reduce((sum, call) => sum + Number(call.outputTokens || 0), 0),
    reasoningTokens: calls.reduce((sum, call) => sum + Number(call.reasoningTokens || 0), 0),
    webSearchCalls: calls.reduce((sum, call) => sum + Number(call.webSearchCalls || 0), 0),
    estimatedUsd,
    cacheWriteCeilingUsd: estimatedUsd,
    unpricedCalls: calls.filter((call) => call.estimatedUsd == null).length,
    calls,
    estimateNote: priced
      ? 'Estimated from the per-model prices configured in Admin → AI providers. This is an estimate, not an invoice.'
      : 'At least one provider profile has no complete pricing configured, so total estimated cost is unavailable.',
  };
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

function json(value, status = 200, extraHeaders = {}) {
  return Response.json(value, { status, headers: { ...corsHeaders(), ...extraHeaders } });
}
