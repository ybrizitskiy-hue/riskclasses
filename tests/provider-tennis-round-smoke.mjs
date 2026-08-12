import { existsSync, readFileSync } from 'node:fs';
import { buildRuntimeIndex, classifyDeterministic } from '../functions/lib/deterministic.js';
import { enforceResultPolicy } from '../functions/lib/result-policy.js';
import { baselineDeterministicRules, validateRulesBundle } from '../functions/lib/rules-bundle.js';

let checks = 0;
const stageReason = 'Stage/round not provided — High confidence retained; stage check required.';
const provider = (id, providerName, all, none, dazn, quinnbet, nti) => ({
  id, sport: 'tennis', providers: [providerName],
  match: { any: [], all: [...all, `\\b(?:${providerName.toLowerCase()})\\b`], none },
  dazn, quinnbet, nti, basis: id, source: 'Managed JSON',
});
const c='\\bchallengers?\\b', q='\\b(qualification|qualifier|qualifying|quals?|q[1-4])\\b', d='\\bdoubles?\\b';
const rules = [
  provider('br-chal','Betradar',[c],[d],'RC G','RC F','RC G'),
  provider('bg-chal-q','Betgenius',[c,q],[d],'RC G','RC F','RC G'),
  provider('bg-chal','Betgenius',[c],[q,d],'RC G','RC G','RC G'),
  provider('db-chal','Databet',[c],[d],'RC G','RC F','RC G'),
  { id:'snooker', sport:'snooker', match:{any:['\\bworld championship\\b'],all:[],none:[]}, dazn:'RC C',quinnbet:'RC C',nti:'RC C',basis:'managed',source:'Managed JSON' },
];
const stagePolicy = {
  id:'stage', confidences:['High'], sports:['Tennis','Snooker'], field:'competition',
  whenMissingPatterns:['\\bq[1-4]\\b','\\b(?:r16|r32|qf|sf)\\b','\\bfinal\\b','\\bround\\s*(?:of\\s*)?(?:1|2|3|4|8|16|32|64|128)\\b'],
  excludePatterns:['\\b(srl|simulated reality|virtuals?|simulated)\\b','\\boutright\\b|\\btournament winner\\b'],
  manualCheck:true, manualCheckType:'Stage', reason:stageReason, suppressEscalationWhenHigh:true,
};
const bundle = {
  schemaVersion:1, version:'json-owned-test',
  instructions:`Managed JSON is sole authority. ${'Preserve all managed rules and policies. '.repeat(30)}`,
  knowledge:`Managed knowledge. ${'Approved sportsbook knowledge. '.repeat(120)}`,
  deterministicRules:{engineVersion:2,rules}, resultPolicies:[stagePolicy], resultTransforms:[],
};
assert(validateRulesBundle(bundle).valid, 'Managed bundle must validate');
assert(baselineDeterministicRules().rules.length === 0, 'Code baseline must contain no sportsbook mappings');
const index = buildRuntimeIndex(bundle);
for (const [id,name,expected] of [
  ['U-1','ATP Challenger Example',['RC G','RC F','RC G']],
  ['BG-1','ATP Challenger Example Qualification',['RC G','RC F','RC G']],
  ['BG-2','ATP Challenger Example',['RC G','RC G','RC G']],
  ['DB-1','ATP Challenger Example',['RC G','RC F','RC G']],
]) {
  const r=classifyDeterministic({sport:'Tennis',competition:name,competitionId:id},index);
  assert(r && [r.dazn,r.quinnbet,r.nti].join('/')===expected.join('/'), `JSON provider mapping failed for ${id}`);
}
let r=classifyDeterministic({sport:'Tennis',competition:'ATP Challenger Example',competitionId:'BG-2'},index);
let f=enforceResultPolicy(r,{sport:'Tennis',competition:'ATP Challenger Example'},bundle.resultPolicies);
assert(f.confidence==='High' && f.manualCheckType==='Stage' && f.manualCheckReason===stageReason,'Missing exact Tennis stage must be High + Stage');
f=enforceResultPolicy(r,{sport:'Tennis',competition:'ATP Challenger Example Q2'},bundle.resultPolicies);
assert(f.confidence==='High' && !f.manualCheck && f.manualCheckType==='No','Q2 must suppress Stage review');
r=classifyDeterministic({sport:'Snooker',competition:'World Championship'},index);
f=enforceResultPolicy(r,{sport:'Snooker',competition:'World Championship'},bundle.resultPolicies);
assert(f.manualCheckType==='Stage','Missing Snooker stage must use managed Stage policy');
f=enforceResultPolicy(r,{sport:'Snooker',competition:'World Championship R16'},bundle.resultPolicies);
assert(f.manualCheckType==='No','Explicit Snooker R16 must suppress Stage review');
const changed=structuredClone(bundle); changed.deterministicRules.rules.find(x=>x.id==='bg-chal').dazn='RC F';
const changedR=classifyDeterministic({sport:'Tennis',competition:'ATP Challenger Example',competitionId:'BG-2'},buildRuntimeIndex(changed));
assert(changedR.dazn==='RC F','Changing JSON must change runtime without code change');
const sources=['../functions/lib/deterministic.js','../functions/lib/result-policy.js','../functions/lib/rules-bundle.js','../functions/api/analyze-core.js'];
for (const rel of sources) {
  const src=readFileSync(new URL(rel,import.meta.url),'utf8');
  assert(!/Betgenius Challenger Singles; Global|Betradar Challenger Singles; Global|Tennis Virtuals\/SRL.*RC H/.test(src),`${rel} embeds sportsbook mapping text`);
}
assert(!existsSync(new URL('../functions/lib/provider-tennis-rules.js',import.meta.url)),'provider-tennis-rules.js must be removed');
console.log(`JSON-owned Tennis and Stage policy smoke tests passed (${checks} checks)`);
function assert(v,m){checks+=1;if(!v)throw new Error(m);}
