import { buildRuntimeIndex, classifyDeterministic } from '../lib/deterministic.js';

const RULES_KEY = 'custom-gpt-v2';
const MAX_IMAGES = 4;
const MAX_TEXT_CHARS = 50000;
const LUNA_MODEL = 'gpt-5.6-luna';
const TERRA_MODEL = 'gpt-5.6-terra';
const WEB_SEARCH_USD = 0.01;

const MODEL_PRICES = {
  'gpt-5.6-luna': { input: 1.00, cached: 0.10, output: 6.00 },
  'gpt-5.6-terra': { input: 2.50, cached: 0.25, output: 15.00 },
};

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

  const rulesPayload = await loadRules(context.env.RISK_RULES);
  if (!rulesPayload) {
    return json({ error: `Risk rules are not configured in KV key "${RULES_KEY}".` }, 503);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON request.' }, 400);
  }

  const mode = body?.mode === 'text' ? 'text' : 'image';
  const routingMode = ['auto', 'economy', 'quality'].includes(body?.routingMode) ? body.routingMode : 'auto';
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
    if (!context.env.OPENAI_API_KEY) {
      return json({ error: 'OPENAI_API_KEY is not configured in this Cloudflare Pages project.' }, 503);
    }
    const extraction = await extractRowsFromImages(context.env, images, telemetryCalls);
    if (!extraction.ok) return json({ error: extraction.error }, extraction.status || 502);
    rows = extraction.result.rows || [];
    warnings.push(...(extraction.result.warnings || []));
  } else {
    rows = parseTextRows(text);
    if (!rows.length) {
      return json({ error: 'Could not identify Sport + Competition rows in the pasted text.' }, 400);
    }
  }

  rows = rows
    .map((row, inputIndex) => ({ inputIndex, sport: String(row.sport || '').trim(), competition: String(row.competition || '').trim() }))
    .filter((row) => row.sport && row.competition);

  const runtimeIndex = buildRuntimeIndex(rulesPayload.knowledge);
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

  let escalatedCount = 0;
  if (unresolved.length) {
    if (!context.env.OPENAI_API_KEY) {
      return json({ error: 'OPENAI_API_KEY is required for rows that are not resolved by deterministic rules.' }, 503);
    }

    if (routingMode === 'quality') {
      const quality = await classifyWithModel({
        env: context.env,
        rows: unresolved,
        rules: rulesPayload,
        model: context.env.OPENAI_TERRA_MODEL || TERRA_MODEL,
        reasoning: 'medium',
        stage: 'quality',
        telemetryCalls,
      });
      if (!quality.ok) return json({ error: quality.error }, quality.status || 502);
      warnings.push(...(quality.result.warnings || []));
      for (const row of quality.result.rows || []) finalByIndex.set(row.inputIndex, enforceConsistency(row));
    } else {
      const luna = await classifyWithModel({
        env: context.env,
        rows: unresolved,
        rules: rulesPayload,
        model: context.env.OPENAI_LUNA_MODEL || LUNA_MODEL,
        reasoning: 'medium',
        stage: routingMode === 'economy' ? 'economy' : 'auto-primary',
        telemetryCalls,
      });
      if (!luna.ok) return json({ error: luna.error }, luna.status || 502);
      warnings.push(...(luna.result.warnings || []));

      const lunaRows = (luna.result.rows || []).map(enforceConsistency);
      if (routingMode === 'economy') {
        for (const row of lunaRows) finalByIndex.set(row.inputIndex, row);
      } else {
        const escalationRows = [];
        const lunaByIndex = new Map(lunaRows.map((row) => [row.inputIndex, row]));
        for (const input of unresolved) {
          const result = lunaByIndex.get(input.inputIndex);
          if (result?.needsEscalation) escalationRows.push(input);
          else if (result) finalByIndex.set(input.inputIndex, result);
        }

        escalatedCount = escalationRows.length;
        if (escalationRows.length) {
          const terra = await classifyWithModel({
            env: context.env,
            rows: escalationRows,
            rules: rulesPayload,
            model: context.env.OPENAI_TERRA_MODEL || TERRA_MODEL,
            reasoning: 'medium',
            stage: 'auto-escalation',
            telemetryCalls,
          });

          if (terra.ok) {
            warnings.push(...(terra.result.warnings || []));
            for (const row of terra.result.rows || []) finalByIndex.set(row.inputIndex, enforceConsistency(row));
          } else {
            warnings.push(`Terra escalation failed; Luna results retained for ${escalationRows.length} row(s).`);
            for (const input of escalationRows) {
              const fallback = lunaByIndex.get(input.inputIndex);
              if (fallback) finalByIndex.set(input.inputIndex, fallback);
            }
          }
        }
      }
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
    escalatedCount,
  });

  return json({ rows: finalRows, warnings, telemetry }, 200, { 'cache-control': 'no-store' });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

async function extractRowsFromImages(env, images, telemetryCalls) {
  const model = env.OPENAI_EXTRACT_MODEL || LUNA_MODEL;
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

  return callOpenAI({
    env,
    model,
    reasoning: 'low',
    stage: 'extract',
    input,
    schema: EXTRACTION_SCHEMA,
    schemaName: 'risk_class_row_extraction',
    useWeb: false,
    promptCacheKey: 'riskclasses-row-extraction-v1',
    telemetryCalls,
  });
}

async function classifyWithModel({ env, rows, rules, model, reasoning, stage, telemetryCalls }) {
  const developerPrompt = buildDeveloperPrompt(rules);
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

  return callOpenAI({
    env,
    model,
    reasoning,
    stage,
    input,
    schema: CLASSIFIER_SCHEMA,
    schemaName: 'risk_class_analysis',
    useWeb: true,
    promptCacheKey: `riskclasses-${rules.version || 'v2'}-${model}-classifier`,
    telemetryCalls,
  });
}

async function callOpenAI({ env, model, reasoning, stage, input, schema, schemaName, useWeb, promptCacheKey, telemetryCalls }) {
  const requestBody = {
    model,
    store: false,
    reasoning: { effort: reasoning },
    input,
    text: {
      format: { type: 'json_schema', name: schemaName, strict: true, schema },
    },
    prompt_cache_key: promptCacheKey,
    prompt_cache_retention: '24h',
  };

  if (useWeb) {
    requestBody.tools = [{ type: 'web_search', search_context_size: 'low' }];
    requestBody.tool_choice = 'auto';
    requestBody.max_tool_calls = 3;
  }

  let upstream;
  try {
    upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    return { ok: false, status: 502, error: `Could not reach OpenAI: ${error?.message || String(error)}` };
  }

  const data = await upstream.json().catch(() => ({}));
  telemetryCalls.push(callTelemetry(data, { model, reasoning, stage, useWeb }));

  if (!upstream.ok) {
    return {
      ok: false,
      status: upstream.status >= 500 ? 502 : upstream.status,
      error: data?.error?.message || `OpenAI returned HTTP ${upstream.status}`,
    };
  }

  const outputText = extractOutputText(data);
  if (!outputText) return { ok: false, status: 502, error: `OpenAI returned no structured output during ${stage}.` };

  try {
    return { ok: true, result: JSON.parse(outputText) };
  } catch {
    return { ok: false, status: 502, error: `OpenAI returned invalid structured output during ${stage}.` };
  }
}

async function loadRules(kv) {
  let raw;
  try {
    raw = await kv.get(RULES_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.instructions !== 'string' || typeof parsed.knowledge !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildDeveloperPrompt(rules) {
  return `${rules.instructions}\n\n--- CANONICAL KNOWLEDGE SOURCE ---\n${rules.knowledge}\n\n--- WEBSITE ROUTING CONTRACT (HARD) ---\nThe canonical instructions and knowledge above remain the authority. These rows were not resolved by the deterministic exact-rule layer, so classify them with the same Custom GPT behavior. Return only structured output. Keep inputIndex unchanged and preserve sport/competition text exactly. Always return DAZN, Quinnbet and NTI. Confidence is confidence in the FINAL three-brand answer: High => manualCheck false; Medium/Low => manualCheck true; any value containing 'rec.' cannot be High; any 'Manual check / missing rule' forces Low. Apply exact/operational rules before analogy. Use web search only when current facts such as tournament tier, tour, division, qualifier status, participant level or esports tier are genuinely needed. Do not browse merely to confirm an exact rule. Never invent brand overrides. Tennis Virtuals/SRL/Simulated Reality are RC H for all three while the not-offered exception is active. Set needsEscalation=true ONLY when the competition/base classification remains materially uncertain after available research and a stronger model could plausibly change the answer. Do NOT escalate merely because a brand cell is blank, a confirmed Global-based value is marked rec., or Manual check is required only for missing brand-specific guidance.`;
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
    if (sport && competition && !(/^sport$/i.test(sport) && /^competition/i.test(competition))) {
      output.push({ sport, competition });
    }
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

function extractOutputText(response) {
  for (const item of response?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return '';
}

function callTelemetry(response, { model, reasoning, stage, useWeb }) {
  const usage = response?.usage || {};
  const inputTokens = Number(usage.input_tokens || 0);
  const cachedInputTokens = Number(usage.input_tokens_details?.cached_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  const reasoningTokens = Number(usage.output_tokens_details?.reasoning_tokens || 0);
  const webSearchCalls = useWeb ? countWebSearchCalls(response) : 0;
  const price = MODEL_PRICES[model] || null;
  const uncachedInput = Math.max(0, inputTokens - cachedInputTokens);
  let estimatedUsd = null;
  let cacheWriteCeilingUsd = null;
  if (price) {
    estimatedUsd = (uncachedInput * price.input + cachedInputTokens * price.cached + outputTokens * price.output) / 1_000_000 + webSearchCalls * WEB_SEARCH_USD;
    cacheWriteCeilingUsd = (uncachedInput * price.input * 1.25 + cachedInputTokens * price.cached + outputTokens * price.output) / 1_000_000 + webSearchCalls * WEB_SEARCH_USD;
  }
  return {
    stage,
    model,
    reasoning,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    webSearchCalls,
    estimatedUsd,
    cacheWriteCeilingUsd,
  };
}

function countWebSearchCalls(response) {
  let count = 0;
  for (const item of response?.output || []) if (item?.type === 'web_search_call') count += 1;
  return count;
}

function summarizeTelemetry({ routingMode, calls, totalRows, deterministicCount, unresolvedCount, escalatedCount }) {
  const estimatedUsd = calls.reduce((sum, call) => sum + (Number(call.estimatedUsd) || 0), 0);
  const cacheWriteCeilingUsd = calls.reduce((sum, call) => sum + (Number(call.cacheWriteCeilingUsd) || 0), 0);
  return {
    routingMode,
    totalRows,
    deterministicCount,
    aiRows: unresolvedCount,
    escalatedCount,
    models: [...new Set(calls.map((call) => call.model))],
    inputTokens: calls.reduce((sum, call) => sum + call.inputTokens, 0),
    cachedInputTokens: calls.reduce((sum, call) => sum + call.cachedInputTokens, 0),
    outputTokens: calls.reduce((sum, call) => sum + call.outputTokens, 0),
    reasoningTokens: calls.reduce((sum, call) => sum + call.reasoningTokens, 0),
    webSearchCalls: calls.reduce((sum, call) => sum + call.webSearchCalls, 0),
    estimatedUsd,
    cacheWriteCeilingUsd,
    calls,
    estimateNote: 'Estimated from published token/search prices. The first uncached prompt-cache write can cost up to 1.25x input rate; cacheWriteCeilingUsd reflects that ceiling.',
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
