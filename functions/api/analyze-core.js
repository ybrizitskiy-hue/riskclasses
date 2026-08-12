import { buildRuntimeIndex, classifyDeterministic } from '../lib/deterministic.js';
import { loadCurrentRulesBundle, validateRulesBundle } from '../lib/rules-bundle.js';
import {
  getModeProfiles,
  loadProviderConfig,
  profileRuntimeStatus,
  validateProviderConfig,
} from '../lib/provider-config.js';
import { effortFor, loadReasoningConfig } from '../lib/reasoning-config.js';
import { callAiJson } from '../lib/ai-client.js';
import {
  decorateInputRows,
  filterGlobalInheritanceWarnings,
  parseCompetitionRows,
  resolveGlobalBrands,
} from '../lib/input-contract.js';

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
        required: ['sport', 'competition', 'competitionId'],
        properties: {
          sport: { type: 'string' },
          competition: { type: 'string' },
          competitionId: { type: 'string' },
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
          'inputIndex', 'sport', 'competition', 'global', 'dazn', 'quinnbet', 'nti', 'basis',
          'confidence', 'sources', 'manualCheck', 'needsEscalation', 'escalationReason'
        ],
        properties: {
          inputIndex: { type: 'integer' },
          sport: { type: 'string' },
          competition: { type: 'string' },
          global: { type: 'string', enum: ['', 'RC A', 'RC B', 'RC C', 'RC D', 'RC E', 'RC F', 'RC G', 'RC H', 'RC I', 'RC A rec.', 'RC B rec.', 'RC C rec.', 'RC D rec.', 'RC E rec.', 'RC F rec.', 'RC G rec.', 'RC H rec.', 'RC I rec.'] },
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
  const reasoningConfig = await loadReasoningConfig(context.env);

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
    const extraction = await extractRowsFromImages(
      context.env,
      providerConfig,
      route.extraction,
      images,
      effortFor(reasoningConfig, routingMode, 'extraction'),
      routingMode,
      telemetryCalls,
    );
    if (!extraction.ok) return json({ error: extraction.error }, extraction.status || 502);
    rows = extraction.result.rows || [];
    warnings.push(...(extraction.result.warnings || []));
  } else {
    rows = parseCompetitionRows(text);
    if (!rows.length) return json({ error: 'Could not identify Sport + Competition rows in the pasted text.' }, 400);
  }

  rows = decorateInputRows(rows);

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
      reasoning: effortFor(reasoningConfig, routingMode, 'primary'),
      stage: `${routingMode}-primary`,
      telemetryCalls,
    });
    if (!primary.ok) return json({ error: primary.error }, primary.status || 502);
    appendClassifierWarnings(warnings, primary.result.warnings);

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
          reasoning: effortFor(reasoningConfig, routingMode, 'research'),
          stage: `${routingMode}-research`,
          telemetryCalls,
        });
        if (research.ok) {
          researchCount = pending.length;
          appendClassifierWarnings(warnings, research.result.warnings);
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
          reasoning: effortFor(reasoningConfig, routingMode, 'escalation'),
          stage: `${routingMode}-escalation`,
          telemetryCalls,
        });
        if (escalation.ok) {
          escalatedCount = pending.length;
          appendClassifierWarnings(warnings, escalation.result.warnings);
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
      competitionId: input.competitionId,
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
    reasoningConfigVersion: reasoningConfig.version,
  });

  return json({
    rows: finalRows,
    warnings,
    telemetry,
    rulesVersion: rulesPayload.version,
    providerConfigVersion: providerConfig.version,
    reasoningConfigVersion: reasoningConfig.version,
  }, 200, { 'cache-control': 'no-store' });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

async function extractRowsFromImages(env, providerConfig, profile, images, reasoning, routingMode, telemetryCalls) {
  const input = [
    {
      role: 'developer',
      content: [{
        type: 'input_text',
        text: 'Extract Sport, Competition and Competition ID/Event ID rows from spreadsheet-like screenshots. Preserve competition text and ID exactly as visible, including punctuation, accents, country, gender, round, qualifier text, capitalization and hyphens. If an older input has no ID column, return competitionId as an empty string. Keep top-to-bottom order. Across consecutive overlapping screenshots, remove only obvious exact boundary-overlap duplicates. Do not classify risk classes, infer the data provider or research anything. If material text is unreadable, omit that row and add a warning.',
      }],
    },
    {
      role: 'user',
      content: [
        { type: 'input_text', text: `Extract every logical Sport + Competition + Competition ID row from ${images.length} screenshot${images.length === 1 ? '' : 's'}.` },
        ...images.map((imageUrl) => ({ type: 'input_image', image_url: imageUrl, detail: 'original' })),
      ],
    },
  ];

  const result = await callAiJson({
    env,
    config: providerConfig,
    profile,
    reasoning,
    stage: `${routingMode}-extraction`,
    input,
    schema: EXTRACTION_SCHEMA,
    schemaName: 'risk_class_row_extraction',
    useWeb: false,
    promptCacheKey: 'riskclasses-row-extraction-v3',
  });
  if (result.telemetry) telemetryCalls.push(result.telemetry);
  return result;
}

async function classifyWithProfile({ env, providerConfig, profile, rows, rules, reasoning, stage, telemetryCalls }) {
  const webAvailable = Boolean(profile?.capabilities?.webSearch && profile?.protocol === 'responses');
  const developerPrompt = buildDeveloperPrompt(rules, { webAvailable });
  const compactRows = rows.map(({
    inputIndex,
    sport,
    competition,
    competitionId,
    dataProvider,
  }) => ({ inputIndex, sport, competition, competitionId, dataProvider }));
  const input = [
    { role: 'developer', content: [{ type: 'input_text', text: developerPrompt }] },
    {
      role: 'user',
      content: [{
        type: 'input_text',
        text: `Classify only the rows in this JSON array. Keep inputIndex unchanged and preserve sport, competition and competitionId context exactly.\n\n${JSON.stringify(compactRows)}`,
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
  return `${rules.instructions}\n\n--- CANONICAL KNOWLEDGE SOURCE ---\n${rules.knowledge}\n\n--- WEBSITE ROUTING CONTRACT (HARD) ---\nThe canonical instructions and knowledge above remain the authority. These rows were not resolved by the deterministic exact-rule layer, so classify them with the same approved behavior. Return only structured output. Keep inputIndex unchanged and preserve sport/competition text exactly. Competition ID is provider context: IDs starting BG are Betgenius, IDs starting DB are Databet, and IDs starting U are Betradar. Always return a Global/base field plus DAZN, Quinnbet and NTI. The Global field must be an exact RC A-I value, 'RC X rec.' only when the Global classification itself is a genuine analogy, or an empty string only when the canonical rules genuinely provide no Global value. Global is the default for every brand that has no explicit brand-specific override: a blank or Same as Global brand value MUST inherit the Global value exactly. Do not add a rec. marker, missing-rule warning or manual check solely because the brand override is absent. If Global itself is 'RC X rec.' because the base classification is a genuine analogy, every unspecified brand inherits that same 'RC X rec.' recommendation. Only use Manual check / missing rule when neither a Global value nor a brand-specific value can be established. Confidence is confidence in the FINAL three-brand answer: High => manualCheck false; Medium/Low => manualCheck true; any value containing 'rec.' cannot be High; any 'Manual check / missing rule' forces Low. Apply exact/operational rules before analogy. For Tennis Challenger, WTA 125, ATP/WTA 250, ATP/WTA 500, ATP/WTA 1000 and Grand Slam rows, apply the exact provider-specific new-competition rule in canonical Knowledge. If the event category is not explicit, use the official ATP Tour or WTA tournament calendar/page to verify the listed level or points; do not infer it from the event name alone. ${researchContract} Never invent brand overrides. Tennis Virtuals/SRL/Simulated Reality are RC H for all three while the not-offered exception is active. Set needsEscalation=true ONLY when the competition/base classification remains materially uncertain and another configured research/quality model could plausibly change the answer. Do NOT escalate merely because a brand uses inherited Global or because Manual check is required only for a genuinely unresolved rule.`;
}

function enforceConsistency(row) {
  const resolved = resolveGlobalBrands(row);
  const values = [resolved?.dazn, resolved?.quinnbet, resolved?.nti].map((value) => String(value || ''));
  const hasRec = values.some((value) => /\brec\./i.test(value));
  const hasMissing = values.some((value) => /manual check|missing rule/i.test(value));
  let confidence = ['High', 'Medium', 'Low'].includes(resolved?.confidence) ? resolved.confidence : 'Low';
  if (hasMissing) confidence = 'Low';
  else if (hasRec && confidence === 'High') confidence = 'Medium';
  const manualCheck = confidence !== 'High' || hasRec || hasMissing;
  return { ...resolved, confidence, manualCheck };
}

function stripInternal(row, input) {
  return {
    sport: input.sport,
    competition: input.competition,
    competitionId: input.competitionId,
    dazn: row.dazn,
    quinnbet: row.quinnbet,
    nti: row.nti,
    basis: row.basis,
    confidence: row.confidence,
    sources: Array.isArray(row.sources) ? row.sources : [],
    manualCheck: Boolean(row.manualCheck),
  };
}

function appendClassifierWarnings(target, values) {
  target.push(...filterGlobalInheritanceWarnings(values));
}

function summarizeTelemetry({ routingMode, calls, totalRows, deterministicCount, unresolvedCount, researchCount, escalatedCount, providerConfigVersion, reasoningConfigVersion }) {
  const priced = calls.every((call) => call.estimatedUsd != null && Number.isFinite(Number(call.estimatedUsd)));
  const estimatedUsd = priced ? calls.reduce((sum, call) => sum + Number(call.estimatedUsd || 0), 0) : null;
  return {
    routingMode,
    providerConfigVersion,
    reasoningConfigVersion,
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
