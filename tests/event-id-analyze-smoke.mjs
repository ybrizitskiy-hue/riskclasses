import { onRequestPost } from '../functions/api/analyze.js';
import { ROUND_REVIEW_BASIS, ROUND_REVIEW_REASON } from '../functions/lib/input-contract.js';
import { baselineDeterministicRules } from '../functions/lib/rules-bundle.js';

let checks = 0;
let calls = [];

const instructions = `High -> Manual check No normally. Tennis or Snooker without an explicit match round keeps exact classes High with Manual check Yes and Basis ${ROUND_REVIEW_BASIS}. Medium -> Yes. Low -> Yes. Global is inherited by every brand without an explicit override, with no warning or recommendation marker. ${'Preserve approved rules and exact input fields. '.repeat(30)}`;
const knowledge = `## 7. Explicit RC I Football Leagues\n\n1. Test League - Testland\n\n## 8. End\n\nTennis SRL / Simulated Reality operational exception. Global applies to every unspecified brand. Tennis and Snooker missing-round review exception. ${'Approved risk class knowledge. '.repeat(120)}`;
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

const staleDeterministic = baselineDeterministicRules();
staleDeterministic.engineVersion = 1;
staleDeterministic.rules = staleDeterministic.rules.filter((rule) => !rule.providers?.length);
const staleBundle = {
  ...canonicalBundle,
  version: 'stale-v3-without-provider-rules',
  deterministicRules: staleDeterministic,
};
const staleEnv = {
  ...env,
  RISK_RULES: {
    async get() { return JSON.stringify(staleBundle); },
    async put() { throw new Error('Runtime additive upgrade must not silently publish over managed KV.'); },
  },
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
assert(data.rows[0].confidence === 'High' && data.rows[0].manualCheck === true, 'Tennis without a round must be High/Yes');
assert(data.rows[0].basis.includes(ROUND_REVIEW_BASIS), 'Tennis missing-round Basis note is required');
assert(data.rows[0].manualCheckReason === ROUND_REVIEW_REASON, 'Tennis missing-round reason is required');

calls = [];
response = await onRequestPost(context({
  mode: 'text',
  routingMode: 'auto',
  text: 'Sport\tCompetition\tCompetition ID\nTennis\tATP 250 Example. Men Singles Qualification\tBG-101',
}));
data = await response.json();
assert(response.status === 200 && calls.length === 0, 'Explicit Tennis qualification must stay deterministic');
assert(data.rows[0].dazn === 'RC E' && data.rows[0].quinnbet === 'RC E' && data.rows[0].nti === 'RC G', 'Betgenius ATP/WTA 250 qualification mapping must be E/E/G');
assert(data.rows[0].confidence === 'High' && data.rows[0].manualCheck === true, 'Qualification without a match round must be High/Yes');
assert(data.rows[0].basis.includes(ROUND_REVIEW_BASIS), 'Qualification without a match round must receive the explicit round note');
assert(data.rows[0].manualCheckReason === ROUND_REVIEW_REASON, 'Qualification missing-round reason is required');

calls = [];
response = await onRequestPost(context({
  mode: 'text',
  routingMode: 'auto',
  text: 'Sport\tCompetition\tCompetition ID\nTennis\tATP Challenger Nonthaburi 4, Thailand Men Singles - Challenger\tU-12680',
}, staleEnv));
data = await response.json();
assert(response.status === 200, `Stale-bundle Betradar request failed: ${JSON.stringify(data)}`);
assert(calls.length === 0, 'Runtime provider-rule upgrade must keep Betradar Challenger deterministic');
assert(data.rows[0].dazn === 'RC G' && data.rows[0].quinnbet === 'RC F' && data.rows[0].nti === 'RC G', 'Betradar Challenger Singles must be G/F/G, never Betgenius E/E/G');
assert(data.rows[0].confidence === 'High' && data.rows[0].manualCheck === true, 'Betradar Challenger without round must be High/Yes');
assert(data.rows[0].basis.includes('Betradar Challenger Singles') && data.rows[0].basis.includes(ROUND_REVIEW_BASIS), 'Betradar Challenger Basis must identify provider rule and missing round');


calls = [];
response = await onRequestPost(context({
  mode: 'text',
  routingMode: 'auto',
  text: [
    'Sport\tCompetition\tCompetition ID',
    'Tennis\tATP Brisbane 3 Challenger Qualification - Australia\tBG-25755',
    'Tennis\tATP Oeiras 5 Challenger Doubles - Portugal\tBG-17060',
    'Tennis\tATP Challenger Nonthaburi 4, Thailand Men Singles - Challenger\tU-12680',
    'Tennis\tATP Noumea Challenger Qualification - New Caledonia\tBG-14550',
    'Tennis\tATP Canberra Challenger Qualification - Australia\tBG-14551',
  ].join('\n'),
}, staleEnv));
data = await response.json();
assert(response.status === 200, `Screenshot regression batch failed: ${JSON.stringify(data)}`);
assert(calls.length === 0, 'All five screenshot rows must resolve deterministically without classification AI');
assert(data.telemetry.deterministicCount === 5 && data.telemetry.aiRows === 0, 'Screenshot regression batch must be 5/5 deterministic');
const screenshotExpected = [
  ['BG-25755', 'RC G', 'RC F', 'RC G'],
  ['BG-17060', 'RC G', 'RC F', 'RC G'],
  ['U-12680', 'RC G', 'RC F', 'RC G'],
  ['BG-14550', 'RC G', 'RC F', 'RC G'],
  ['BG-14551', 'RC G', 'RC F', 'RC G'],
];
for (const [index, expected] of screenshotExpected.entries()) {
  const row = data.rows[index];
  assert(row.competitionId === expected[0], `Screenshot row ${index + 1} Competition ID changed`);
  assert(row.dazn === expected[1] && row.quinnbet === expected[2] && row.nti === expected[3], `Screenshot row ${row.competitionId} must be G/F/G`);
  assert(row.confidence === 'High' && row.manualCheck === true, `Screenshot row ${row.competitionId} must be High/Yes because no match round is supplied`);
  assert(row.basis.includes(ROUND_REVIEW_BASIS) && row.manualCheckReason === ROUND_REVIEW_REASON, `Screenshot row ${row.competitionId} must explicitly state the missing-round review`);
}

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
assert(data.rows[0].confidence === 'High' && data.rows[0].manualCheck === true, 'Exact AI Tennis result without round must be High/Yes');
assert(data.rows[0].basis.includes(ROUND_REVIEW_BASIS), 'AI Tennis missing-round Basis note is required');
for (const marker of [
  'Betradar (U): Challenger G/F/G',
  'Betgenius (BG): Challenger Qual G/F/G; Challenger main E/E/G',
  'ATP/WTA 250 Qual E/E/G; ATP/WTA 250 main D/D/E',
  'Databet (DB): Challenger G/F/G',
  'A U/Betradar Challenger Singles row is always G/F/G',
]) {
  assert(calls[0].developerText.includes(marker), `Classifier hard prompt is missing provider matrix marker: ${marker}`);
}
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
assert(data.rows[0].confidence === 'Medium' && data.rows[0].manualCheck === true, 'A genuine Global recommendation must stay Medium/Yes despite missing round');
assert(data.rows[0].basis.includes(ROUND_REVIEW_BASIS), 'Recommended Tennis row must still explicitly mention the missing round');

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
assert(data.rows[0].confidence === 'High' && data.rows[0].manualCheck === true && data.rows[0].basis.includes(ROUND_REVIEW_BASIS), 'Extracted Tennis row without round must be High/Yes with note');

calls = [];
response = await onRequestPost(context({
  mode: 'text',
  routingMode: 'auto',
  text: 'Sport\tCompetition\nTennis\tWT Bydgoszcz. Poland. Women Singles',
}));
data = await response.json();
assert(response.status === 200 && calls.length === 0, 'Legacy two-column deterministic input must stay supported');
assert(data.rows[0].competitionId === '' && data.rows[0].dazn === 'RC G', 'Legacy two-column result is wrong');
assert(data.rows[0].confidence === 'High' && data.rows[0].manualCheck === true && data.rows[0].basis.includes(ROUND_REVIEW_BASIS), 'Legacy Tennis row without a match round must be High/Yes with note');

calls = [];
response = await onRequestPost(context({
  mode: 'text',
  routingMode: 'auto',
  text: 'Sport\tCompetition\nTennis\tITF M15 Trier Qualification - Germany',
}));
data = await response.json();
assert(response.status === 200 && calls.length === 0, 'Explicit ITF qualification must stay deterministic');
assert(data.rows[0].confidence === 'High' && data.rows[0].manualCheck === true, 'ITF qualification without a match round must be High/Yes');
assert(data.rows[0].basis.includes(ROUND_REVIEW_BASIS), 'ITF qualification without a match round must state the round review');

calls = [];
response = await onRequestPost(context({
  mode: 'text',
  routingMode: 'auto',
  text: 'Sport\tCompetition\nSnooker\tBritish Open',
}));
data = await response.json();
assert(response.status === 200 && calls.length === 1, 'Unresolved Snooker row must use one AI call');
assert(data.rows[0].dazn === 'RC D' && data.rows[0].quinnbet === 'RC D' && data.rows[0].nti === 'RC D', 'Snooker exact result is wrong');
assert(data.rows[0].confidence === 'High' && data.rows[0].manualCheck === true, 'Snooker without round must be promoted to High/Yes when classes are exact');
assert(data.rows[0].basis.includes(ROUND_REVIEW_BASIS), 'Snooker missing-round Basis note is required');

calls = [];
response = await onRequestPost(context({
  mode: 'text',
  routingMode: 'auto',
  text: 'Sport\tCompetition\nSnooker\tWorld Championship Quarterfinal',
}));
data = await response.json();
assert(response.status === 200 && calls.length === 1, 'Staged Snooker row must use one AI call');
assert(data.rows[0].dazn === 'RC A' && data.rows[0].quinnbet === 'RC A' && data.rows[0].nti === 'RC A', 'Staged Snooker exact result is wrong');
assert(data.rows[0].confidence === 'High' && data.rows[0].manualCheck === false, 'Explicit Snooker round must remain High/No');
assert(!data.rows[0].basis.includes(ROUND_REVIEW_BASIS), 'Explicit Snooker round must not receive missing-round note');

console.log(`event ID analyze smoke tests passed (${checks} checks)`);

function describeFetchRequest(request) {
  const extraction = request.text?.format?.name === 'risk_class_row_extraction'
    || request.response_format?.json_schema?.name === 'risk_class_row_extraction';
  return {
    kind: extraction ? 'extraction' : 'classifier',
    inputText: extraction ? allText(request) : classifierText(request),
    developerText: developerTextFromRequest(request),
  };
}

function describeDirectRequest(options) {
  return {
    kind: options.schemaName === 'risk_class_row_extraction' ? 'extraction' : 'classifier',
    inputText: options.input?.[1]?.content?.[0]?.text || '',
    developerText: options.input?.[0]?.content?.map?.((part) => part?.text || '').join('') || '',
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

  if (descriptor.inputText.includes('"competitionId":"BG-200"')) {
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

  if (descriptor.inputText.includes('"competition":"British Open"')) {
    return {
      rows: [{
        inputIndex,
        sport: 'Snooker',
        competition: 'British Open',
        global: 'RC D',
        dazn: '',
        quinnbet: '',
        nti: '',
        basis: 'Other World Snooker Tour tournament',
        confidence: 'Medium',
        sources: ['Risk Class guide'],
        manualCheck: true,
        needsEscalation: false,
        escalationReason: '',
      }],
      warnings: [],
    };
  }

  if (descriptor.inputText.includes('"competition":"World Championship Quarterfinal"')) {
    return {
      rows: [{
        inputIndex,
        sport: 'Snooker',
        competition: 'World Championship Quarterfinal',
        global: 'RC A',
        dazn: '',
        quinnbet: '',
        nti: '',
        basis: 'Triple Crown quarterfinal',
        confidence: 'High',
        sources: ['Risk Class guide'],
        manualCheck: false,
        needsEscalation: false,
        escalationReason: '',
      }],
      warnings: [],
    };
  }

  throw new Error(`Unexpected classifier input: ${descriptor.inputText}`);
}

function classifierText(request) {
  if (Array.isArray(request.input)) return request.input?.[1]?.content?.[0]?.text || '';
  const message = request.messages?.find((item) => item.role === 'user');
  if (typeof message?.content === 'string') return message.content;
  return (message?.content || []).map((item) => item?.text || '').join('');
}

function developerTextFromRequest(request) {
  if (Array.isArray(request.input)) {
    return (request.input?.[0]?.content || []).map((item) => item?.text || '').join('');
  }
  const message = request.messages?.find((item) => item.role === 'system' || item.role === 'developer');
  if (typeof message?.content === 'string') return message.content;
  return (message?.content || []).map((item) => item?.text || '').join('');
}

function allText(request) {
  return JSON.stringify(request.input || request.messages || []);
}

function context(body, envOverride = env) {
  return {
    env: envOverride,
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
