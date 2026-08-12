import { onRequestPost } from '../functions/api/analyze.js';
import { baselineDeterministicRules } from '../functions/lib/rules-bundle.js';

let checks = 0;
let calls = [];

const instructions = `High -> Manual check No. Medium -> Yes. Low -> Yes. Global is inherited by every brand without an explicit override, with no warning or recommendation marker. ${'Preserve approved rules and exact input fields. '.repeat(30)}`;
const knowledge = `## 7. Explicit RC I Football Leagues\n\n1. Test League - Testland\n\n## 8. End\n\nTennis SRL / Simulated Reality operational exception. Global applies to every unspecified brand. ${'Approved risk class knowledge. '.repeat(120)}`;
const canonicalBundle = {
  schemaVersion: 1,
  version: 'event-id-global-test',
  instructions,
  knowledge,
  deterministicRules: baselineDeterministicRules(),
};

const rulesPayload = JSON.stringify(canonicalBundle);
const env = {
  OPENAI_API_KEY: 'test',
  RISK_RULES: { async get() { return rulesPayload; } },
};

// The real repository client uses fetch. The compact local regression harness used
// during handover injects __riskTestAi. Defining both lets this same test cover both.
globalThis.fetch = async (_url, init) => {
  const request = JSON.parse(init.body);
  const descriptor = describeFetchRequest(request);
  calls.push(descriptor);
  const result = mockResult(descriptor);
  return openAIResponse(result, request.model);
};

globalThis.__riskTestAi = async (options) => {
  const descriptor = describeDirectRequest(options);
  calls.push(descriptor);
  return {
    ok: true,
    result: mockResult(descriptor),
    telemetry: {
      model: 'mock',
      providerLabel: 'Mock',
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
      reasoningTokens: 0,
      webSearchCalls: 0,
      estimatedUsd: 0,
    },
  };
};

calls = [];
let response = await onRequestPost(context({
  mode: 'text',
  routingMode: 'auto',
  text: 'Sport\tCompetition\tCompetition ID\nTennis\tATP 250 Example. Men Singles\tBG-100',
}));
let data = await response.json();
assert(response.status === 200, `Provider-aware deterministic request failed: ${JSON.stringify(data)}`);
assert(calls.length === 0, 'Provider-aware deterministic rule must not call AI');
assert(data.rows[0].competitionId === 'BG-100', 'Text result must preserve Competition ID');
assert(data.rows[0].dazn === 'RC D' && data.rows[0].quinnbet === 'RC D' && data.rows[0].nti === 'RC E', 'Betgenius ATP/WTA 250 main mapping must be D/D/E');
assert(data.rows[0].confidence === 'High' && data.rows[0].manualCheck === false, 'Exact provider rule must be High/No');

calls = [];
response = await onRequestPost(context({
  mode: 'text',
  routingMode: 'auto',
  text: 'Sport\tCompetition\tCompetition ID\nTennis\tMystery Open Singles\tBG-200',
}));
data = await response.json();
assert(response.status === 200 && calls.length === 1, 'Unresolved provider-aware row must use one AI classification call');
assert(calls[0].inputText.includes('"competitionId":"BG-200"'), 'Classifier input must preserve Competition ID');
assert(calls[0].inputText.includes('"dataProvider":"Betgenius"'), 'Classifier input must include mapped data provider');
assert(data.rows[0].competitionId === 'BG-200', 'AI result must preserve Competition ID');
assert(data.rows[0].dazn === 'RC E' && data.rows[0].quinnbet === 'RC E' && data.rows[0].nti === 'RC G', 'Global must fill unspecified brands while preserving explicit override');
assert(data.rows[0].confidence === 'High' && data.rows[0].manualCheck === false, 'Global inheritance alone must not force review');
assert(data.warnings.length === 0, 'Global inheritance-only warnings must be suppressed');

calls = [];
response = await onRequestPost(context({
  mode: 'text',
  routingMode: 'auto',
  text: 'Sport\tCompetition\tCompetition ID\nTennis\tAnalog Open Singles\tBG-201',
}));
data = await response.json();
assert(response.status === 200 && calls.length === 1, 'Recommended Global row must use one AI classification call');
assert(data.rows[0].dazn === 'RC F rec.' && data.rows[0].quinnbet === 'RC F rec.' && data.rows[0].nti === 'RC F rec.', 'A genuine Global recommendation must be inherited unchanged by every unspecified brand');
assert(data.rows[0].confidence === 'Medium' && data.rows[0].manualCheck === true, 'A genuine Global recommendation must force Medium/Yes');

calls = [];
response = await onRequestPost(context({
  mode: 'image',
  routingMode: 'auto',
  images: ['data:image/png;base64,AAAA'],
}));
data = await response.json();
assert(response.status === 200 && calls.length === 1 && calls[0].kind === 'extraction', 'Image path must call extraction only when extracted row is deterministic');
assert(data.rows[0].competitionId === 'DB-300', 'Image extraction must preserve Competition ID');
assert(data.rows[0].dazn === 'RC G' && data.rows[0].quinnbet === 'RC F' && data.rows[0].nti === 'RC G', 'Databet WTA 125 mapping must be G/F/G');

calls = [];
response = await onRequestPost(context({
  mode: 'text',
  routingMode: 'auto',
  text: 'Sport\tCompetition\nTennis\tWT Bydgoszcz. Poland. Women Singles',
}));
data = await response.json();
assert(response.status === 200 && calls.length === 0, 'Legacy two-column deterministic input must stay supported');
assert(data.rows[0].competitionId === '' && data.rows[0].dazn === 'RC G', 'Legacy two-column result is wrong');

console.log(`event ID analyze smoke tests passed (${checks} checks)`);

function describeFetchRequest(request) {
  const extraction = request.text?.format?.name === 'risk_class_row_extraction'
    || request.response_format?.json_schema?.name === 'risk_class_row_extraction';
  return {
    kind: extraction ? 'extraction' : 'classifier',
    inputText: extraction ? allText(request) : classifierText(request),
  };
}

function describeDirectRequest(options) {
  return {
    kind: options.schemaName === 'risk_class_row_extraction' ? 'extraction' : 'classifier',
    inputText: options.input?.[1]?.content?.[0]?.text || '',
  };
}

function mockResult(descriptor) {
  if (descriptor.kind === 'extraction') {
    return {
      rows: [{ sport: 'Tennis', competition: 'WTA 125 Example. Women Singles', competitionId: 'DB-300' }],
      warnings: [],
    };
  }

  const inputIndex = Number(/"inputIndex":(\d+)/.exec(descriptor.inputText)?.[1] || 0);
  if (descriptor.inputText.includes('"competitionId":"BG-201"')) {
    return {
      rows: [{
        inputIndex,
        sport: 'Tennis',
        competition: 'Analog Open Singles',
        global: 'RC F rec.',
        dazn: '',
        quinnbet: 'Same as Global',
        nti: '',
        basis: 'Strong same-sport analogy',
        confidence: 'High',
        sources: ['Risk Class guide'],
        manualCheck: false,
        needsEscalation: false,
        escalationReason: '',
      }],
      warnings: [],
    };
  }

  if (!descriptor.inputText.includes('"competitionId":"BG-200"')) {
    throw new Error(`Unexpected classifier input: ${descriptor.inputText}`);
  }
  return {
    rows: [{
      inputIndex,
      sport: 'Tennis',
      competition: 'Mystery Open Singles',
      global: 'RC E',
      dazn: '',
      quinnbet: 'Manual check / missing rule',
      nti: 'RC G',
      basis: 'Verified provider-specific tennis category',
      confidence: 'High',
      sources: ['Risk Class guide'],
      manualCheck: false,
      needsEscalation: false,
      escalationReason: '',
    }],
    warnings: ['No brand-specific rule for DAZN or Quinnbet; using Global.'],
  };
}

function classifierText(request) {
  if (Array.isArray(request.input)) return request.input?.[1]?.content?.[0]?.text || '';
  const message = request.messages?.find((item) => item.role === 'user');
  if (typeof message?.content === 'string') return message.content;
  return (message?.content || []).map((item) => item?.text || '').join('');
}

function allText(request) {
  return JSON.stringify(request.input || request.messages || []);
}

function context(body) {
  return {
    env,
    request: new Request('https://example.test/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  };
}

function openAIResponse(result, model) {
  return new Response(JSON.stringify({
    model,
    usage: {
      input_tokens: 1000,
      input_tokens_details: { cached_tokens: 500 },
      output_tokens: 100,
      output_tokens_details: { reasoning_tokens: 20 },
    },
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function assert(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}
