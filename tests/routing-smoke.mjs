import { buildRuntimeIndex, classifyDeterministic } from '../functions/lib/deterministic.js';
import { baselineDeterministicRules } from '../functions/lib/rules-bundle.js';
import { onRequestPost } from '../functions/api/analyze.js';

const knowledge = `## 7. Explicit RC I Football Leagues\n\n1. Test League - Testland\n\n## 8. End\n\nTennis SRL / Simulated Reality operational exception.\n${'Approved risk class knowledge. '.repeat(120)}`;
const instructions = `High -> Manual check No. Medium -> Yes. Low -> Yes. rec. can never be High. ${'Preserve approved rules and brand mappings. '.repeat(30)}`;
const canonicalBundle = {
  schemaVersion: 1,
  version: '2026-08-11-v2',
  instructions,
  knowledge,
  deterministicRules: baselineDeterministicRules(),
};
const index = buildRuntimeIndex(canonicalBundle);
const deterministicCases = [
  ['Tennis','WT Bydgoszcz. Poland. Women Singles','RC G','RC F','RC G'],
  ['Tennis','ITF M15 Trier Qualification - Germany','RC H','RC G','RC H'],
  ['Tennis','WT Tianjin. China. Women Doubles','RC H','RC G','RC H'],
  ['Tennis','SRL Summer Invitational - Simulated Reality','RC H','RC H','RC H'],
  ['Golf','PGA Tour 2026 - 3M Open','RC B','RC B','RC B'],
  ['Golf','Boeing Classic 2026 - Men','RC C','RC C','RC C'],
  ['Golf','The Open Championship - Round 3','RC A','RC A','RC A'],
  ['Table Tennis','WTT Feeder Ulaanbaatar. Women Singles','RC D','RC D','RC D'],
  ['Badminton','Malaysia International, MS - International','RC D','RC D','RC D'],
  ['MMA','Dana Whites Contender Series: Season 10 - UFC','RC E','RC E','RC E'],
  ['Football','Test League - Testland','RC I','RC I','RC I'],
];

for (const [sport, competition, dazn, qb, nti] of deterministicCases) {
  const result = classifyDeterministic({ sport, competition }, index);
  assert(result, `No deterministic result for ${competition}`);
  assert(result.dazn === dazn && result.quinnbet === qb && result.nti === nti, `Wrong class for ${competition}`);
  assert(result.confidence === 'High' && result.manualCheck === false, `Wrong confidence for ${competition}`);
}
assert(classifyDeterministic({ sport:'Golf', competition:'Genesis Scottish Open - Round 1' }, index) === null, 'Unknown-tour Golf event must route to AI');

const rulesPayload = JSON.stringify(canonicalBundle);
const env = { OPENAI_API_KEY:'test', RISK_RULES:{ async get(){ return rulesPayload; } } };
const calls = [];
globalThis.fetch = async (_url, init) => {
  const request = JSON.parse(init.body);
  calls.push(request);
  if (request.text?.format?.name === 'risk_class_row_extraction') {
    return openAIResponse({ rows:[{sport:'Golf',competition:'PGA Tour 2026 - 3M Open'}], warnings:[] }, request.model);
  }
  const inputText = request.input?.[1]?.content?.[0]?.text || '';
  const inputIndex = Number(/"inputIndex":(\d+)/.exec(inputText)?.[1] || 0);
  if (request.model === 'gpt-5.6-luna') {
    return openAIResponse({ rows:[{ inputIndex, sport:'Cricket', competition:'Mystery Cup', dazn:'RC G rec.', quinnbet:'RC G rec.', nti:'RC G', basis:'Analogy', confidence:'High', sources:['Risk Class guide'], manualCheck:false, needsEscalation:true, escalationReason:'Tier unclear' }], warnings:[] }, request.model);
  }
  return openAIResponse({ rows:[{ inputIndex, sport:'Cricket', competition:'Mystery Cup', dazn:'RC G rec.', quinnbet:'RC G rec.', nti:'RC G', basis:'Researched analogy', confidence:'Medium', sources:['Official source'], manualCheck:true, needsEscalation:false, escalationReason:'' }], warnings:[] }, request.model);
};

calls.length = 0;
let response = await onRequestPost(context({ mode:'text', routingMode:'auto', text:'Sport\tCompetition\nTennis\tWT Bydgoszcz. Poland. Women Singles' }));
let data = await response.json();
assert(data.rows[0].dazn === 'RC G' && data.telemetry.deterministicCount === 1 && calls.length === 0, 'Deterministic text should make no OpenAI call');

calls.length = 0;
response = await onRequestPost(context({ mode:'image', routingMode:'auto', images:['data:image/png;base64,AAAA'], text:'' }));
data = await response.json();
assert(data.rows[0].dazn === 'RC B' && calls.length === 1 && calls[0].model === 'gpt-5.6-luna' && calls[0].reasoning.effort === 'low', 'Image route should use Luna Low extraction only when classification is deterministic');

calls.length = 0;
response = await onRequestPost(context({ mode:'text', routingMode:'economy', text:'Sport\tCompetition\nCricket\tMystery Cup' }));
data = await response.json();
assert(calls.length === 1 && calls[0].model === 'gpt-5.6-luna', 'Economy must use Luna only');
assert(data.rows[0].confidence === 'Medium' && data.rows[0].manualCheck === true, 'rec. must force Medium/Yes');

calls.length = 0;
response = await onRequestPost(context({ mode:'text', routingMode:'auto', text:'Sport\tCompetition\nCricket\tMystery Cup' }));
data = await response.json();
assert(calls.length === 2 && calls[0].model === 'gpt-5.6-luna' && calls[1].model === 'gpt-5.6-terra', 'Auto must escalate material uncertainty to Terra');
assert(data.telemetry.escalatedCount === 1, 'Auto escalation telemetry missing');

calls.length = 0;
response = await onRequestPost(context({ mode:'text', routingMode:'quality', text:'Sport\tCompetition\nCricket\tMystery Cup' }));
data = await response.json();
assert(calls.length === 1 && calls[0].model === 'gpt-5.6-terra', 'Quality must use Terra direct');

console.log(`routing smoke tests passed (${deterministicCases.length + 5} checks)`);

function context(body) {
  return { env, request:new Request('https://example.test/api/analyze',{ method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) }) };
}
function openAIResponse(result, model) {
  return new Response(JSON.stringify({ model, usage:{ input_tokens:1000, input_tokens_details:{cached_tokens:500}, output_tokens:100, output_tokens_details:{reasoning_tokens:20} }, output:[{ type:'message', content:[{ type:'output_text', text:JSON.stringify(result) }] }] }), { status:200, headers:{'content-type':'application/json'} });
}
function assert(condition, message) { if (!condition) throw new Error(message); }
