const DEFAULT_MODEL = 'gpt-5.6-terra';
const RULES_KEY = 'custom-gpt-v2';
const MAX_IMAGES = 4;
const MAX_TEXT_CHARS = 50000;

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rows', 'warnings'],
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sport', 'competition', 'dazn', 'quinnbet', 'nti', 'basis', 'confidence', 'sources', 'manualCheck'],
        properties: {
          sport: { type: 'string' },
          competition: { type: 'string' },
          dazn: { type: 'string' },
          quinnbet: { type: 'string' },
          nti: { type: 'string' },
          basis: { type: 'string' },
          confidence: { type: 'string', enum: ['High', 'Medium', 'Low'] },
          sources: { type: 'array', items: { type: 'string' } },
          manualCheck: { type: 'boolean' },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

export async function onRequestPost(context) {
  if (!context.env.OPENAI_API_KEY) {
    return json({ error: 'OPENAI_API_KEY is not configured in this Cloudflare Pages project.' }, 503);
  }
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
  const images = Array.isArray(body?.images) ? body.images.slice(0, MAX_IMAGES) : [];
  const text = String(body?.text || '').slice(0, MAX_TEXT_CHARS);

  if (mode === 'image' && !images.length) return json({ error: 'Attach at least one screenshot.' }, 400);
  if (mode === 'text' && !text.trim()) return json({ error: 'Paste at least one Sport + Competition row.' }, 400);
  if (images.some((value) => !/^data:image\/(png|jpeg|webp);base64,/i.test(String(value)))) {
    return json({ error: 'Unsupported image payload. Use PNG, JPG or WebP.' }, 400);
  }

  const developerPrompt = buildDeveloperPrompt(rulesPayload);
  const userContent = [];
  if (mode === 'image') {
    userContent.push({
      type: 'input_text',
      text: `Classify every logical Sport + Competition row from ${images.length} screenshot${images.length === 1 ? '' : 's'}. Preserve every user-facing competition name exactly as visible. Remove only obvious exact boundary-overlap duplicates between consecutive screenshots. Return DAZN, Quinnbet and NTI for every row.`,
    });
    for (const imageUrl of images) {
      userContent.push({ type: 'input_image', image_url: imageUrl, detail: 'original' });
    }
  } else {
    userContent.push({
      type: 'input_text',
      text: `Classify every logical Sport + Competition row below. Preserve competition names exactly as entered. Return DAZN, Quinnbet and NTI for every row.\n\n${text}`,
    });
  }

  const requestBody = {
    model: context.env.OPENAI_MODEL || DEFAULT_MODEL,
    reasoning: { effort: 'medium' },
    tools: [{ type: 'web_search' }],
    tool_choice: 'auto',
    input: [
      { role: 'developer', content: [{ type: 'input_text', text: developerPrompt }] },
      { role: 'user', content: userContent },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'risk_class_analysis',
        strict: true,
        schema: OUTPUT_SCHEMA,
      },
    },
  };

  let upstream;
  try {
    upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${context.env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    return json({ error: `Could not reach OpenAI: ${error?.message || String(error)}` }, 502);
  }

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return json({
      error: data?.error?.message || `OpenAI returned HTTP ${upstream.status}`,
      code: data?.error?.code || null,
    }, upstream.status >= 500 ? 502 : upstream.status);
  }

  const outputText = extractOutputText(data);
  if (!outputText) return json({ error: 'OpenAI returned no structured text output.' }, 502);

  let result;
  try {
    result = JSON.parse(outputText);
  } catch {
    return json({ error: 'OpenAI returned invalid structured output.' }, 502);
  }

  result.rows = Array.isArray(result.rows) ? result.rows.map(enforceConsistency) : [];
  result.warnings = Array.isArray(result.warnings) ? result.warnings : [];
  return json(result, 200, { 'cache-control': 'no-store' });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
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
  return `${rules.instructions}\n\n--- CANONICAL KNOWLEDGE SOURCE ---\n${rules.knowledge}\n\n--- WEBSITE CONTRACT (HARD) ---\nThe canonical knowledge and instructions above are the authority. Return only the structured result. Preserve user-facing competition names exactly as visible/entered. For multiple overlapping screenshots, remove only obvious exact boundary-overlap duplicates. Always return DAZN, Quinnbet and NTI unless the input is unreadable. Confidence is the confidence of the FINAL three-brand result. Enforce High => manualCheck false; Medium/Low => manualCheck true; any value containing 'rec.' cannot be High; any 'Manual check / missing rule' forces Low. Apply exact/operational rules before research. Use web search only when the knowledge does not establish a direct answer and current competition facts are genuinely needed. Do not browse for exact knowledge matches. Never invent a brand override. Tennis Virtuals/SRL/Simulated Reality are RC H for all three brands while the not-offered exception is active.`;
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

function extractOutputText(response) {
  for (const item of response?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return '';
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
